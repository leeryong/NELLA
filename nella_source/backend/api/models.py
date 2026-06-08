"""
Model registry API endpoints.
"""
import shutil
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sa_delete

from backend.database import get_db, ModelRecord
from backend.schemas.models import ModelInfo, ModelRecordResponse, DownloadModelRequest, StatusResponse
from backend.services.hf_registry import hf_registry, CURATED_MODELS, is_valid_model_dir, get_hf_token
from backend.agents.model_selection_agent import model_selection_agent
from backend.config import BASE_DIR, settings
from loguru import logger

router = APIRouter(prefix="/models", tags=["models"])


def _resolve_local_path(path: Optional[str]) -> Optional[Path]:
    if not path:
        return None
    local_path = Path(path)
    if not local_path.is_absolute():
        local_path = BASE_DIR / local_path
    return local_path


def _record_has_valid_files(record: ModelRecord) -> bool:
    local_path = _resolve_local_path(record.local_path)
    if local_path and is_valid_model_dir(local_path):
        return True
    fallback = hf_registry.get_local_path(record.hf_model_id)
    return fallback is not None


def _record_valid_path(record: ModelRecord) -> Optional[Path]:
    local_path = _resolve_local_path(record.local_path)
    if local_path and is_valid_model_dir(local_path):
        return local_path
    return hf_registry.get_local_path(record.hf_model_id)


def _record_delete_path(record: ModelRecord) -> Optional[Path]:
    """Return the local directory to remove, even when DB local_path is stale."""
    local_path = _resolve_local_path(record.local_path)
    if local_path and local_path.exists():
        return local_path
    fallback = hf_registry.get_local_path(record.hf_model_id)
    if fallback and fallback.exists():
        return fallback
    expected = settings.MODELS_DIR / record.hf_model_id.replace("/", "--")
    if expected.exists():
        return expected
    return None


def _fmt_bytes(b: int) -> str:
    if b >= 1_073_741_824:
        return f"{b/1_073_741_824:.1f} GB"
    if b >= 1_048_576:
        return f"{b/1_048_576:.0f} MB"
    if b >= 1024:
        return f"{b/1024:.0f} KB"
    return f"{b} B"


@router.get("/curated", response_model=List[ModelInfo])
async def list_curated_models(
    size_category: Optional[str] = Query(None, description="tiny, small, medium"),
    task_type: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
):
    """List curated models suitable for fine-tuning."""
    models = hf_registry.list_curated_models(
        size_category=size_category,
        task_type=task_type,
        search=search,
    )
    return [ModelInfo(**m) for m in models]


