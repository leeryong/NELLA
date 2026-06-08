"""
Training data management API endpoints.
"""
import asyncio
import json
import math
import random
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sa_delete

from backend.database import get_db, Document, TrainingDataset
from backend.schemas.models import (
    DatasetResponse,
    GenerateSFTDataRequest,
    GenerateDPODataRequest,
    GenerateReasoningDataRequest,
    StatusResponse,
)
from backend.agents.data_gen_agent import data_gen_agent
from backend.services.llm_service import LLMService
from backend.utils.paths import resolve_doc_path
from loguru import logger

router = APIRouter(prefix="/training-data", tags=["training-data"])

# Fan-out broadcast: each dataset has a list of subscriber queues + latest state
_progress_listeners: Dict[int, List[asyncio.Queue]] = {}
_latest_progress: Dict[int, dict] = {}   # latest event for late subscribers
_cancelled: set = set()          # dataset_id가 여기 있으면 생성 취소됨
_validation_cancelled: set[int] = set()  # dataset_id가 여기 있으면 필터/검증 취소됨


def _broadcast(dataset_id: int, event: dict):
    """Push event to all subscriber queues and update latest state."""
    _latest_progress[dataset_id] = event
    for q in _progress_listeners.get(dataset_id, []):
        q.put_nowait(event)
    if event.get("done"):
        _latest_progress.pop(dataset_id, None)


def _raise_if_validation_cancelled(dataset_id: int):
    if dataset_id in _validation_cancelled:
        _validation_cancelled.discard(dataset_id)
        raise HTTPException(status_code=499, detail="작업이 중단되었습니다.")


# Backwards-compatible alias so existing code using _progress_queues still works
_progress_queues: Dict[int, asyncio.Queue] = {}

# ── 순차 생성 큐 ────────────────────────────────────────────────────────────
_job_queue: asyncio.Queue = asyncio.Queue()   # (dataset_id, async_fn) 순차 처리
_worker_task: Optional[asyncio.Task] = None


async def _generation_worker():
    """큐에 쌓인 생성 작업을 하나씩 순차 처리한다."""
    while True:
        dataset_id, gen_fn = await _job_queue.get()
        try:
            if dataset_id in _cancelled:
                _broadcast(dataset_id, {"message": "사용자가 취소했습니다", "percent": 0, "done": True, "cancelled": True})
                _cancelled.discard(dataset_id)
                continue
            q = _progress_queues.get(dataset_id)
            if q:
                await q.put({"message": "생성 시작...", "percent": 3, "done": False})
            await gen_fn()
        except Exception as e:
            logger.error(f"Generation worker error (dataset {dataset_id}): {e}")
        finally:
            _job_queue.task_done()


def _ensure_worker():
    global _worker_task
    if _worker_task is None or _worker_task.done():
        _worker_task = asyncio.ensure_future(_generation_worker())


