"""
LLMOps Platform - FastAPI Application Entry Point
"""
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from loguru import logger

from backend.config import settings
from backend.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    # Initialize database
    await init_db()
    logger.info("Database initialized")

    # Fix: recover PROCESSING documents on startup
    # — if extracted file already exists → COMPLETED, otherwise → FAILED
    try:
        from pathlib import Path as _Path
        import re as _re
        from backend.database import AsyncSessionLocal, Document, DocumentStatus
        from sqlalchemy import select
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(Document).where(Document.status == DocumentStatus.PROCESSING)
            )
            stuck_docs = result.scalars().all()
            recovered = failed = 0
            for doc in stuck_docs:
                stem = _re.sub(r"[^\w.-]", "_", _Path(doc.filename).stem)
                ep = None
                for ext in [".md", ".txt"]:
                    # Primary pattern: doc{id}_{stem}.ext (actual naming convention)
                    for candidate in [
                        settings.EXTRACTED_DIR / f"doc{doc.id}_{stem}{ext}",
                        settings.EXTRACTED_DIR / f"source_{stem}{ext}",
                        settings.EXTRACTED_DIR / f"{stem}{ext}",
                    ]:
                        if candidate.exists():
                            ep = candidate
                            break
                    if ep:
                        break
                if ep:
                    text = ep.read_text(encoding="utf-8", errors="replace")
                    wc = len(text.split())
                    doc.status = DocumentStatus.COMPLETED
                    doc.extracted_path = str(ep)
                    doc.word_count = wc
                    doc.page_count = max(1, wc // 300) if wc > 0 else 1
                    doc.error_message = None
                    recovered += 1
                else:
                    doc.status = DocumentStatus.FAILED
                    doc.error_message = "Server restarted during processing. Please re-upload."
                    failed += 1
            if stuck_docs:
                await session.commit()
                if recovered:
                    logger.info(f"Recovered {recovered} documents that completed before restart")
                if failed:
                    logger.warning(f"Marked {failed} stuck documents as FAILED on startup")
    except Exception as e:
        logger.error(f"Failed to clean up stuck documents: {e}")

    # Migrate document paths from old absolute locations (e.g. backup dirs) to current DATA_DIR.
    # Resolves cases where DB was copied between environments and stored absolute paths no
    # longer exist on disk.
    try:
        from backend.database import AsyncSessionLocal, Document
        from backend.utils.paths import remap_to_current
        from sqlalchemy import select
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(Document))
            docs = result.scalars().all()
            remapped = 0
            for d in docs:
                changed = False
                for attr, kind in (
                    ("original_path", "documents"),
                    ("extracted_path", "extracted"),
                    ("thumbnail_path", "thumbnails"),
                ):
                    stored = getattr(d, attr, None)
                    if not stored:
                        continue
                    new = remap_to_current(stored, kind)
                    if new and new != stored:
                        setattr(d, attr, new)
                        changed = True
                if changed:
                    remapped += 1
            if remapped:
                await session.commit()
                logger.info(f"Remapped paths for {remapped} document(s) to current DATA_DIR")
    except Exception as e:
        logger.error(f"Failed to remap document paths: {e}")

    # Fix: re-register documents that exist in extracted/ but are missing from DB
    try:
        import re as _re
        from pathlib import Path as _Path
        from backend.database import AsyncSessionLocal, Document, DocumentStatus
        from sqlalchemy import select
        async with AsyncSessionLocal() as session:
            existing_ids_result = await session.execute(select(Document.id))
            existing_ids = {row[0] for row in existing_ids_result.all()}

            orphan_count = 0
            if settings.EXTRACTED_DIR.exists():
                import glob as _glob
                for ep in settings.EXTRACTED_DIR.glob("doc*_*.md"):
                    # Parse doc_id from filename like doc3_My_Paper.md
                    m = _re.match(r"doc(\d+)_(.+)\.md$", ep.name)
                    if not m:
                        continue
                    doc_id = int(m.group(1))
                    if doc_id in existing_ids:
                        continue
                    # Find original PDF in documents dir
                    orig_pdf = None
                    if settings.DATA_DIR.exists():
                        docs_dir = settings.DATA_DIR / "documents"
                        matches = list(docs_dir.glob(f"{doc_id}_*.pdf")) if docs_dir.exists() else []
                        if matches:
                            orig_pdf = str(matches[0])
                    text = ep.read_text(encoding="utf-8", errors="replace")
                    wc = len(text.split())
                    stem = m.group(2)
                    # Reconstruct original filename from stem (underscores → spaces heuristic)
                    orig_name = stem.replace("_", " ").strip() + ".pdf"
                    new_doc = Document(
                        id=doc_id,
                        filename=orig_name,
                        original_path=orig_pdf or "",
                        file_type="pdf",
                        file_size=0,
                        status=DocumentStatus.COMPLETED,
                        extracted_path=str(ep),
                        word_count=wc,
                        page_count=max(1, wc // 300),
                    )
                    session.add(new_doc)
                    existing_ids.add(doc_id)
                    orphan_count += 1
                    logger.info(f"Re-registered missing document id={doc_id} from {ep.name}")

            if orphan_count:
                await session.commit()
                logger.info(f"Re-registered {orphan_count} orphaned documents from extracted files")
    except Exception as e:
        logger.error(f"Failed to re-register orphaned documents: {e}")

    # Note: document → RAG indexing is now managed explicitly through the
    # RAG DB page (per-collection). No implicit auto-reindex on startup.

    # Fix: mark any stuck PENDING/RUNNING training jobs as FAILED on startup
    try:
        from backend.database import AsyncSessionLocal, TrainingJob, AutoResearchJob, JobStatus
        from sqlalchemy import select
        async with AsyncSessionLocal() as session:
            # SFT/DPO TrainingJob
            result = await session.execute(
                select(TrainingJob).where(TrainingJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]))
            )
            stuck_jobs = result.scalars().all()
            for job in stuck_jobs:
                job.status = JobStatus.FAILED
                job.error_message = "Server restarted during training. Please retry."
            # AutoResearchJob
            ar_result = await session.execute(
                select(AutoResearchJob).where(AutoResearchJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]))
            )
            stuck_ar = ar_result.scalars().all()
            for ar in stuck_ar:
                ar.status = JobStatus.FAILED
                ar.error_message = "Server restarted during AutoResearch. Please retry."
            if stuck_jobs or stuck_ar:
                await session.commit()
                logger.warning(
                    f"Marked {len(stuck_jobs)} TrainingJob + {len(stuck_ar)} AutoResearchJob as FAILED on startup"
                )
    except Exception as e:
        logger.error(f"Failed to clean up stuck training jobs: {e}")

    # Fix: recover training datasets that have files but missing DB metadata
    try:
        import json as _json
        from backend.database import AsyncSessionLocal, TrainingDataset
        from sqlalchemy import select
        async with AsyncSessionLocal() as session:
            # Case 1: DB record exists but train_path is missing
            result = await session.execute(
                select(TrainingDataset).where(TrainingDataset.train_path == None)
            )
            incomplete_datasets = result.scalars().all()
            for ds in incomplete_datasets:
                candidate_dir = settings.TRAINING_DATA_DIR / ds.name
                train_file = candidate_dir / "train.jsonl"
                test_file = candidate_dir / "test.jsonl"
                if train_file.exists():
                    try:
                        train_count = sum(1 for l in open(train_file, encoding="utf-8") if l.strip())
                        test_count = sum(1 for l in open(test_file, encoding="utf-8") if l.strip()) if test_file.exists() else 0
                        ds.train_path = str(train_file)
                        ds.test_path = str(test_file) if test_file.exists() else None
                        ds.train_count = train_count
                        ds.test_count = test_count
                        logger.info(f"Recovered dataset '{ds.name}': {train_count} train, {test_count} test")
                    except Exception as inner_e:
                        logger.warning(f"Could not recover dataset '{ds.name}': {inner_e}")
                else:
                    # No output file → generation failed mid-run; delete the ghost record
                    await session.delete(ds)
                    logger.warning(f"Deleted failed dataset '{ds.name}' (id={ds.id}): no output file found")

            # Case 2: Files exist on disk but no DB record at all
            existing_names_result = await session.execute(select(TrainingDataset.name))
            existing_names = {row[0] for row in existing_names_result.all()}

            if settings.TRAINING_DATA_DIR.exists():
                for dataset_dir in settings.TRAINING_DATA_DIR.iterdir():
                    if not dataset_dir.is_dir():
                        continue
                    train_file = dataset_dir / "train.jsonl"
                    if not train_file.exists() or dataset_dir.name in existing_names:
                        continue
                    try:
                        test_file = dataset_dir / "test.jsonl"
                        train_count = sum(1 for l in open(train_file, encoding="utf-8") if l.strip())
                        test_count = sum(1 for l in open(test_file, encoding="utf-8") if l.strip()) if test_file.exists() else 0

                        # Detect data_type from first record
                        data_type = "sft"
                        with open(train_file, encoding="utf-8") as f:
                            first_line = f.readline().strip()
                        if first_line:
                            first_row = _json.loads(first_line)
                            if "chosen" in first_row or "rejected" in first_row:
                                data_type = "dpo"

                        new_ds = TrainingDataset(
                            name=dataset_dir.name,
                            data_type=data_type,
                            train_path=str(train_file),
                            test_path=str(test_file) if test_file.exists() else None,
                            train_count=train_count,
                            test_count=test_count,
                            train_ratio=0.9,
                        )
                        session.add(new_ds)
                        logger.info(f"Imported orphan dataset '{dataset_dir.name}': {train_count} train ({data_type})")
                    except Exception as inner_e:
                        logger.warning(f"Could not import dataset dir '{dataset_dir.name}': {inner_e}")

            await session.commit()
    except Exception as e:
        logger.error(f"Failed to recover incomplete datasets: {e}")

    yield

    # Checkpoint WAL → main DB before shutdown so data survives restart
    try:
        from sqlalchemy import text as _text
        from backend.database import engine as _engine
        async with _engine.begin() as conn:
            await conn.execute(_text("PRAGMA wal_checkpoint(FULL)"))
        logger.info("WAL checkpoint completed")
    except Exception as e:
        logger.warning(f"WAL checkpoint failed: {e}")

    logger.info("Shutting down LLMOps platform")