@router.post("/download")
async def download_model(
    request: DownloadModelRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Download a model from HuggingFace Hub."""
    model_id = request.model_id

    # Check if already in DB
    stmt = select(ModelRecord).where(ModelRecord.hf_model_id == model_id)
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()

    if existing and existing.is_downloaded and _record_has_valid_files(existing):
        valid_path = _record_valid_path(existing)
        if valid_path and existing.local_path != str(valid_path):
            existing.local_path = str(valid_path)
            await db.commit()
        return {
            "status": "already_downloaded",
            "message": f"Model {model_id} is already available",
            "local_path": existing.local_path,
        }
    if existing and existing.is_downloaded:
        existing.is_downloaded = False
        existing.local_path = None
        await db.commit()

    # Get model info from curated list
    curated = next(
        (m for m in CURATED_MODELS if m["hf_model_id"] == model_id), None
    )
    if curated and curated.get("requires_token") and not get_hf_token():
        raise HTTPException(
            400,
            detail=(
                f"{model_id}는 HuggingFace 토큰과 라이선스 동의가 필요한 모델입니다. "
                "현재 NELLA에 HF_TOKEN이 등록되어 있지 않습니다. 시스템 설정에서 HuggingFace 토큰을 입력하고, "
                "HuggingFace에서 해당 모델 접근 권한/라이선스를 승인한 뒤 다시 시도하세요."
            ),
        )

    # Create or update DB record
    if not existing:
        model_record = ModelRecord(
            hf_model_id=model_id,
            name=curated["name"] if curated else model_id.split("/")[-1],
            description=curated.get("description", "") if curated else "",
            task_type=curated.get("task_type") if curated else "text-generation",
            size_category=curated.get("size_category") if curated else None,
            parameter_count=curated.get("parameter_count") if curated else None,
            download_size_gb=curated.get("download_size_gb") if curated else None,
            supports_vision=curated.get("supports_vision", False) if curated else False,
            is_downloaded=False,
        )
        db.add(model_record)
        await db.commit()
        await db.refresh(model_record)
        record_id = model_record.id
    else:
        record_id = existing.id

    # Download in background
    async def do_download():
        try:
            local_path = await hf_registry.download_model(model_id)
            from backend.database import AsyncSessionLocal
            async with AsyncSessionLocal() as session:
                stmt = select(ModelRecord).where(ModelRecord.id == record_id)
                db_result = await session.execute(stmt)
                record = db_result.scalar_one_or_none()
                if record:
                    record.is_downloaded = True
                    try:
                        record.local_path = str(Path(local_path).relative_to(BASE_DIR))
                    except ValueError:
                        record.local_path = str(local_path)
                    await session.commit()
            logger.info(f"Model {model_id} downloaded successfully")
        except Exception as e:
            from backend.database import AsyncSessionLocal
            async with AsyncSessionLocal() as session:
                stmt = select(ModelRecord).where(ModelRecord.id == record_id)
                db_result = await session.execute(stmt)
                record = db_result.scalar_one_or_none()
                if record:
                    record.is_downloaded = False
                    record.local_path = None
                    await session.commit()
            logger.error(f"Model download failed: {e}")

    # 응답을 보내기 전에 placeholder를 등록 — frontend가 mount 직후 activeDownloads로
    # 이 모델을 찾을 수 있어야 진행률 폴링이 race 없이 시작된다.
    hf_registry.mark_download_pending(model_id)
    background_tasks.add_task(do_download)

    return {
        "status": "downloading",
        "message": f"Model {model_id} download started in background",
        "model_id": record_id,
    }


@router.post("/cancel-download/{model_id:path}")
async def cancel_download(model_id: str, db: AsyncSession = Depends(get_db)):
    """Cancel an in-progress download and remove partial files."""
    cancelled = await hf_registry.cancel_download(model_id)
    if not cancelled:
        return {"status": "not_downloading", "message": f"{model_id} is not currently downloading"}

    # Remove DB record if it was never completed
    stmt = select(ModelRecord).where(ModelRecord.hf_model_id == model_id)
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()
    if record and not record.is_downloaded:
        # Bulk DELETE로 ORM cascade(training_jobs.base_model_id SET NULL) 우회.
        await db.execute(sa_delete(ModelRecord).where(ModelRecord.id == record.id))
        await db.commit()

    return {"status": "cancelled", "message": f"Download cancelled and partial files removed"}


@router.get("/active-downloads")
async def list_active_downloads():
    """현재 진행 중인(preparing/downloading) 모델 다운로드 목록.
    ModelSelection 페이지가 mount 시 호출해 race 없이 startPolling을 재개한다."""
    items = hf_registry.list_active_downloads()
    return [
        {
            "model_id": item["model_id"],
            "status": item.get("status", "downloading"),
            "percent": item.get("percent", 0),
            "downloaded_bytes": item.get("downloaded_bytes", 0) or 0,
            "total_bytes": item.get("total_bytes", 0) or 0,
        }
        for item in items
    ]


@router.get("/download-status/{model_id:path}")
async def get_download_status(model_id: str):
    """Polling endpoint: returns download progress for a model."""
    prog = model_selection_agent.normalize_status(model_id, hf_registry.get_download_progress(model_id))
    status = prog.get("status", "idle")
    downloaded = prog.get("downloaded_bytes", 0) or 0
    total      = prog.get("total_bytes", 0)     or 0
    if status == "idle":
        expected = settings.MODELS_DIR / model_id.replace("/", "--")
        if expected.exists():
            downloaded = sum(f.stat().st_size for f in expected.rglob("*") if f.is_file())
    return {
        "model_id": model_id,
        "status":   status,
        "percent":  100 if status == "completed" else prog.get("percent", 0),
        "downloaded_bytes": downloaded,
        "total_bytes":      total,
        "downloaded_str":   _fmt_bytes(downloaded),
        "total_str":        _fmt_bytes(total) if total else None,
        "files_total":      prog.get("files_total", 0),
        "error":            prog.get("error"),
    }


@router.get("/downloaded", response_model=List[ModelRecordResponse])
async def list_downloaded_models(db: AsyncSession = Depends(get_db)):
    """List all downloaded models, auto-syncing filesystem state to DB."""
    # Clean stale DB records first. A record is not downloaded unless its files
    # are actually present and usable on disk.
    stale_result = await db.execute(select(ModelRecord).where(ModelRecord.is_downloaded == True))
    for record in stale_result.scalars().all():
        valid_path = _record_valid_path(record)
        if valid_path:
            record.local_path = str(valid_path)
        else:
            record.is_downloaded = False
            record.local_path = None

    active_download_ids = {
        item.get("model_id")
        for item in hf_registry.list_active_downloads()
        if item.get("model_id")
    }

    # Sync: any model dir on disk with config.json should be marked downloaded,
    # except directories currently being written by an active snapshot download.
    if settings.MODELS_DIR.exists():
        for model_dir in settings.MODELS_DIR.iterdir():
            if not is_valid_model_dir(model_dir):
                continue
            hf_id = model_dir.name.replace("--", "/", 1)
            if hf_id in active_download_ids:
                continue
            stmt_check = select(ModelRecord).where(ModelRecord.hf_model_id == hf_id)
            res = await db.execute(stmt_check)
            record = res.scalar_one_or_none()
            if record and not record.is_downloaded:
                record.is_downloaded = True
                record.local_path = str(model_dir)
            elif not record:
                db.add(ModelRecord(
                    hf_model_id=hf_id,
                    name=model_dir.name.split("--")[-1],
                    description="",
                    task_type="text-generation",
                    is_downloaded=True,
                    local_path=str(model_dir),
                ))
    await db.commit()

    stmt = select(ModelRecord).where(ModelRecord.is_downloaded == True)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/trending")
async def list_trending_models(
    task: str = Query(default="text-generation"),
    max_results: int = Query(default=50, le=100),
    sort: str = Query(default="downloads", description="downloads | likes | lastModified"),
    direction: int = Query(default=-1, description="-1 desc, 1 asc"),
    search: str = Query(default="", description="Optional search query"),
):
    """Fetch models from HuggingFace Hub with flexible sorting."""
    results = await hf_registry.fetch_trending_models(
        task=task, max_results=max_results, sort=sort, search=search
    )
    return {"results": results, "count": len(results)}


@router.get("/search")
async def search_hf_hub(
    query: str = Query(..., description="Search query"),
    task: str = Query(default="text-generation"),
    max_results: int = Query(default=20, le=100),
):
    """Search HuggingFace Hub for models."""
    results = await hf_registry.search_hf_hub(query, task, max_results)
    return {"results": results, "count": len(results)}


@router.get("/{model_id:path}", response_model=ModelRecordResponse)
async def get_model(model_id: str, db: AsyncSession = Depends(get_db)):
    """Get model record by HF model ID."""
    stmt = select(ModelRecord).where(ModelRecord.hf_model_id == model_id)
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(404, detail=f"Model {model_id} not found in registry")
    return record


@router.delete("/downloaded/all", response_model=StatusResponse)
async def delete_all_downloaded_models(
    delete_files: bool = Query(default=True, description="Also delete local model files"),
    db: AsyncSession = Depends(get_db),
):
    """Delete all downloaded model records and their local files."""
    stmt = select(ModelRecord).where(ModelRecord.is_downloaded == True)
    result = await db.execute(stmt)
    records = result.scalars().all()

    count = 0
    record_ids: list[int] = []
    for record in records:
        if delete_files:
            local_path = _record_delete_path(record)
            if local_path and local_path.exists():
                try:
                    shutil.rmtree(local_path)
                    logger.info(f"Deleted model files: {local_path}")
                except Exception as e:
                    logger.warning(f"Failed to delete files for {record.hf_model_id}: {e}")
        record_ids.append(record.id)
        count += 1

    # Bulk DELETE로 ORM cascade(training_jobs.base_model_id SET NULL) 우회.
    if record_ids:
        await db.execute(sa_delete(ModelRecord).where(ModelRecord.id.in_(record_ids)))
    await db.commit()
    return StatusResponse(status="success", message=f"{count}개 모델 삭제 완료")


@router.delete("/{record_id}", response_model=StatusResponse)
async def delete_model_record(
    record_id: int,
    delete_files: bool = Query(default=True, description="Also delete local model files"),
    db: AsyncSession = Depends(get_db),
):
    """Delete a model record and optionally its local files."""
    stmt = select(ModelRecord).where(ModelRecord.id == record_id)
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(404, detail="Model not found")

    deleted_files = False
    if delete_files:
        local_path = _record_delete_path(record)
        if local_path and local_path.exists():
            try:
                shutil.rmtree(local_path)
                deleted_files = True
                logger.info(f"Deleted model files at {local_path}")
            except Exception as e:
                logger.error(f"Failed to delete model files: {e}")
                raise HTTPException(500, detail=f"Failed to delete model files: {e}")

    # Bulk DELETE로 ORM cascade(training_jobs.base_model_id SET NULL) 우회.
    # TrainingJob.base_model_id는 NOT NULL이라 ORM session.delete()가 IntegrityError를 발생시킨다.
    await db.execute(sa_delete(ModelRecord).where(ModelRecord.id == record_id))
    await db.commit()
    msg = "Model deleted (DB record + local files)" if deleted_files else "Model record deleted (no local files found)"
    return StatusResponse(status="success", message=msg)