@router.post("/generate/sft", response_model=DatasetResponse)
async def generate_sft_data(
    request: GenerateSFTDataRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate SFT training data from a document."""
    # Verify document exists and is processed
    stmt = select(Document).where(Document.id == request.document_id)
    result = await db.execute(stmt)
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, detail="Document not found")
    if doc.status != "completed":
        raise HTTPException(400, detail=f"Document not ready (status={doc.status})")
    if not doc.extracted_path:
        raise HTTPException(400, detail="Document has no extracted text")
    resolved_extracted = resolve_doc_path(doc.extracted_path, "extracted")
    if not resolved_extracted:
        raise HTTPException(400, detail=f"Extracted text file not found: {doc.extracted_path}")

    # Create dataset record
    dataset = TrainingDataset(
        name=request.dataset_name,
        document_id=request.document_id,
        data_type="sft",
        train_ratio=request.train_ratio,
        llm_provider=request.llm_provider or "default",
    )
    db.add(dataset)
    await db.flush()
    await db.refresh(dataset)
    dataset_id = dataset.id

    # Set up broadcast progress
    _progress_listeners[dataset_id] = []

    async def push_progress(msg: str, pct: int):
        _broadcast(dataset_id, {"message": msg, "percent": pct, "done": pct >= 100})

    def is_cancelled() -> bool:
        return dataset_id in _cancelled

    # Generate in background
    async def generate():
        try:
            result = await data_gen_agent.generate_sft_data(
                document_id=request.document_id,
                extracted_text_path=str(resolved_extracted),
                num_pairs=request.num_pairs,
                dataset_name=request.dataset_name,
                train_ratio=request.train_ratio,
                llm_provider=request.llm_provider,
                system_prompt=request.system_prompt,
                user_prompt_template=request.user_prompt_template,
                progress_cb=push_progress,
                cancel_check=is_cancelled,
            )
            if is_cancelled():
                return
            from backend.database import AsyncSessionLocal
            async with AsyncSessionLocal() as session:
                stmt = select(TrainingDataset).where(TrainingDataset.id == dataset_id)
                db_result = await session.execute(stmt)
                ds = db_result.scalar_one_or_none()
                if ds:
                    ds.train_path = result["train_path"]
                    ds.test_path = result["test_path"]
                    ds.train_count = result["train_count"]
                    ds.test_count = result["test_count"]
                    await session.commit()
            await push_progress("저장 완료", 100)
        except Exception as e:
            logger.error(f"SFT generation failed for dataset {dataset_id}: {e}")
            _broadcast(dataset_id, {"message": f"오류: {e}", "percent": 0, "done": True, "error": True})
        finally:
            was_cancelled = dataset_id in _cancelled
            _cancelled.discard(dataset_id)
            if was_cancelled:
                _broadcast(dataset_id, {"done": True, "message": "사용자가 취소했습니다", "percent": 0, "cancelled": True})
            else:
                _broadcast(dataset_id, {"done": True, "message": "완료", "percent": 100})
            _progress_listeners.pop(dataset_id, None)

    await db.commit()  # background task가 새 session으로 dataset을 찾기 전에 commit
    queue_pos = _job_queue.qsize() + 1
    if queue_pos > 1:
        await push_progress(f"대기 중... ({queue_pos}번째)", 0)
    else:
        await push_progress("생성 준비 중...", 1)
    await _job_queue.put((dataset_id, generate))
    _ensure_worker()
    return dataset


@router.post("/generate/dpo", response_model=DatasetResponse)
async def generate_dpo_data(
    request: GenerateDPODataRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate DPO preference pair data from a document."""
    stmt = select(Document).where(Document.id == request.document_id)
    result = await db.execute(stmt)
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, detail="Document not found")
    if doc.status != "completed":
        raise HTTPException(400, detail="Document not ready")
    resolved_extracted = resolve_doc_path(doc.extracted_path, "extracted")
    if not resolved_extracted:
        raise HTTPException(400, detail=f"Extracted text file not found: {doc.extracted_path}")

    dataset = TrainingDataset(
        name=request.dataset_name,
        document_id=request.document_id,
        data_type="dpo",
        train_ratio=request.train_ratio,
        llm_provider="default",
    )
    db.add(dataset)
    await db.flush()
    await db.refresh(dataset)
    dataset_id = dataset.id

    # Set up broadcast progress
    _progress_listeners[dataset_id] = []

    async def push_progress(msg: str, pct: int):
        _broadcast(dataset_id, {"message": msg, "percent": pct, "done": pct >= 100})

    def is_cancelled() -> bool:
        return dataset_id in _cancelled

    async def generate():
        try:
            result = await data_gen_agent.generate_dpo_data(
                document_id=request.document_id,
                extracted_text_path=str(resolved_extracted),
                num_pairs=request.num_pairs,
                dataset_name=request.dataset_name,
                train_ratio=request.train_ratio,
                system_prompt=request.system_prompt,
                user_prompt_template=request.user_prompt_template,
                progress_cb=push_progress,
                cancel_check=is_cancelled,
            )
            if is_cancelled():
                return
            from backend.database import AsyncSessionLocal
            async with AsyncSessionLocal() as session:
                stmt = select(TrainingDataset).where(TrainingDataset.id == dataset_id)
                db_result = await session.execute(stmt)
                ds = db_result.scalar_one_or_none()
                if ds:
                    ds.train_path = result["train_path"]
                    ds.test_path = result["test_path"]
                    ds.train_count = result["train_count"]
                    ds.test_count = result["test_count"]
                    await session.commit()
            await push_progress("저장 완료", 100)
        except Exception as e:
            logger.error(f"DPO generation failed: {e}")
            _broadcast(dataset_id, {"message": f"오류: {e}", "percent": 0, "done": True, "error": True})
        finally:
            was_cancelled = dataset_id in _cancelled
            _cancelled.discard(dataset_id)
            if was_cancelled:
                _broadcast(dataset_id, {"done": True, "message": "사용자가 취소했습니다", "percent": 0, "cancelled": True})
            else:
                _broadcast(dataset_id, {"done": True, "message": "완료", "percent": 100})
            _progress_listeners.pop(dataset_id, None)

    await db.commit()  # background task가 새 session으로 dataset을 찾기 전에 commit
    queue_pos = _job_queue.qsize() + 1
    if queue_pos > 1:
        await push_progress(f"대기 중... ({queue_pos}번째)", 0)
    else:
        await push_progress("생성 준비 중...", 1)
    await _job_queue.put((dataset_id, generate))
    _ensure_worker()
    return dataset


async def _start_reasoning_generation(
    reasoning_type: str,  # "cot" | "tot" | "got"
    request: GenerateReasoningDataRequest,
    db: AsyncSession,
):
    """Shared launcher for CoT/ToT/GoT data generation jobs."""
    stmt = select(Document).where(Document.id == request.document_id)
    result = await db.execute(stmt)
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, detail="Document not found")
    if doc.status != "completed":
        raise HTTPException(400, detail=f"Document not ready (status={doc.status})")
    if not doc.extracted_path:
        raise HTTPException(400, detail="Document has no extracted text")
    resolved_extracted = resolve_doc_path(doc.extracted_path, "extracted")
    if not resolved_extracted:
        raise HTTPException(400, detail=f"Extracted text file not found: {doc.extracted_path}")

    dataset = TrainingDataset(
        name=request.dataset_name,
        document_id=request.document_id,
        data_type=reasoning_type,
        train_ratio=request.train_ratio,
        llm_provider=request.llm_provider or "default",
    )
    db.add(dataset)
    await db.flush()
    await db.refresh(dataset)
    dataset_id = dataset.id

    _progress_listeners[dataset_id] = []

    async def push_progress(msg: str, pct: int):
        _broadcast(dataset_id, {"message": msg, "percent": pct, "done": pct >= 100})

    def is_cancelled() -> bool:
        return dataset_id in _cancelled

    gen_method = {
        "cot": data_gen_agent.generate_cot_data,
        "tot": data_gen_agent.generate_tot_data,
        "got": data_gen_agent.generate_got_data,
    }[reasoning_type]

    async def generate():
        try:
            result = await gen_method(
                document_id=request.document_id,
                extracted_text_path=str(resolved_extracted),
                num_pairs=request.num_pairs,
                dataset_name=request.dataset_name,
                train_ratio=request.train_ratio,
                llm_provider=request.llm_provider,
                system_prompt=request.system_prompt,
                user_prompt_template=request.user_prompt_template,
                progress_cb=push_progress,
                cancel_check=is_cancelled,
            )
            if is_cancelled():
                return
            from backend.database import AsyncSessionLocal
            async with AsyncSessionLocal() as session:
                stmt = select(TrainingDataset).where(TrainingDataset.id == dataset_id)
                db_result = await session.execute(stmt)
                ds = db_result.scalar_one_or_none()
                if ds:
                    ds.train_path = result["train_path"]
                    ds.test_path = result["test_path"]
                    ds.train_count = result["train_count"]
                    ds.test_count = result["test_count"]
                    await session.commit()
            await push_progress("저장 완료", 100)
        except Exception as e:
            logger.error(f"{reasoning_type.upper()} generation failed for dataset {dataset_id}: {e}")
            _broadcast(dataset_id, {"message": f"오류: {e}", "percent": 0, "done": True, "error": True})
        finally:
            was_cancelled = dataset_id in _cancelled
            _cancelled.discard(dataset_id)
            if was_cancelled:
                _broadcast(dataset_id, {"done": True, "message": "사용자가 취소했습니다", "percent": 0, "cancelled": True})
            else:
                _broadcast(dataset_id, {"done": True, "message": "완료", "percent": 100})
            _progress_listeners.pop(dataset_id, None)

    await db.commit()
    queue_pos = _job_queue.qsize() + 1
    if queue_pos > 1:
        await push_progress(f"대기 중... ({queue_pos}번째)", 0)
    else:
        await push_progress("생성 준비 중...", 1)
    await _job_queue.put((dataset_id, generate))
    _ensure_worker()
    return dataset