# Create FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="""
    LLMOps Platform - Agent-based fine-tuning for non-experts.

    ## Features
    - Document processing (PDF, DOCX, HWP, etc.)
    - Automatic Q&A training data generation
    - SFT training with LoRA/QLoRA
    - DPO preference optimization
    - AutoResearch hyperparameter optimization
    - Model evaluation (BLEU, ROUGE, perplexity, LLM-judge)
    - Real-time training monitoring via WebSocket
    - Chat interface with trained models
    """,
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
from backend.api.documents import router as documents_router
from backend.api.training_data import router as training_data_router
from backend.api.models import router as models_router
from backend.api.training import router as training_router
from backend.api.evaluation import router as evaluation_router
from backend.api.benchmark import router as benchmark_router
from backend.api.model_validation import router as model_validation_router
from backend.api.chat import router as chat_router
from backend.api.settings import router as settings_router
from backend.api.agent_messages import router as agent_messages_router
from backend.api.rag_db import router as rag_db_router

app.include_router(documents_router, prefix="/api")
app.include_router(training_data_router, prefix="/api")
app.include_router(models_router, prefix="/api")
app.include_router(training_router, prefix="/api")
app.include_router(evaluation_router, prefix="/api")
app.include_router(benchmark_router, prefix="/api")
app.include_router(model_validation_router, prefix="/api")
app.include_router(chat_router, prefix="/api")
app.include_router(settings_router, prefix="/api")
app.include_router(agent_messages_router, prefix="/api")
app.include_router(rag_db_router, prefix="/api")


@app.get("/")
async def root():
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "running",
        "docs": "/docs",
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": settings.APP_VERSION}


@app.get("/api/status")
async def api_status():
    """Get platform status including LLM provider info."""
    from backend.services.hf_registry import hf_registry

    downloaded = hf_registry.list_downloaded_models()
    return {
        "llm_provider": settings.LLM_PROVIDER,
        "llm_model": {
            "openai": settings.OPENAI_MODEL,
            "anthropic": settings.ANTHROPIC_MODEL,
            "ollama": settings.OLLAMA_MODEL,
        }.get(settings.LLM_PROVIDER),
        "has_openai_key": bool(settings.OPENAI_API_KEY),
        "has_anthropic_key": bool(settings.ANTHROPIC_API_KEY),
        "has_hf_token": bool(settings.HF_TOKEN),
        "downloaded_models": len(downloaded),
        "data_dir": str(settings.DATA_DIR),
    }


# Pipeline endpoint
@app.post("/api/pipeline/run")
async def run_pipeline(request: dict):
    """Run the full end-to-end pipeline."""
    from backend.schemas.models import PipelineRequest
    from backend.agents.orchestrator import orchestrator
    from backend.database import AsyncSessionLocal, Document
    from sqlalchemy import select

    # Get document info
    doc_id = request.get("document_id")
    if not doc_id:
        return JSONResponse(status_code=400, content={"error": "document_id required"})

    async with AsyncSessionLocal() as db:
        stmt = select(Document).where(Document.id == doc_id)
        result = await db.execute(stmt)
        doc = result.scalar_one_or_none()

    if not doc or not doc.extracted_path:
        return JSONResponse(status_code=400, content={"error": "Document not ready"})

    from backend.utils.paths import resolve_doc_path
    resolved = resolve_doc_path(doc.extracted_path, "extracted")
    if not resolved:
        return JSONResponse(status_code=400, content={"error": f"Extracted text file not found: {doc.extracted_path}"})

    try:
        pipeline_result = await orchestrator.run_full_pipeline(
            document_path=str(resolved),
            model_id=request.get("model_id", "Qwen/Qwen2.5-0.5B-Instruct"),
            training_method=request.get("training_method", "lora"),
            num_qa_pairs=request.get("num_qa_pairs", 50),
            epochs=request.get("epochs", 3),
            max_steps=request.get("max_steps", -1),
            use_autoresearch=request.get("use_autoresearch", False),
        )
        return pipeline_result
    except Exception as e:
        logger.error(f"Pipeline failed: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host=settings.HOST,
        port=settings.PORT,
        workers=settings.WORKERS,
        reload=settings.DEBUG,
    )
