"""
Training job management API endpoints.
WebSocket support for real-time training progress.
"""
import asyncio
import json
import shutil
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database import (
    get_db, TrainingJob, TrainingDataset, ModelRecord,
    JobStatus, TrainingMethod, AutoResearchJob, AsyncSessionLocal
)
from backend.schemas.models import (
    StartSFTRequest, StartDPORequest, StartAutoResearchRequest,
    TrainingJobResponse, StatusResponse,
)
from backend.agents.training_agent import training_agent
from backend.agents.autoresearch_agent import autoresearch_agent, AutoResearchConfig
from backend.services.hf_registry import hf_registry
from backend.config import settings
from loguru import logger

router = APIRouter(prefix="/training", tags=["training"])

# Track WebSocket connections for live updates
_ws_connections: dict[int, list[WebSocket]] = {}


async def _resolve_train_path(db: AsyncSession, dataset_ids: list[int]) -> tuple[int, str]:
    """Return (primary_dataset_id, train_data_path).
    If multiple datasets are given, merge their JSONL files into one temp file."""
    if not dataset_ids:
        raise HTTPException(400, detail="dataset_ids must not be empty")

    paths: list[str] = []
    primary_id: int = dataset_ids[0]
    for ds_id in dataset_ids:
        stmt = select(TrainingDataset).where(TrainingDataset.id == ds_id)
        result = await db.execute(stmt)
        ds = result.scalar_one_or_none()
        if not ds:
            raise HTTPException(404, detail=f"Dataset {ds_id} not found")
        if not ds.train_path:
            raise HTTPException(400, detail=f"Dataset {ds_id} has no training data")
        # Remap stale server paths to local TRAINING_DATA_DIR
        train_path = ds.train_path
        if not Path(train_path).exists():
            local_candidate = settings.TRAINING_DATA_DIR / Path(train_path).parent.name / Path(train_path).name
            if local_candidate.exists():
                train_path = str(local_candidate)
        paths.append(train_path)

    if len(paths) == 1:
        return primary_id, paths[0]

    # Merge multiple JSONL files
    merged_dir = settings.DATA_DIR / "training_data"
    merged_dir.mkdir(parents=True, exist_ok=True)
    import uuid as _uuid
    merged_path = str(merged_dir / f"merged_{_uuid.uuid4().hex[:8]}.jsonl")
    with open(merged_path, "w", encoding="utf-8") as out:
        for p in paths:
            try:
                with open(p, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            out.write(line + "\n")
            except FileNotFoundError:
                logger.warning(f"Dataset file not found: {p}")
    return primary_id, merged_path

# Track LoRA merge progress: {job_id: {status, percent, message, done, error, merged_dir}}
_merge_state: dict[int, dict] = {}


def _delete_dir(path_value: str | Path | None) -> bool:
    if not path_value:
        return False
    path = Path(path_value)
    try:
        if path.exists():
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
            logger.info(f"Deleted training artifact: {path}")
            return True
    except Exception as exc:
        logger.warning(f"Failed to delete training artifact {path}: {exc}")
    return False


def _delete_training_job_artifacts(job: TrainingJob) -> int:
    deleted = 0
    if job.output_dir:
        output = Path(job.output_dir)
        if _delete_dir(output):
            deleted += 1
        if _delete_dir(Path(str(output) + "_merged")):
            deleted += 1
    return deleted


def _delete_autoresearch_artifacts(job_id: int) -> int:
    deleted = 0
    root = settings.MODELS_DIR / f"autoresearch_{job_id}"
    if _delete_dir(root):
        deleted += 1
    return deleted


async def broadcast_to_job(job_id: int, data: dict):
    """Broadcast data to all WebSocket connections watching a job."""
    connections = _ws_connections.get(job_id, [])
    # Sanitize inf/nan before JSON serialization (json.dumps raises on Infinity)
    safe = _sanitize(data)
    for ws in connections[:]:
        try:
            await ws.send_json(safe)
        except Exception:
            try:
                connections.remove(ws)
            except ValueError:
                pass


@router.post("/sft", response_model=TrainingJobResponse)
async def start_sft_training(
    request: StartSFTRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Start a Supervised Fine-Tuning job."""
    # Resolve dataset(s) → merged path if multiple
    primary_dataset_id, train_data_path = await _resolve_train_path(db, request.dataset_ids)

    # Validate or register model
    stmt = select(ModelRecord).where(ModelRecord.hf_model_id == request.model_id)
    result = await db.execute(stmt)
    model_record = result.scalar_one_or_none()

    if not model_record:
        # Auto-register
        model_record = ModelRecord(
            hf_model_id=request.model_id,
            name=request.model_id.split("/")[-1],
            is_downloaded=False,
        )
        db.add(model_record)
        await db.flush()
        await db.refresh(model_record)

    # Get local path
    local_path = hf_registry.get_local_path(request.model_id)
    if not local_path and not model_record.local_path:
        raise HTTPException(
            400,
            detail=f"Model {request.model_id} not downloaded. Please download it first."
        )
    model_path = local_path or model_record.local_path

    # Create job record
    method_map = {"full": TrainingMethod.SFT, "lora": TrainingMethod.LORA, "qlora": TrainingMethod.QLORA}
    job = TrainingJob(
        name=request.name,
        dataset_id=primary_dataset_id,
        base_model_id=model_record.id,
        method=method_map.get(request.method, TrainingMethod.LORA),
        status=JobStatus.PENDING,
        config={
            "num_train_epochs": request.num_train_epochs,
            "learning_rate": request.learning_rate,
            "batch_size": request.batch_size,
            "max_seq_length": request.max_seq_length,
            "lora_r": request.lora_r,
            "lora_alpha": request.lora_alpha,
            "lora_dropout": request.lora_dropout,
            "gradient_accumulation_steps": request.gradient_accumulation_steps,
            "max_steps": request.max_steps,
            "dataset_ids": list(request.dataset_ids),  # 다중 데이터셋 추적용 (UI 체크박스 복원)
        },
    )
    db.add(job)
    await db.flush()
    await db.refresh(job)
    job_id = job.id
    # Explicitly commit before starting background task to avoid race condition
    # where the background task opens a new DB connection before this one commits
    await db.commit()

    # Start training in background
    async def run_training():
        # Wait briefly to ensure the main request's DB session has committed
        await asyncio.sleep(0.5)

        async def _get_job(session) -> Optional[TrainingJob]:
            """Fetch job with retry in case commit hasn't propagated yet."""
            for attempt in range(10):
                # Expire all cached objects to force fresh DB read
                session.expire_all()
                stmt = select(TrainingJob).where(TrainingJob.id == job_id)
                db_result = await session.execute(stmt)
                j = db_result.scalar_one_or_none()
                if j is not None:
                    return j
                logger.warning(f"Job {job_id} not found yet, retrying ({attempt+1}/10)...")
                await asyncio.sleep(1.0)
            return None

        async with AsyncSessionLocal() as session:
            j = await _get_job(session)
            if j is None:
                logger.error(f"Training job {job_id} not found in DB after retries, aborting background task")
                return
            j.status = JobStatus.RUNNING
            j.started_at = datetime.utcnow()
            await session.commit()

        try:
            async def metrics_callback(jid, metrics):
                await broadcast_to_job(jid, {"type": "metrics", **metrics})

            result = await training_agent.start_sft_training(
                job_id=job_id,
                dataset_id=primary_dataset_id,
                base_model_path=str(model_path),
                base_model_id=request.model_id,
                train_data_path=train_data_path,
                test_data_path=None,
                method=request.method,
                config_overrides=job.config,
                progress_callback=metrics_callback,
            )

            async with AsyncSessionLocal() as session:
                stmt = select(TrainingJob).where(TrainingJob.id == job_id)
                db_result = await session.execute(stmt)
                j = db_result.scalar_one_or_none()
                if j:
                    # Don't overwrite CANCELLED status set by the cancel API
                    if j.status != JobStatus.CANCELLED:
                        j.status = JobStatus.COMPLETED
                    j.completed_at = datetime.utcnow()
                    j.output_dir = result.get("output_dir")
                    j.best_checkpoint = result.get("best_checkpoint")
                    j.final_loss = result.get("final_loss")
                    j.training_metrics = result.get("training_metrics", [])
                    await session.commit()

            msg_type = "cancelled" if result.get("cancelled") else "completed"
            await broadcast_to_job(job_id, {"type": msg_type, "result": result})

        except Exception as e:
            logger.error(f"Training job {job_id} failed: {e}")
            async with AsyncSessionLocal() as session:
                stmt = select(TrainingJob).where(TrainingJob.id == job_id)
                db_result = await session.execute(stmt)
                j = db_result.scalar_one_or_none()
                if j:
                    j.status = JobStatus.FAILED
                    j.error_message = str(e)
                    j.completed_at = datetime.utcnow()
                    await session.commit()
            await broadcast_to_job(job_id, {"type": "error", "error": str(e)})

    background_tasks.add_task(run_training)
    return job


@router.post("/dpo", response_model=TrainingJobResponse)
async def start_dpo_training(
    request: StartDPORequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Start a DPO training job."""
    primary_dataset_id, train_data_path = await _resolve_train_path(db, request.dataset_ids)

    stmt = select(ModelRecord).where(ModelRecord.hf_model_id == request.model_id)
    result = await db.execute(stmt)
    model_record = result.scalar_one_or_none()
    if not model_record:
        raise HTTPException(404, detail="Model not found. Download it first.")

    local_path = hf_registry.get_local_path(request.model_id) or model_record.local_path
    if not local_path:
        raise HTTPException(400, detail="Model not downloaded")

    job = TrainingJob(
        name=request.name,
        dataset_id=primary_dataset_id,
        base_model_id=model_record.id,
        method=TrainingMethod.DPO,
        status=JobStatus.PENDING,
        config={
            "learning_rate": request.learning_rate,
            "num_train_epochs": request.num_train_epochs,
            "beta": request.beta,
            "use_lora": request.use_lora,
            "max_steps": request.max_steps,
            "dataset_ids": list(request.dataset_ids),
        },
    )
    db.add(job)
    await db.flush()
    await db.refresh(job)
    job_id = job.id

    async def run_dpo():
        # Wait briefly to ensure the main request's DB session has committed
        await asyncio.sleep(0.5)

        async with AsyncSessionLocal() as session:
            for attempt in range(5):
                stmt = select(TrainingJob).where(TrainingJob.id == job_id)
                db_result = await session.execute(stmt)
                j = db_result.scalar_one_or_none()
                if j is not None:
                    break
                logger.warning(f"DPO job {job_id} not found yet, retrying ({attempt+1}/5)...")
                await asyncio.sleep(0.5)
            if j is None:
                logger.error(f"DPO job {job_id} not found in DB after retries")
                return
            j.status = JobStatus.RUNNING
            j.started_at = datetime.utcnow()
            await session.commit()

        try:
            result = await training_agent.start_dpo_training(
                job_id=job_id,
                base_model_path=str(local_path),
                base_model_id=request.model_id,
                train_data_path=train_data_path,
                test_data_path=None,
                config_overrides=job.config,
            )

            async with AsyncSessionLocal() as session:
                stmt = select(TrainingJob).where(TrainingJob.id == job_id)
                db_result = await session.execute(stmt)
                j = db_result.scalar_one_or_none()
                if j:
                    j.status = JobStatus.COMPLETED
                    j.completed_at = datetime.utcnow()
                    j.output_dir = result.get("output_dir")
                    j.final_loss = result.get("final_loss")
                    j.training_metrics = result.get("training_metrics", [])
                    await session.commit()

        except Exception as e:
            logger.error(f"DPO job {job_id} failed: {e}")
            async with AsyncSessionLocal() as session:
                stmt = select(TrainingJob).where(TrainingJob.id == job_id)
                db_result = await session.execute(stmt)
                j = db_result.scalar_one_or_none()
                if j:
                    j.status = JobStatus.FAILED
                    j.error_message = str(e)
                    await session.commit()

    background_tasks.add_task(run_dpo)
    return job


@router.post("/autoresearch")
async def start_autoresearch(
    request: StartAutoResearchRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Start an AutoResearch hyperparameter optimization job."""
    primary_dataset_id, train_data_path = await _resolve_train_path(db, request.dataset_ids)

    # Auto-register model if not in DB (same as SFT endpoint)
    stmt = select(ModelRecord).where(ModelRecord.hf_model_id == request.model_id)
    result = await db.execute(stmt)
    model_record = result.scalar_one_or_none()
    if not model_record:
        model_record = ModelRecord(
            hf_model_id=request.model_id,
            name=request.model_id.split("/")[-1],
            is_downloaded=False,
        )
        db.add(model_record)
        await db.flush()
        await db.refresh(model_record)

    local_path = hf_registry.get_local_path(request.model_id) or model_record.local_path
    if not local_path:
        raise HTTPException(400, detail=f"Model {request.model_id} not downloaded. Please download it first.")

    ar_job = AutoResearchJob(
        name=request.name,
        dataset_id=primary_dataset_id,
        base_model_id=model_record.id,
        status=JobStatus.PENDING,
        method=request.method,
        max_trials=request.max_trials,
        steps_per_trial=request.steps_per_trial,
    )
    db.add(ar_job)
    await db.flush()
    await db.refresh(ar_job)
    ar_job_id = ar_job.id
    await db.commit()

    async def run_ar():
        async with AsyncSessionLocal() as session:
            stmt = select(AutoResearchJob).where(AutoResearchJob.id == ar_job_id)
            result = await session.execute(stmt)
            j = result.scalar_one()
            j.status = JobStatus.RUNNING
            await session.commit()

        await broadcast_to_job(ar_job_id, {
            "type": "ar_started",
            "job_id": ar_job_id,
            "max_trials": request.max_trials,
            "steps_per_trial": request.steps_per_trial,
        })

        async def progress_callback(data: dict):
            phase = data.get("phase")
            if phase == "system_stats":
                # Forward directly as system_stats (not wrapped in ar_progress)
                await broadcast_to_job(ar_job_id, {"type": "system_stats", **{k: v for k, v in data.items() if k != "phase"}})
            else:
                await broadcast_to_job(ar_job_id, {"type": "ar_progress", **data})
            if phase == "exploration" and data.get("status") in ("trial_done", "trial_failed"):
                async with AsyncSessionLocal() as progress_session:
                    stmt = select(AutoResearchJob).where(AutoResearchJob.id == ar_job_id)
                    db_result = await progress_session.execute(stmt)
                    progress_job = db_result.scalar_one_or_none()
                    if progress_job:
                        trials = list(progress_job.trial_results or [])
                        trial_idx = int(data.get("trial") or 0) - 1
                        trial_record = {
                            "trial_id": trial_idx,
                            "config": data.get("config") or {},
                            "final_loss": data.get("final_loss") if data.get("status") == "trial_done" else float("inf"),
                            "eval_loss": data.get("eval_loss"),
                            "steps": request.steps_per_trial if data.get("status") == "trial_done" else 0,
                            "duration_seconds": data.get("duration_seconds") or 0,
                            "metrics_history": data.get("metrics_history") or [],
                            "error": data.get("error"),
                        }
                        trials = [t for t in trials if int(t.get("trial_id", -1)) != trial_idx]
                        trials.append(trial_record)
                        trials.sort(key=lambda t: int(t.get("trial_id", 0)))
                        progress_job.trial_results = trials
                        valid_losses = [
                            t for t in trials
                            if isinstance(t.get("final_loss"), (int, float)) and t.get("final_loss") != float("inf")
                        ]
                        if valid_losses:
                            best = min(valid_losses, key=lambda t: float(t.get("final_loss")))
                            progress_job.best_loss = float(best.get("final_loss"))
                            progress_job.best_config = best.get("config")
                        await progress_session.commit()
            elif phase == "full_training" and data.get("best_config"):
                async with AsyncSessionLocal() as progress_session:
                    stmt = select(AutoResearchJob).where(AutoResearchJob.id == ar_job_id)
                    db_result = await progress_session.execute(stmt)
                    progress_job = db_result.scalar_one_or_none()
                    if progress_job:
                        progress_job.best_config = data.get("best_config")
                        progress_job.best_loss = data.get("best_loss")
                        await progress_session.commit()
            elif phase == "full_training_metric":
                async with AsyncSessionLocal() as progress_session:
                    stmt = select(AutoResearchJob).where(AutoResearchJob.id == ar_job_id)
                    db_result = await progress_session.execute(stmt)
                    progress_job = db_result.scalar_one_or_none()
                    if progress_job:
                        metrics = list(progress_job.final_training_metrics or [])
                        metric = {
                            "step": data.get("step"),
                            "loss": data.get("loss"),
                            "eval_loss": data.get("eval_loss"),
                            "epoch": data.get("epoch"),
                            "learning_rate": data.get("learning_rate"),
                        }
                        if metric["step"] is not None and metric["loss"] is not None:
                            metrics = [
                                m for m in metrics
                                if not (m.get("step") == metric["step"] and m.get("loss") == metric["loss"])
                            ]
                            metrics.append(metric)
                            progress_job.final_training_metrics = metrics
                            await progress_session.commit()

        try:
            ar_config = AutoResearchConfig(
                base_model_id=request.model_id,
                base_model_path=str(local_path),
                train_data_path=train_data_path,
                eval_data_path=None,
                method=request.method,
                max_trials=request.max_trials,
                steps_per_trial=request.steps_per_trial,
                final_epochs=request.final_epochs,
                output_base_dir=str(settings.MODELS_DIR),
            )

            ar_result = await autoresearch_agent.run(ar_job_id, ar_config, progress_callback)

            async with AsyncSessionLocal() as session:
                stmt = select(AutoResearchJob).where(AutoResearchJob.id == ar_job_id)
                db_result = await session.execute(stmt)
                j = db_result.scalar_one()
                j.status = JobStatus.COMPLETED
                j.best_config = ar_result.get("best_config")
                j.best_loss = ar_result.get("best_trial_loss")
                j.trial_results = ar_result.get("trial_results")
                j.final_training_metrics = ar_result.get("final_training_metrics") or j.final_training_metrics
                await session.commit()

            await broadcast_to_job(ar_job_id, {"type": "ar_completed", "result": ar_result})

        except Exception as e:
            logger.error(f"AutoResearch job {ar_job_id} failed: {e}")
            async with AsyncSessionLocal() as session:
                stmt = select(AutoResearchJob).where(AutoResearchJob.id == ar_job_id)
                db_result = await session.execute(stmt)
                j = db_result.scalar_one()
                j.status = JobStatus.FAILED
                j.error_message = str(e)
                await session.commit()
            await broadcast_to_job(ar_job_id, {"type": "ar_error", "error": str(e)})

    background_tasks.add_task(run_ar)
    return {"job_id": ar_job_id, "status": "started", "name": request.name}


def _sanitize(v):
    """Replace nan/inf floats with None for JSON safety."""
    import math
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, dict):
        return {k: _sanitize(val) for k, val in v.items()}
    if isinstance(v, list):
        return [_sanitize(i) for i in v]
    return v


@router.get("/autoresearch-jobs")
async def list_autoresearch_jobs(
    skip: int = 0, limit: int = 50, db: AsyncSession = Depends(get_db)
):
    """List all AutoResearch jobs."""
    stmt = select(AutoResearchJob).offset(skip).limit(limit).order_by(AutoResearchJob.created_at.desc())
    result = await db.execute(stmt)
    jobs = result.scalars().all()
    return [
        _sanitize({
            "id": j.id,
            "name": j.name,
            "status": j.status.value if hasattr(j.status, "value") else j.status,
            "method": j.method or "lora",
            "max_trials": j.max_trials,
            "steps_per_trial": j.steps_per_trial,
            "best_loss": j.best_loss,
            "best_config": j.best_config,
            "trial_results": j.trial_results,
            "final_training_metrics": j.final_training_metrics,
            "error_message": j.error_message,
            "created_at": str(j.created_at),
        })
        for j in jobs
    ]


@router.post("/autoresearch-jobs/{job_id}/cancel")
async def cancel_autoresearch_job(job_id: int, db: AsyncSession = Depends(get_db)):
    """Cancel a running AutoResearch job."""
    stmt = select(AutoResearchJob).where(AutoResearchJob.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, detail="AutoResearch job not found")
    if job.status not in (JobStatus.PENDING, JobStatus.RUNNING):
        raise HTTPException(400, detail=f"Job is not running (status={job.status})")

    autoresearch_agent.stop()
    job.status = JobStatus.CANCELLED
    await db.commit()
    await broadcast_to_job(job_id, {"type": "ar_cancelled"})
    return {"status": "success", "message": f"AutoResearch job {job_id} cancellation requested"}


@router.delete("/autoresearch-jobs/{job_id}")
async def delete_ar_job(job_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a single AutoResearch job record and generated model files."""
    stmt = select(AutoResearchJob).where(AutoResearchJob.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, detail="AutoResearch job not found")
    if job.status in (JobStatus.RUNNING, JobStatus.PENDING):
        raise HTTPException(400, detail="Cannot delete a running job. Cancel it first.")
    _delete_autoresearch_artifacts(job.id)
    await db.delete(job)
    await db.commit()
    return {"status": "deleted", "job_id": job_id}


@router.delete("/autoresearch-jobs")
async def delete_all_ar_jobs(db: AsyncSession = Depends(get_db)):
    """Delete all non-running AutoResearch job records."""
    stmt = select(AutoResearchJob).where(
        AutoResearchJob.status.notin_([JobStatus.RUNNING, JobStatus.PENDING])
    )
    result = await db.execute(stmt)
    jobs = result.scalars().all()
    count = len(jobs)
    for job in jobs:
        _delete_autoresearch_artifacts(job.id)
        await db.delete(job)
    await db.commit()
    return {"status": "deleted", "count": count}


@router.websocket("/autoresearch-jobs/{job_id}/ws")
async def autoresearch_websocket(websocket: WebSocket, job_id: int):
    """WebSocket for real-time AutoResearch progress."""
    await websocket.accept()
    if job_id not in _ws_connections:
        _ws_connections[job_id] = []
    _ws_connections[job_id].append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        if job_id in _ws_connections:
            try:
                _ws_connections[job_id].remove(websocket)
            except ValueError:
                pass


@router.get("/jobs", response_model=List[TrainingJobResponse])
async def list_training_jobs(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """List all training jobs."""
    stmt = select(TrainingJob).offset(skip).limit(limit).order_by(TrainingJob.created_at.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/jobs/{job_id}", response_model=TrainingJobResponse)
async def get_training_job(job_id: int, db: AsyncSession = Depends(get_db)):
    """Get training job details."""
    stmt = select(TrainingJob).where(TrainingJob.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, detail="Training job not found")
    return job


@router.get("/trained-models")
async def list_trained_models(db: AsyncSession = Depends(get_db), minimal: bool = False):
    """훈련 완료/취소된 잡 목록 — 베이스 모델·데이터셋 정보 포함. AutoResearch 포함.
    minimal=true 이면 training_metrics 제외 (대용량 JSON 방지)."""
    # ── 일반 훈련 잡 ──
    stmt = (
        select(TrainingJob)
        .where(TrainingJob.status.in_([JobStatus.COMPLETED, JobStatus.CANCELLED, JobStatus.FAILED]))
        .order_by(TrainingJob.created_at.desc())
    )
    result = await db.execute(stmt)
    jobs = result.scalars().all()

    records = []
    for job in jobs:
        # 베이스 모델 정보
        model_info = None
        if job.base_model_id:
            r = await db.execute(select(ModelRecord).where(ModelRecord.id == job.base_model_id))
            m = r.scalar_one_or_none()
            if m:
                model_info = {"id": m.id, "hf_model_id": m.hf_model_id, "name": m.name,
                              "parameter_count": m.parameter_count, "local_path": m.local_path}

        # 데이터셋 정보
        dataset_info = None
        if job.dataset_id:
            r = await db.execute(select(TrainingDataset).where(TrainingDataset.id == job.dataset_id))
            ds = r.scalar_one_or_none()
            if ds:
                dataset_info = {"id": ds.id, "name": ds.name, "data_type": ds.data_type,
                                "train_count": ds.train_count, "test_count": ds.test_count,
                                "llm_provider": ds.llm_provider}

        # 출력 디렉토리 크기
        model_size_bytes = None
        merged_dir = None
        if job.output_dir:
            p = Path(job.output_dir)
            if p.exists():
                model_size_bytes = sum(f.stat().st_size for f in p.rglob("*") if f.is_file())
            # 병합 디렉토리가 이미 존재하면 포함
            merged_p = Path(str(job.output_dir) + "_merged")
            if merged_p.exists() and any(merged_p.iterdir()):
                merged_dir = str(merged_p)

        records.append(_sanitize({
            "id": job.id,
            "name": job.name,
            "status": job.status.value if hasattr(job.status, "value") else job.status,
            "method": job.method.value if hasattr(job.method, "value") else job.method,
            "config": job.config,
            "output_dir": job.output_dir,
            "merged_dir": merged_dir,
            "final_loss": job.final_loss,
            "training_metrics": None if minimal else job.training_metrics,
            "error_message": job.error_message,
            "started_at": str(job.started_at) if job.started_at else None,
            "completed_at": str(job.completed_at) if job.completed_at else None,
            "created_at": str(job.created_at),
            "model": model_info,
            "dataset": dataset_info,
            "model_size_bytes": model_size_bytes,
        }))

    # ── AutoResearch 잡 ──
    ar_stmt = (
        select(AutoResearchJob)
        .where(AutoResearchJob.status.in_([JobStatus.COMPLETED, JobStatus.CANCELLED, JobStatus.FAILED]))
        .order_by(AutoResearchJob.created_at.desc())
    )
    ar_result = await db.execute(ar_stmt)
    ar_jobs = ar_result.scalars().all()

    for ar_job in ar_jobs:
        # 베이스 모델 정보
        model_info = None
        if ar_job.base_model_id:
            r = await db.execute(select(ModelRecord).where(ModelRecord.id == ar_job.base_model_id))
            m = r.scalar_one_or_none()
            if m:
                model_info = {"id": m.id, "hf_model_id": m.hf_model_id, "name": m.name,
                              "parameter_count": m.parameter_count, "local_path": m.local_path}

        # 데이터셋 정보
        dataset_info = None
        if ar_job.dataset_id:
            r = await db.execute(select(TrainingDataset).where(TrainingDataset.id == ar_job.dataset_id))
            ds = r.scalar_one_or_none()
            if ds:
                dataset_info = {"id": ds.id, "name": ds.name, "data_type": ds.data_type,
                                "train_count": ds.train_count, "test_count": ds.test_count,
                                "llm_provider": ds.llm_provider}

        # 최종 모델 디렉토리 (autoresearch_{id}/final_model)
        final_model_path = settings.MODELS_DIR / f"autoresearch_{ar_job.id}" / "final_model"
        output_dir = str(final_model_path) if final_model_path.exists() else None
        model_size_bytes = None
        merged_dir = None
        if output_dir:
            model_size_bytes = sum(f.stat().st_size for f in final_model_path.rglob("*") if f.is_file())
            merged_p = Path(output_dir + "_merged")
            if merged_p.exists() and any(merged_p.iterdir()):
                merged_dir = str(merged_p)

        records.append(_sanitize({
            "id": ar_job.id,
            "name": ar_job.name,
            "record_type": "autoresearch",
            "status": ar_job.status.value if hasattr(ar_job.status, "value") else ar_job.status,
            "method": "autoresearch",
            "config": ar_job.best_config,
            "output_dir": output_dir,
            "merged_dir": merged_dir,
            "final_loss": ar_job.best_loss,
            "training_metrics": None if minimal else ar_job.final_training_metrics,
            "final_training_metrics": ar_job.final_training_metrics,
            "error_message": getattr(ar_job, "error_message", None),
            "started_at": None,
            "completed_at": str(ar_job.updated_at) if ar_job.updated_at else None,
            "created_at": str(ar_job.created_at),
            "model": model_info,
            "dataset": dataset_info,
            "model_size_bytes": model_size_bytes,
            # AutoResearch 전용 필드
            "max_trials": ar_job.max_trials,
            "steps_per_trial": ar_job.steps_per_trial,
            "trial_results": ar_job.trial_results,
        }))

    # 생성일 기준 내림차순 정렬
    records.sort(key=lambda r: r.get("created_at") or "", reverse=True)

    return records


@router.get("/jobs/{job_id}/download")
async def download_trained_model(job_id: int, db: AsyncSession = Depends(get_db)):
    """훈련된 모델(어댑터) 디렉토리를 zip으로 다운로드."""
    stmt = select(TrainingJob).where(TrainingJob.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, detail="Training job not found")
    if not job.output_dir:
        raise HTTPException(404, detail="No output directory recorded for this job")

    output_path = Path(job.output_dir)
    if not output_path.exists():
        raise HTTPException(404, detail=f"Output directory not found: {job.output_dir}")

    loop = asyncio.get_event_loop()

    def _create_zip() -> str:
        tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
        tmp.close()
        with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as zf:
            for fp in sorted(output_path.rglob("*")):
                if fp.is_file():
                    zf.write(fp, fp.relative_to(output_path))
        return tmp.name

    zip_path = await loop.run_in_executor(None, _create_zip)

    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in (job.name or f"job{job_id}"))
    method_str = job.method.value if hasattr(job.method, "value") else (job.method or "model")
    filename = f"NELLA_{safe_name}_{method_str}_{job_id}.zip"

    async def _stream():
        try:
            with open(zip_path, "rb") as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    yield chunk
        finally:
            Path(zip_path).unlink(missing_ok=True)

    return StreamingResponse(
        _stream(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/jobs/{job_id}/merge")
async def merge_lora_adapter(
    job_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """LoRA/QLoRA 어댑터를 베이스 모델에 병합 (백그라운드)."""
    stmt = select(TrainingJob).where(TrainingJob.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, detail="Training job not found")

    method_val = job.method.value if hasattr(job.method, "value") else job.method
    if method_val not in ("lora", "qlora"):
        raise HTTPException(400, detail="LoRA 또는 QLoRA 잡만 병합할 수 있습니다.")
    if not job.output_dir:
        raise HTTPException(400, detail="출력 디렉토리가 없습니다.")

    # Resolve base model path
    base_model_path = None
    if job.base_model_id:
        r = await db.execute(select(ModelRecord).where(ModelRecord.id == job.base_model_id))
        m = r.scalar_one_or_none()
        if m:
            base_model_path = m.local_path or hf_registry.get_local_path(m.hf_model_id)

    if not base_model_path:
        raise HTTPException(400, detail="베이스 모델 경로를 찾을 수 없습니다. 모델이 다운로드되었는지 확인하세요.")

    adapter_path = job.output_dir
    merged_dir = str(Path(adapter_path).parent / (Path(adapter_path).name + "_merged"))

    _merge_state[job_id] = {
        "status": "pending", "percent": 0,
        "message": "병합 준비 중...", "done": False,
        "error": None, "merged_dir": None,
    }

    async def run_merge():
        loop = asyncio.get_event_loop()

        def _do_merge():
            try:
                _merge_state[job_id].update({"status": "merging", "percent": 10, "message": "토크나이저 로드 중..."})
                from transformers import AutoTokenizer, AutoModelForCausalLM
                from peft import PeftModel

                tokenizer = AutoTokenizer.from_pretrained(base_model_path)

                _merge_state[job_id].update({"percent": 25, "message": "베이스 모델 로드 중..."})
                base_model = AutoModelForCausalLM.from_pretrained(
                    base_model_path, torch_dtype="auto", low_cpu_mem_usage=True
                )

                _merge_state[job_id].update({"percent": 55, "message": "LoRA 어댑터 적용 중..."})
                model = PeftModel.from_pretrained(base_model, adapter_path)

                _merge_state[job_id].update({"percent": 75, "message": "가중치 병합 중 (merge_and_unload)..."})
                model = model.merge_and_unload()

                _merge_state[job_id].update({"percent": 90, "message": "병합 모델 저장 중..."})
                Path(merged_dir).mkdir(parents=True, exist_ok=True)
                model.save_pretrained(merged_dir)
                tokenizer.save_pretrained(merged_dir)

                _merge_state[job_id].update({
                    "status": "done", "percent": 100,
                    "message": "병합 완료!", "done": True,
                    "merged_dir": merged_dir,
                })
            except Exception as e:
                logger.error(f"Merge job {job_id} failed: {e}")
                _merge_state[job_id].update({
                    "status": "error", "percent": 0,
                    "message": f"병합 실패: {e}", "done": True,
                    "error": str(e),
                })

        await loop.run_in_executor(None, _do_merge)

    background_tasks.add_task(run_merge)
    return {"status": "started", "message": "병합이 백그라운드에서 시작되었습니다."}


@router.get("/jobs/{job_id}/merge-progress")
async def merge_progress_sse(job_id: int):
    """SSE 스트림 — LoRA 병합 진행 상황."""
    async def generate():
        # Send initial heartbeat
        yield f"data: {json.dumps({'heartbeat': True})}\n\n"
        while True:
            state = _merge_state.get(job_id)
            if state is None:
                yield f"data: {json.dumps({'message': '병합 상태 없음', 'percent': 0, 'done': True, 'error': '병합을 먼저 시작하세요.'})}\n\n"
                break
            yield f"data: {json.dumps(state)}\n\n"
            if state.get("done"):
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/jobs/{job_id}/merged-download")
async def download_merged_model(job_id: int, db: AsyncSession = Depends(get_db)):
    """병합된 모델 디렉토리를 zip으로 다운로드."""
    # 1) 현재 세션의 merge_state 확인
    state = _merge_state.get(job_id)
    merged_dir_str = state.get("merged_dir") if state else None

    # 2) 없으면 DB의 output_dir에서 _merged 디렉토리 유추
    if not merged_dir_str:
        stmt = select(TrainingJob).where(TrainingJob.id == job_id)
        result = await db.execute(stmt)
        job = result.scalar_one_or_none()
        if job and job.output_dir:
            candidate = str(job.output_dir) + "_merged"
            if Path(candidate).exists():
                merged_dir_str = candidate

    if not merged_dir_str:
        raise HTTPException(404, detail="병합된 모델이 없습니다. 먼저 병합을 실행하세요.")

    merged_path = Path(merged_dir_str)
    if not merged_path.exists():
        raise HTTPException(404, detail=f"병합 디렉토리를 찾을 수 없습니다: {merged_dir_str}")

    loop = asyncio.get_event_loop()

    def _create_zip() -> str:
        tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
        tmp.close()
        with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as zf:
            for fp in sorted(merged_path.rglob("*")):
                if fp.is_file():
                    zf.write(fp, fp.relative_to(merged_path))
        return tmp.name

    zip_path = await loop.run_in_executor(None, _create_zip)
    filename = f"NELLA_merged_{job_id}.zip"

    async def _stream():
        try:
            with open(zip_path, "rb") as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    yield chunk
        finally:
            Path(zip_path).unlink(missing_ok=True)

    return StreamingResponse(
        _stream(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/jobs/{job_id}/cancel", response_model=StatusResponse)
async def cancel_training_job(job_id: int, db: AsyncSession = Depends(get_db)):
    """Cancel a running training job."""
    stmt = select(TrainingJob).where(TrainingJob.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, detail="Training job not found")
    if job.status not in (JobStatus.PENDING, JobStatus.RUNNING):
        raise HTTPException(400, detail=f"Job is not running (status={job.status})")

    cancelled = training_agent.cancel_job(job_id)
    if cancelled:
        job.status = JobStatus.CANCELLED
        await db.commit()
        return StatusResponse(status="success", message=f"Job {job_id} cancelled")
    return StatusResponse(status="error", message="Could not cancel job")


@router.delete("/jobs/{job_id}")
async def delete_training_job(job_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a training job record and generated model files."""
    stmt = select(TrainingJob).where(TrainingJob.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, detail="Training job not found")
    if job.status in (JobStatus.RUNNING, JobStatus.PENDING):
        raise HTTPException(400, detail="Cannot delete a running job. Cancel it first.")
    _delete_training_job_artifacts(job)
    await db.delete(job)
    await db.commit()
    return {"status": "deleted", "job_id": job_id}


@router.delete("/jobs")
async def delete_all_training_jobs(db: AsyncSession = Depends(get_db)):
    """Delete all non-running training job records."""
    stmt = select(TrainingJob).where(TrainingJob.status.notin_([JobStatus.RUNNING, JobStatus.PENDING]))
    result = await db.execute(stmt)
    jobs = result.scalars().all()
    count = len(jobs)
    for job in jobs:
        _delete_training_job_artifacts(job)
        await db.delete(job)
    await db.commit()
    return {"status": "deleted", "count": count}


@router.get("/jobs/{job_id}/thread")
async def get_job_thread(job_id: int):
    """Get OS thread ID of a running training job (useful for kill -9 from terminal)."""
    tid = training_agent.get_thread_id(job_id)
    return {
        "job_id": job_id,
        "thread_id": tid,
        "kill_command": f"kill -9 {tid}" if tid else None,
    }


@router.post("/jobs/{job_id}/kill", response_model=StatusResponse)
async def kill_job_thread(job_id: int, db: AsyncSession = Depends(get_db)):
    """Force-kill the training thread via SystemExit injection (last resort)."""
    stmt = select(TrainingJob).where(TrainingJob.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, detail="Training job not found")

    killed = training_agent.kill_thread(job_id)
    if killed:
        job.status = JobStatus.CANCELLED
        job.error_message = "Force-killed by user"
        job.completed_at = datetime.utcnow()
        await db.commit()
        await broadcast_to_job(job_id, {"type": "cancelled"})
        return StatusResponse(status="success", message=f"Job {job_id} force-killed")
    return StatusResponse(status="error", message="Could not kill job thread (not running?)")


@router.websocket("/jobs/{job_id}/ws")
async def training_websocket(websocket: WebSocket, job_id: int):
    """WebSocket endpoint for real-time training updates."""
    await websocket.accept()

    if job_id not in _ws_connections:
        _ws_connections[job_id] = []
    _ws_connections[job_id].append(websocket)

    try:
        while True:
            # Keep connection alive, receive pings
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        if job_id in _ws_connections:
            _ws_connections[job_id].remove(websocket)