@router.post("/generate/cot", response_model=DatasetResponse)
async def generate_cot_data(
    request: GenerateReasoningDataRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate Chain-of-Thought training data from a document."""
    return await _start_reasoning_generation("cot", request, db)


@router.post("/generate/tot", response_model=DatasetResponse)
async def generate_tot_data(
    request: GenerateReasoningDataRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate Tree-of-Thought training data from a document."""
    return await _start_reasoning_generation("tot", request, db)


@router.post("/generate/got", response_model=DatasetResponse)
async def generate_got_data(
    request: GenerateReasoningDataRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate Graph-of-Thought training data from a document."""
    return await _start_reasoning_generation("got", request, db)


@router.post("/upload")
async def upload_custom_dataset(
    file: UploadFile = File(...),
    dataset_name: str = "custom_dataset",
    train_ratio: float = 0.9,
    db: AsyncSession = Depends(get_db),
):
    """Upload a custom JSONL training dataset."""
    if not file.filename or not file.filename.endswith(".jsonl"):
        raise HTTPException(400, detail="File must be a .jsonl file")

    content = await file.read()

    try:
        result = await data_gen_agent.process_custom_upload(
            file_content=content,
            filename=file.filename,
            dataset_name=dataset_name,
            train_ratio=train_ratio,
        )
    except ValueError as e:
        raise HTTPException(400, detail=str(e))

    # Save to DB
    dataset = TrainingDataset(
        name=result["name"],
        document_id=None,
        data_type=result["data_type"],
        train_path=result["train_path"],
        test_path=result["test_path"],
        train_count=result["train_count"],
        test_count=result["test_count"],
        train_ratio=train_ratio,
    )
    db.add(dataset)
    await db.flush()
    await db.refresh(dataset)
    return dataset


@router.delete("/all", response_model=StatusResponse)
async def delete_all_datasets(db: AsyncSession = Depends(get_db)):
    """Cancel all active generations and delete every dataset."""
    # Cancel all in-flight generations
    cancel_event = {"message": "전체 삭제로 취소됨", "percent": 0, "done": True, "cancelled": True}
    for dataset_id in list(_progress_listeners.keys()):
        _cancelled.add(dataset_id)
        _broadcast(dataset_id, cancel_event)
    _progress_listeners.clear()
    _latest_progress.clear()

    # Drain queued jobs so worker doesn't start them after delete
    while not _job_queue.empty():
        try:
            _job_queue.get_nowait()
            _job_queue.task_done()
        except asyncio.QueueEmpty:
            break

    # Delete all datasets from DB + files
    stmt = select(TrainingDataset)
    result = await db.execute(stmt)
    datasets = result.scalars().all()

    count = len(datasets)
    for ds in datasets:
        for path_attr in ["train_path", "test_path"]:
            p = getattr(ds, path_attr)
            if p:
                try:
                    Path(p).unlink(missing_ok=True)
                    parent = Path(p).parent
                    if parent.exists() and not any(parent.iterdir()):
                        parent.rmdir()
                except Exception:
                    pass

    # Bulk DELETE bypasses ORM relationship checks (TrainingJob.dataset_id is NOT NULL
    # so session.delete() would fail when training jobs reference these datasets)
    await db.execute(sa_delete(TrainingDataset))
    await db.commit()
    return StatusResponse(status="success", message=f"{count}개 데이터셋 삭제 완료")


@router.get("/active-ids")
async def get_active_ids():
    """Return dataset IDs currently being generated."""
    return {"active_ids": list(_progress_listeners.keys())}


@router.post("/{dataset_id}/cancel", response_model=StatusResponse)
async def cancel_dataset_generation(dataset_id: int):
    """Cancel an in-progress generation without deleting the dataset."""
    if dataset_id in _progress_listeners:
        _cancelled.add(dataset_id)
        _broadcast(dataset_id, {"message": "사용자가 취소했습니다", "percent": 0, "done": True, "cancelled": True})
        _progress_listeners.pop(dataset_id, None)
        _latest_progress.pop(dataset_id, None)
        return StatusResponse(status="success", message=f"Dataset {dataset_id} generation cancelled")
    return StatusResponse(status="success", message="No active generation found")


@router.post("/{dataset_id}/cancel-validation", response_model=StatusResponse)
async def cancel_dataset_validation(dataset_id: int):
    """Cancel in-progress quality filtering or LLM validation for a dataset."""
    _validation_cancelled.add(dataset_id)
    return StatusResponse(status="success", message=f"Dataset {dataset_id} validation cancelled")


@router.get("/", response_model=List[DatasetResponse])
async def list_datasets(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """List all training datasets."""
    stmt = select(TrainingDataset).offset(skip).limit(limit).order_by(TrainingDataset.created_at.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{dataset_id}", response_model=DatasetResponse)
async def get_dataset(dataset_id: int, db: AsyncSession = Depends(get_db)):
    """Get dataset details."""
    stmt = select(TrainingDataset).where(TrainingDataset.id == dataset_id)
    result = await db.execute(stmt)
    ds = result.scalar_one_or_none()
    if not ds:
        raise HTTPException(404, detail="Dataset not found")
    return ds


@router.delete("/{dataset_id}", response_model=StatusResponse)
async def delete_dataset(dataset_id: int, db: AsyncSession = Depends(get_db)):
    """Cancel generation (if running) and delete a dataset."""
    stmt = select(TrainingDataset).where(TrainingDataset.id == dataset_id)
    result = await db.execute(stmt)
    ds = result.scalar_one_or_none()
    if not ds:
        raise HTTPException(404, detail="Dataset not found")

    # Signal cancellation if generating
    if dataset_id in _progress_listeners:
        _cancelled.add(dataset_id)
        _broadcast(dataset_id, {"message": "취소됨", "percent": 0, "done": True, "cancelled": True})
        _progress_listeners.pop(dataset_id, None)
        _latest_progress.pop(dataset_id, None)

    # Delete JSONL files
    for path_attr in ["train_path", "test_path"]:
        p = getattr(ds, path_attr)
        if p:
            try:
                Path(p).unlink(missing_ok=True)
                # Remove parent dir if empty
                parent = Path(p).parent
                if parent.exists() and not any(parent.iterdir()):
                    parent.rmdir()
            except Exception:
                pass

    # Bulk DELETE로 ORM cascade(training_jobs.dataset_id SET NULL) 우회.
    # TrainingJob.dataset_id는 NOT NULL이라 ORM의 session.delete()가 IntegrityError를 발생시킨다.
    # delete_all_datasets와 동일한 패턴.
    await db.execute(sa_delete(TrainingDataset).where(TrainingDataset.id == dataset_id))
    await db.commit()
    return StatusResponse(status="success", message=f"Dataset {dataset_id} deleted")


@router.get("/{dataset_id}/progress")
async def stream_dataset_progress(dataset_id: int):
    """Stream generation progress events via SSE (fan-out broadcast)."""
    async def event_generator():
        listeners = _progress_listeners.get(dataset_id)
        if listeners is None:
            # Generation not active — send last known state or done
            latest = _latest_progress.get(dataset_id)
            if latest:
                yield f"data: {json.dumps(latest)}\n\n"
            else:
                yield f"data: {json.dumps({'message': '완료', 'percent': 100, 'done': True})}\n\n"
            return
        # Create a personal subscriber queue and register
        q: asyncio.Queue = asyncio.Queue()
        # Send latest known state immediately so late subscribers see current progress
        latest = _latest_progress.get(dataset_id)
        if latest and not latest.get("done"):
            q.put_nowait(latest)
        listeners.append(q)
        timeout = 600
        elapsed = 0
        try:
            while elapsed < timeout:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=1.0)
                    yield f"data: {json.dumps(event)}\n\n"
                    if event.get("done"):
                        break
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'heartbeat': True})}\n\n"
                    elapsed += 1
        finally:
            try:
                listeners.remove(q)
            except ValueError:
                pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


class FilterDatasetRequest(BaseModel):
    min_length: int = 10
    max_length: int = 4000
    filter_duplicates: bool = True
    filter_low_quality: bool = True
    new_name: Optional[str] = None


class ValidateDatasetRequest(BaseModel):
    provider: Optional[str] = None
    sample_method: str = "all"  # all | representative
    sample_count: int = 30
    min_score: float = 6.5
    new_name: Optional[str] = None
    criteria: Dict[str, bool] = {
        "accuracy": True,
        "relevance": True,
        "clarity": True,
        "completeness": True,
        "diversity": True,
    }


def _read_jsonl_rows(path: Optional[str]) -> list[dict]:
    if not path:
        return []
    rows = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
    except Exception as e:
        logger.warning(f"Failed to read jsonl {path}: {e}")
    return rows


def _strip_filter_suffix(name: str) -> str:
    for suffix in ("_LLM_judge_filter", "_rule_based_filter", "_filtered", "_final"):
        name = name.removesuffix(suffix)
    return name


def _extract_validation_item(row: dict, data_type: str) -> dict:
    """Normalize SFT/DPO rows into a judgeable item."""
    if data_type == "dpo":
        question = row.get("prompt") or row.get("question") or row.get("instruction") or ""
        answer = row.get("chosen") or ""
        rejected = row.get("rejected") or ""
        return {
            "question": str(question),
            "answer": str(answer),
            "rejected": str(rejected),
            "raw": row,
        }

    question = (
        row.get("instruction")
        or row.get("question")
        or row.get("Human")
        or row.get("prompt")
        or ""
    )
    input_text = row.get("input") or row.get("context") or ""
    if input_text:
        question = f"{question}\n\nContext/Input: {input_text}"
    answer = row.get("output") or row.get("answer") or row.get("Assistant") or row.get("response") or ""
    return {"question": str(question), "answer": str(answer), "raw": row}


def _choose_k_values(n_samples: int) -> list[int]:
    if n_samples < 4:
        return [2] if n_samples > 2 else [1]
    max_k = min(int(math.sqrt(n_samples)), n_samples - 1, 30)
    min_k = 2
    if max_k <= min_k:
        return [min_k]
    step = max(1, (max_k - min_k) // 8)
    return list(range(min_k, max_k + 1, step))


def _build_embeddings(texts: list[str]):
    """Prefer SentenceTransformer embeddings; fall back to TF-IDF vectors."""
    try:
        from sentence_transformers import SentenceTransformer

        model = SentenceTransformer("all-MiniLM-L6-v2")
        return model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    except Exception as e:
        logger.warning(f"SentenceTransformer unavailable, using TF-IDF fallback: {e}")
        from sklearn.feature_extraction.text import TfidfVectorizer

        vectorizer = TfidfVectorizer(max_features=4096, ngram_range=(1, 2))
        return vectorizer.fit_transform(texts).toarray()


def _select_diverse_indices(embeddings, local_indices: list[int], quota: int, rng: random.Random) -> list[int]:
    import numpy as np
    from sklearn.metrics.pairwise import cosine_similarity

    if quota >= len(local_indices):
        return local_indices

    cluster_embeddings = embeddings[local_indices]
    centroid = np.mean(cluster_embeddings, axis=0)
    sims = cosine_similarity(cluster_embeddings, centroid.reshape(1, -1)).flatten()
    selected_local = [int(np.argmax(sims))]

    while len(selected_local) < quota:
        remaining = [i for i in range(len(local_indices)) if i not in selected_local]
        if not remaining:
            break
        selected_embeddings = cluster_embeddings[selected_local]
        sim_to_selected = cosine_similarity(cluster_embeddings, selected_embeddings)
        max_sim = np.max(sim_to_selected, axis=1)
        dist = 1 - max_sim
        for idx in selected_local:
            dist[idx] = 0
        remaining_dist = [max(float(dist[i]), 0.0) for i in remaining]
        total = sum(remaining_dist)
        if total <= 0:
            selected_local.append(remaining[0])
            continue
        pick = rng.choices(remaining, weights=[d * d for d in remaining_dist], k=1)[0]
        selected_local.append(pick)

    return [local_indices[i] for i in selected_local]


def _representative_sample_indices(items: list[dict], sample_count: int, random_state: int = 42) -> list[int]:
    import numpy as np
    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score

    n = len(items)
    if n <= sample_count:
        return list(range(n))
    if n < 3:
        return list(range(n))

    texts = [f"{item.get('question', '')}\n{item.get('answer', '')}" for item in items]
    embeddings = _build_embeddings(texts)

    best_k = 2
    best_score = -1.0
    for k in _choose_k_values(n):
        if k < 2 or k >= n:
            continue
        labels = KMeans(n_clusters=k, random_state=random_state, n_init="auto").fit_predict(embeddings)
        try:
            score = silhouette_score(embeddings, labels)
        except Exception:
            score = -1.0
        if score > best_score:
            best_score = score
            best_k = k

    labels = KMeans(n_clusters=best_k, random_state=random_state, n_init="auto").fit_predict(embeddings)
    unique_labels, counts = np.unique(labels, return_counts=True)

    quotas = {}
    used = 0
    for label, count in zip(unique_labels, counts):
        quota = max(1, round((int(count) / n) * sample_count))
        quotas[int(label)] = quota
        used += quota
    while used > sample_count:
        largest = max(quotas, key=lambda k: quotas[k])
        if quotas[largest] <= 1:
            break
        quotas[largest] -= 1
        used -= 1
    while used < sample_count:
        largest = int(unique_labels[int(np.argmax(counts))])
        quotas[largest] += 1
        used += 1

    rng = random.Random(random_state)
    selected: list[int] = []
    for label in unique_labels:
        cluster_indices = np.where(labels == label)[0].tolist()
        selected.extend(_select_diverse_indices(embeddings, cluster_indices, quotas[int(label)], rng))

    return sorted(selected[:sample_count])


async def _judge_training_sample(
    svc: LLMService,
    item: dict,
    data_type: str,
    active_criteria: list[str],
) -> dict:
    criteria_text = ", ".join(active_criteria)
    # 응답을 한국어로 받기 위해 프롬프트도 한국어로 작성하고, issues는 짧고 직관적인 핵심만 1~2개로 제한한다.
    if data_type == "dpo":
        user_prompt = f"""다음 DPO 선호도 학습 샘플의 품질을 평가하세요.
응답은 반드시 유효한 JSON만 출력하세요.

평가 기준 (각 1~10점): {criteria_text}

프롬프트:
{item.get("question", "")}

선호 응답(chosen):
{item.get("answer", "")}

거부 응답(rejected):
{item.get("rejected", "")}

JSON 스키마:
{{
  "scores": {{"accuracy": 1-10, "relevance": 1-10, "clarity": 1-10, "completeness": 1-10, "diversity": 1-10}},
  "overall": 1-10,
  "issues": [{{"text": "핵심만 30자 이내 한국어", "severity": "high|medium|low"}}]
}}

규칙:
- issues는 가장 중요한 문제 1~2개만 (없으면 빈 배열).
- issue.text는 반드시 한국어, 30자 이내, 명사형 핵심 문구 (예: "답변 길이 부족", "질문과 답변 불일치").
- 영어 단어 사용 금지."""
    else:
        user_prompt = f"""다음 SFT 질문-답변 학습 샘플의 품질을 평가하세요.
응답은 반드시 유효한 JSON만 출력하세요.

평가 기준 (각 1~10점): {criteria_text}

질문:
{item.get("question", "")}

답변:
{item.get("answer", "")}

JSON 스키마:
{{
  "scores": {{"accuracy": 1-10, "relevance": 1-10, "clarity": 1-10, "completeness": 1-10, "diversity": 1-10}},
  "overall": 1-10,
  "issues": [{{"text": "핵심만 30자 이내 한국어", "severity": "high|medium|low"}}]
}}

규칙:
- issues는 가장 중요한 문제 1~2개만 (없으면 빈 배열).
- issue.text는 반드시 한국어, 30자 이내, 명사형 핵심 문구 (예: "답변 길이 부족", "질문과 답변 불일치", "사실 오류 가능성").
- 영어 단어 사용 금지."""

    messages = [
        {"role": "system", "content": "당신은 학습 데이터 품질을 엄격하게 평가하는 한국어 평가자입니다. JSON 외 어떤 설명도 출력하지 마세요. issue.text는 반드시 한국어로 작성하세요."},
        {"role": "user", "content": user_prompt},
    ]
    try:
        response = await svc.complete(messages, temperature=0.1, max_tokens=700)
        start = response.find("{")
        end = response.rfind("}") + 1
        parsed = json.loads(response[start:end] if start >= 0 and end > start else response)
    except Exception as e:
        logger.warning(f"Dataset validation judge failed: {e}")
        parsed = {"scores": {}, "overall": 5.0, "issues": [{"text": "LLM 평가 실패", "severity": "medium"}]}

    scores = parsed.get("scores") or {}
    clean_scores = {}
    for criterion in active_criteria:
        try:
            clean_scores[criterion] = max(1.0, min(10.0, float(scores.get(criterion, parsed.get("overall", 5.0)))))
        except Exception:
            clean_scores[criterion] = 5.0
    try:
        overall = max(1.0, min(10.0, float(parsed.get("overall", sum(clean_scores.values()) / max(len(clean_scores), 1)))))
    except Exception:
        overall = sum(clean_scores.values()) / max(len(clean_scores), 1)

    issues = []
    for issue in parsed.get("issues") or []:
        if isinstance(issue, dict) and issue.get("text"):
            severity = issue.get("severity", "medium")
            if severity not in ("high", "medium", "low"):
                severity = "medium"
            # 핵심만 보이도록 30자 이내로 잘라낸다.
            text = str(issue["text"]).strip()
            if len(text) > 30:
                text = text[:30].rstrip() + "…"
            issues.append({"text": text, "severity": severity})
        if len(issues) >= 2:
            break
    return {"scores": clean_scores, "overall": overall, "issues": issues}


@router.post("/{dataset_id}/filter", response_model=DatasetResponse)
async def filter_dataset(
    dataset_id: int,
    req: FilterDatasetRequest,
    db: AsyncSession = Depends(get_db),
):
    """Apply quality filters to a dataset and save the result as a new dataset."""
    _validation_cancelled.discard(dataset_id)
    stmt = select(TrainingDataset).where(TrainingDataset.id == dataset_id)
    result = await db.execute(stmt)
    ds = result.scalar_one_or_none()
    if not ds:
        raise HTTPException(404, detail="Dataset not found")
    if not ds.train_path:
        raise HTTPException(400, detail="Dataset has no file data")

    import json as _json
    from backend.config import settings as _settings

    def read_jsonl(path: str) -> list:
        rows = []
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        rows.append(_json.loads(line))
        except Exception:
            pass
        return rows

    def apply_filters(rows: list, data_type: str) -> tuple[list, int]:
        seen_keys: set = set()
        kept = []
        for idx, row in enumerate(rows):
            if idx % 25 == 0:
                _raise_if_validation_cancelled(dataset_id)
            # Determine the relevant text fields
            if data_type in ("sft", "sft_alpaca"):
                text = row.get("output") or row.get("response") or ""
                key = (row.get("instruction") or row.get("input") or "").strip()
            else:  # dpo
                text = row.get("chosen") or ""
                key = (row.get("prompt") or "").strip()

            # Length filter
            if len(text) < req.min_length or len(text) > req.max_length:
                continue

            # Duplicate filter
            if req.filter_duplicates:
                if key and key in seen_keys:
                    continue
                if key:
                    seen_keys.add(key)

            # Low-quality heuristics
            if req.filter_low_quality:
                words = text.split()
                if len(words) < 3:
                    continue
                # Answer is identical to question
                if key and text.strip() == key.strip():
                    continue
                # Trivial answer (single token responses like "yes", "no", "ok")
                if len(words) == 1:
                    continue

            kept.append(row)
        return kept, len(rows) - len(kept)

    train_rows = read_jsonl(ds.train_path)
    test_rows = read_jsonl(ds.test_path) if ds.test_path else []
    _raise_if_validation_cancelled(dataset_id)

    try:
        filtered_train, _ = apply_filters(train_rows, ds.data_type)
        filtered_test, _ = apply_filters(test_rows, ds.data_type)
        _raise_if_validation_cancelled(dataset_id)

        if not filtered_train:
            raise HTTPException(400, detail="필터 적용 후 남은 데이터가 없습니다. 필터 조건을 완화해보세요.")

        # Naming: when rule-based runs on top of LLM-judged output, the result is `_final`.
        # Otherwise use `_rule_based_filter`.
        base = _strip_filter_suffix(ds.name)
        if (ds.name or "").endswith("_LLM_judge_filter"):
            default_name = f"{base}_final"
        else:
            default_name = f"{base}_rule_based_filter"
        new_name = req.new_name or default_name

        dataset_dir = _settings.TRAINING_DATA_DIR / new_name
        dataset_dir.mkdir(parents=True, exist_ok=True)

        train_path = dataset_dir / "train.jsonl"
        test_path = dataset_dir / "test.jsonl"

        train_path.write_text(
            "\n".join(_json.dumps(r, ensure_ascii=False) for r in filtered_train) + "\n",
            encoding="utf-8",
        )
        test_path.write_text(
            "\n".join(_json.dumps(r, ensure_ascii=False) for r in filtered_test) + "\n",
            encoding="utf-8",
        )
        _raise_if_validation_cancelled(dataset_id)

        new_ds = TrainingDataset(
            name=new_name,
            document_id=ds.document_id,
            data_type=ds.data_type,
            train_path=str(train_path),
            test_path=str(test_path) if filtered_test else None,
            train_count=len(filtered_train),
            test_count=len(filtered_test),
            train_ratio=ds.train_ratio,
            llm_provider=ds.llm_provider,
        )
        db.add(new_ds)
        await db.flush()
        await db.refresh(new_ds)
        await db.commit()

        logger.info(
            f"Filtered dataset {dataset_id} → new dataset {new_ds.id} '{new_name}': "
            f"{len(filtered_train)} train, {len(filtered_test)} test "
            f"(removed {len(train_rows) - len(filtered_train)} train, {len(test_rows) - len(filtered_test)} test)"
        )
        return new_ds
    finally:
        _validation_cancelled.discard(dataset_id)


@router.post("/{dataset_id}/validate")
async def validate_dataset(
    dataset_id: int,
    req: ValidateDatasetRequest,
    db: AsyncSession = Depends(get_db),
):
    """Evaluate training-data quality with the selected LLM provider."""
    _validation_cancelled.discard(dataset_id)
    stmt = select(TrainingDataset).where(TrainingDataset.id == dataset_id)
    result = await db.execute(stmt)
    ds = result.scalar_one_or_none()
    if not ds:
        raise HTTPException(404, detail="Dataset not found")
    if not ds.train_path:
        raise HTTPException(400, detail="Dataset has no file data")

    raw_rows = _read_jsonl_rows(ds.train_path)
    _raise_if_validation_cancelled(dataset_id)
    if not raw_rows:
        raise HTTPException(400, detail="검증할 학습 데이터가 없습니다.")

    items_with_raw_indices = []
    for raw_idx, row in enumerate(raw_rows):
        item = _extract_validation_item(row, ds.data_type)
        if item.get("question") and item.get("answer"):
            items_with_raw_indices.append((raw_idx, item))
    items = [item for _, item in items_with_raw_indices]
    _raise_if_validation_cancelled(dataset_id)
    if not items:
        raise HTTPException(400, detail="질문/답변 형식의 검증 가능한 항목이 없습니다.")

    active_criteria = [k for k, enabled in req.criteria.items() if enabled]
    if not active_criteria:
        active_criteria = ["accuracy", "relevance", "clarity", "completeness", "diversity"]

    sample_count = max(1, min(int(req.sample_count or 30), len(items)))
    if req.sample_method == "all":
        selected_indices = list(range(len(items)))
        sample_method = "all"
    else:
        selected_indices = _representative_sample_indices(items, sample_count)
        sample_method = "representative"
    _raise_if_validation_cancelled(dataset_id)

    selected_items = [items[i] for i in selected_indices]
    selected_raw_indices = [items_with_raw_indices[i][0] for i in selected_indices]
    provider = req.provider or settings.LLM_PROVIDER
    svc = LLMService(provider=provider)

    per_sample = []
    rejected_raw_indices: set[int] = set()
    aggregate_scores: dict[str, list[float]] = {criterion: [] for criterion in active_criteria}
    issue_counter: dict[tuple[str, str], int] = {}

    min_score = max(1.0, min(10.0, float(req.min_score or 6.5)))
    try:
        from backend.api.chat import _set_agent_progress as _push_progress
    except Exception:  # pragma: no cover — chat module not yet ready
        _push_progress = None

    total_samples = len(selected_items)
    for i, (idx, raw_idx, item) in enumerate(zip(selected_indices, selected_raw_indices, selected_items)):
        _raise_if_validation_cancelled(dataset_id)
        if _push_progress is not None:
            # LLM judge 단계는 전체 진행의 10~60 구간을 사용한다.
            pct = 10 + int((i / max(total_samples, 1)) * 50)
            _push_progress(
                "data-validation",
                status="running",
                phase="validating",
                percent=pct,
                message=f"LLM 평가 중... ({i + 1}/{total_samples})",
                source_dataset_id=dataset_id,
            )
        judged = await _judge_training_sample(svc, item, ds.data_type, active_criteria)
        _raise_if_validation_cancelled(dataset_id)
        overall = round(float(judged["overall"]), 2)
        passed = overall >= min_score
        if not passed:
            rejected_raw_indices.add(raw_idx)
        for criterion, score in judged["scores"].items():
            aggregate_scores.setdefault(criterion, []).append(float(score))
        for issue in judged["issues"]:
            key = (issue["text"], issue["severity"])
            issue_counter[key] = issue_counter.get(key, 0) + 1
        per_sample.append({
            "index": idx,
            "question": item.get("question", "")[:500],
            "answer": item.get("answer", "")[:500],
            "scores": judged["scores"],
            "overall": overall,
            "passed": passed,
            "issues": judged["issues"],
        })

    if _push_progress is not None:
        _push_progress(
            "data-validation",
            status="running",
            phase="validating",
            percent=60,
            message="LLM 평가 완료, 결과 저장 중...",
            source_dataset_id=dataset_id,
        )

    criterion_labels = {
        "accuracy": "정확성",
        "relevance": "관련성",
        "clarity": "명확성",
        "completeness": "완성도",
        "diversity": "다양성",
    }
    criterion_colors = {
        "accuracy": "#3b82f6",
        "relevance": "#8b5cf6",
        "clarity": "#06b6d4",
        "completeness": "#10b981",
        "diversity": "#f59e0b",
    }
    criteria_result = []
    for criterion in active_criteria:
        values = aggregate_scores.get(criterion) or []
        avg = sum(values) / len(values) if values else 0.0
        criteria_result.append({
            "name": criterion_labels.get(criterion, criterion),
            "score": round(avg, 1),
            "color": criterion_colors.get(criterion, "#64748b"),
        })

    all_scores = [sample["overall"] for sample in per_sample]
    overall_score = round(sum(all_scores) / len(all_scores), 1) if all_scores else 0.0
    recommendation = (
        "ready" if overall_score >= 8
        else "needs_work" if overall_score >= 6.5
        else "not_recommended"
    )

    issues = [
        {"text": text, "severity": severity, "count": count}
        for (text, severity), count in sorted(issue_counter.items(), key=lambda x: x[1], reverse=True)[:5]
    ]

    from backend.config import settings as _settings

    # Naming: when LLM judge runs on top of rule-based output, the result is `_final`.
    # Otherwise use `_LLM_judge_filter`.
    base = _strip_filter_suffix(ds.name)
    if (ds.name or "").endswith("_rule_based_filter"):
        default_name = f"{base}_final"
    else:
        default_name = f"{base}_LLM_judge_filter"
    new_name = req.new_name or default_name
    dataset_dir = _settings.TRAINING_DATA_DIR / new_name
    dataset_dir.mkdir(parents=True, exist_ok=True)
    kept_train_rows = [row for raw_idx, row in enumerate(raw_rows) if raw_idx not in rejected_raw_indices]
    test_rows = _read_jsonl_rows(ds.test_path)
    train_path = dataset_dir / "train.jsonl"
    test_path = dataset_dir / "test.jsonl"
    train_path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in kept_train_rows) + ("\n" if kept_train_rows else ""),
        encoding="utf-8",
    )
    if test_rows:
        test_path.write_text(
            "\n".join(json.dumps(row, ensure_ascii=False) for row in test_rows) + "\n",
            encoding="utf-8",
        )
    new_ds = TrainingDataset(
        name=new_name,
        document_id=ds.document_id,
        data_type=ds.data_type,
        train_path=str(train_path),
        test_path=str(test_path) if test_rows else None,
        train_count=len(kept_train_rows),
        test_count=len(test_rows),
        train_ratio=ds.train_ratio,
        llm_provider=ds.llm_provider,
    )
    db.add(new_ds)
    await db.flush()
    await db.refresh(new_ds)
    await db.commit()
    _raise_if_validation_cancelled(dataset_id)

    result_payload = {
        "id": f"validation-{dataset_id}-{int(datetime.utcnow().timestamp())}",
        "datasetName": ds.name,
        "datasetId": str(ds.id),
        "filteredDataset": {
            "dataset_id": new_ds.id,
            "dataset_name": new_ds.name,
            "train_count": new_ds.train_count,
            "test_count": new_ds.test_count,
            "data_type": new_ds.data_type,
            "train_path": new_ds.train_path,
            "test_path": new_ds.test_path,
        },
        "filteredDatasetId": new_ds.id,
        "filteredDatasetName": new_ds.name,
        "keptCount": len(kept_train_rows),
        "removedCount": len(rejected_raw_indices),
        "minScore": min_score,
        "totalSampled": len(selected_items),
        "totalRows": len(items),
        "sampleMethod": sample_method,
        "provider": provider,
        "overallScore": overall_score,
        "recommendation": recommendation,
        "criteria": criteria_result,
        "issues": issues,
        "sampleIndices": selected_indices,
        "samples": per_sample,
        "createdAt": datetime.utcnow().isoformat(),
    }
    _validation_cancelled.discard(dataset_id)
    if _push_progress is not None:
        # 매뉴얼 경로: 여기서 status=completed/phase=done/percent=100을 push 해야
        # 사용자가 다른 페이지 갔다가 돌아왔을 때 stale "진행 중 65%"가 표시되지 않는다.
        # 에이전트 경로: dispatcher가 곧이어 phase=filtering(70)/95/100을 이어서 push 하므로
        # 이 완료 상태는 즉시 덮어써져 정상 흐름에 영향이 없다.
        _push_progress(
            "data-validation",
            status="completed",
            phase="done",
            percent=100,
            message="LLM 기반 검증 완료",
            source_dataset_id=dataset_id,
            filter_result={
                "dataset_id": new_ds.id,
                "dataset_name": new_ds.name,
                "train_count": new_ds.train_count,
                "test_count": new_ds.test_count,
                "data_type": new_ds.data_type,
            },
        )
    return result_payload


@router.get("/{dataset_id}/preview")
async def preview_dataset(
    dataset_id: int,
    split: str = "train",
    num_samples: int = 5,
    max_field_chars: int = 2000,
    db: AsyncSession = Depends(get_db),
):
    """Preview dataset samples. split="both"면 train과 test를 한 번에 반환한다."""
    stmt = select(TrainingDataset).where(TrainingDataset.id == dataset_id)
    result = await db.execute(stmt)
    ds = result.scalar_one_or_none()
    if not ds:
        raise HTTPException(404, detail="Dataset not found")

    if split == "both":
        async def _preview(path: str | None) -> list[dict]:
            if not path:
                return []
            return await data_gen_agent.preview_dataset(path, num_samples, max_field_chars)

        train_samples, test_samples = await asyncio.gather(
            _preview(ds.train_path),
            _preview(ds.test_path),
        )
        return {
            "dataset_id": dataset_id,
            "split": "both",
            "samples": train_samples,        # 하위 호환
            "train_samples": train_samples,
            "test_samples": test_samples,
        }

    data_path = ds.train_path if split == "train" else ds.test_path
    if not data_path:
        raise HTTPException(400, detail=f"No {split} data available")

    samples = await data_gen_agent.preview_dataset(data_path, num_samples, max_field_chars)
    return {"dataset_id": dataset_id, "split": split, "samples": samples}
