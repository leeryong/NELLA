"""
Model evaluation API endpoints.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from backend.database import (
    get_db, TrainingJob, EvaluationResult, JobStatus, AsyncSessionLocal
)
from backend.schemas.models import (
    RunEvaluationRequest, EvaluationResponse, StatusResponse
)
from backend.agents.eval_agent import eval_agent
from loguru import logger

router = APIRouter(prefix="/evaluation", tags=["evaluation"])

# Strong references to prevent GC from cancelling background tasks
_background_tasks: set = set()
# Map eval_id -> asyncio.Task for cancellation
_running_tasks: dict = {}
# In-memory progress tracking
_eval_progress: dict = {}  # eval_id -> {"pct": int, "step": str, "done": bool}

def _make_progress_cb(eval_id: int):
    """평가 진행률을 in-memory 저장소에 기록한다. 추론 스레드에서도 호출되므로 sync."""
    def _cb(pct: int, msg: str) -> None:
        prev = _eval_progress.get(eval_id, {})
        if prev.get("done"):
            return
        _eval_progress[eval_id] = {"pct": int(pct), "step": str(msg), "done": False}
    return _cb


@router.post("/run", response_model=EvaluationResponse)
async def run_evaluation(
    request: RunEvaluationRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Run evaluation on a trained model."""
    # Get training job
    stmt = select(TrainingJob).where(TrainingJob.id == request.training_job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, detail="Training job not found")
    if job.status != JobStatus.COMPLETED:
        raise HTTPException(400, detail="Training job must be completed before evaluation")
    if not job.output_dir:
        raise HTTPException(400, detail="No model output directory found")

    # Get test data path — use dataset_id override if provided
    from backend.database import TrainingDataset
    dataset_id = request.dataset_id if request.dataset_id else job.dataset_id
    stmt = select(TrainingDataset).where(TrainingDataset.id == dataset_id)
    result = await db.execute(stmt)
    dataset = result.scalar_one_or_none()
    if not dataset or not dataset.test_path:
        raise HTTPException(400, detail="No test data available for evaluation")

    # Create evaluation record
    eval_record = EvaluationResult(
        training_job_id=request.training_job_id,
        model_path=job.output_dir,
        sample_count=0,
    )
    db.add(eval_record)
    await db.flush()
    await db.refresh(eval_record)
    eval_id = eval_record.id
    await db.commit()

    _eval_progress[eval_id] = {"pct": 0, "step": "평가 시작 중...", "done": False}

    # Run evaluation in background
    async def run_eval():
        import traceback as _tb
        logger.info(f"[run_eval] starting eval_id={eval_id} job={request.training_job_id} model={job.output_dir}")
        try:
            results = await eval_agent.run_evaluation(
                training_job_id=request.training_job_id,
                model_path=job.output_dir,
                test_data_path=dataset.test_path,
                use_llm_judge=request.use_llm_judge,
                sample_limit=request.sample_limit,
                progress_cb=_make_progress_cb(eval_id),
            )
            logger.info(f"[run_eval] completed eval_id={eval_id} sample_count={results.get('sample_count')}")

            async with AsyncSessionLocal() as session:
                stmt = select(EvaluationResult).where(EvaluationResult.id == eval_id)
                db_result = await session.execute(stmt)
                record = db_result.scalar_one()
                record.bleu_score = results.get("bleu")
                record.rouge1_score = results.get("rouge1")
                record.rouge2_score = results.get("rouge2")
                record.rougeL_score = results.get("rougeL")
                record.perplexity = results.get("perplexity")
                record.llm_judge_score = results.get("llm_judge_score")
                record.sample_count = results.get("sample_count", 0)
                record.metrics_detail = {
                    "completed": True,
                    "error": None,
                    "predictions_sample": results.get("predictions_sample", [])
                }
                await session.commit()
            _eval_progress[eval_id] = {"pct": 100, "step": "평가 완료", "done": True}

        except Exception as e:
            _eval_progress[eval_id] = {"pct": 0, "step": f"오류: {str(e)[:80]}", "done": True, "error": True}
            logger.error(f"Evaluation failed: {e}\n{_tb.format_exc()}")
            with open("/tmp/eval-error.log", "a") as _f:
                _f.write(f"eval_id={eval_id} error: {e}\n{_tb.format_exc()}\n")
            async with AsyncSessionLocal() as session:
                stmt = select(EvaluationResult).where(EvaluationResult.id == eval_id)
                db_result = await session.execute(stmt)
                record = db_result.scalar_one_or_none()
                if record:
                    record.metrics_detail = {"completed": False, "error": str(e)}
                    await session.commit()

    # Keep a strong reference to prevent GC from cancelling the task
    import asyncio as _asyncio
    task = _asyncio.create_task(run_eval())
    _background_tasks.add(task)
    _running_tasks[eval_id] = task

    def _on_done(t):
        _background_tasks.discard(t)
        _running_tasks.pop(eval_id, None)

    task.add_done_callback(_on_done)
    return eval_record


@router.post("/run-ar")
async def run_ar_evaluation(
    autoresearch_job_id: int,
    sample_limit: int = 10,
    use_llm_judge: bool = False,
    dataset_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
):
    """Run evaluation directly on an AutoResearch job's final model."""
    from backend.database import AutoResearchJob, TrainingDataset
    from pathlib import Path
    from backend.config import settings

    stmt = select(AutoResearchJob).where(AutoResearchJob.id == autoresearch_job_id)
    result = await db.execute(stmt)
    ar_job = result.scalar_one_or_none()
    if not ar_job:
        raise HTTPException(404, detail="AutoResearch job not found")
    if ar_job.status not in (JobStatus.COMPLETED, "COMPLETED", "completed"):
        raise HTTPException(400, detail="AutoResearch job is not completed")

    final_model_path = str(settings.DATA_DIR / "models" / f"autoresearch_{autoresearch_job_id}" / "final_model")
    if not Path(final_model_path).exists():
        raise HTTPException(404, detail=f"Final model not found at {final_model_path}")

    ds_id = dataset_id if dataset_id else ar_job.dataset_id
    stmt = select(TrainingDataset).where(TrainingDataset.id == ds_id)
    result = await db.execute(stmt)
    dataset = result.scalar_one_or_none()
    if not dataset or not dataset.test_path:
        raise HTTPException(400, detail="No test data available for evaluation")

    # Create evaluation record immediately so it appears in UI
    eval_record = EvaluationResult(
        training_job_id=None,
        model_path=final_model_path,
        sample_count=0,
        metrics_detail={"completed": False, "autoresearch_job_id": autoresearch_job_id},
    )
    try:
        eval_record.autoresearch_job_id = autoresearch_job_id
    except Exception:
        pass
    db.add(eval_record)
    await db.flush()
    await db.refresh(eval_record)
    eval_id = eval_record.id
    await db.commit()

    _eval_progress[eval_id] = {"pct": 0, "step": "평가 시작 중...", "done": False}

    async def run_eval():
        import traceback as _tb
        try:
            results = await eval_agent.run_evaluation(
                training_job_id=0,
                model_path=final_model_path,
                test_data_path=dataset.test_path,
                use_llm_judge=use_llm_judge,
                sample_limit=sample_limit,
                progress_cb=_make_progress_cb(eval_id),
            )
            async with AsyncSessionLocal() as session:
                stmt2 = select(EvaluationResult).where(EvaluationResult.id == eval_id)
                db_result = await session.execute(stmt2)
                record = db_result.scalar_one()
                record.bleu_score = results.get("bleu")
                record.rouge1_score = results.get("rouge1")
                record.rouge2_score = results.get("rouge2")
                record.rougeL_score = results.get("rougeL")
                record.perplexity = results.get("perplexity")
                record.llm_judge_score = results.get("llm_judge_score")
                record.sample_count = results.get("sample_count", 0)
                record.metrics_detail = {
                    "completed": True,
                    "autoresearch_job_id": autoresearch_job_id,
                    "dataset": dataset.name,
                    "predictions_sample": results.get("predictions_sample", [])[:3],
                }
                await session.commit()
            _eval_progress[eval_id] = {"pct": 100, "step": "평가 완료", "done": True}
        except Exception as e:
            _eval_progress[eval_id] = {"pct": 0, "step": f"오류: {str(e)[:80]}", "done": True, "error": True}
            logger.error(f"AR evaluation failed: {e}\n{_tb.format_exc()}")
            async with AsyncSessionLocal() as session:
                stmt2 = select(EvaluationResult).where(EvaluationResult.id == eval_id)
                db_result = await session.execute(stmt2)
                record = db_result.scalar_one_or_none()
                if record:
                    record.metrics_detail = {"completed": False, "error": str(e)}
                    await session.commit()

    import asyncio as _asyncio
    task = _asyncio.create_task(run_eval())
    _background_tasks.add(task)
    _running_tasks[eval_id] = task
    task.add_done_callback(lambda t: (_background_tasks.discard(t), _running_tasks.pop(eval_id, None)))

    return {"eval_id": eval_id, "status": "started", "model_path": final_model_path}


@router.get("/active")
async def list_active_evaluations():
    """현재 진행 중인 평가 목록 (Evaluation 페이지가 mount 후 자동으로 NELLA의 진행 중인 평가를 잡도록 사용).
    `_eval_progress` 메모리 dict에서 done=False인 항목만 반환."""
    active: list[dict] = []
    for eval_id, prog in _eval_progress.items():
        if prog.get("done"):
            continue
        active.append({
            "eval_id": eval_id,
            "pct": prog.get("pct", 0),
            "step": prog.get("step", ""),
            "done": False,
        })
    return active


@router.get("/progress/{eval_id}")
async def get_eval_progress(eval_id: int):
    """Get in-memory progress of a running evaluation (pct 0-100, step message, done flag)."""
    progress = _eval_progress.get(eval_id)
    if progress is None:
        return {"pct": 100, "step": "완료 (캐시 없음)", "done": True}
    return progress


@router.get("/", response_model=List[EvaluationResponse])
async def list_evaluations(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """List all evaluation results."""
    stmt = select(EvaluationResult).offset(skip).limit(limit).order_by(
        EvaluationResult.created_at.desc()
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/job/{job_id}", response_model=List[EvaluationResponse])
async def get_job_evaluations(job_id: int, db: AsyncSession = Depends(get_db)):
    """Get all evaluations for a training job."""
    stmt = select(EvaluationResult).where(EvaluationResult.training_job_id == job_id)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{eval_id}", response_model=EvaluationResponse)
async def get_evaluation(eval_id: int, db: AsyncSession = Depends(get_db)):
    """Get evaluation result by ID."""
    stmt = select(EvaluationResult).where(EvaluationResult.id == eval_id)
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(404, detail="Evaluation not found")
    return record


@router.get("/{eval_id}/report")
async def get_evaluation_report(eval_id: int, db: AsyncSession = Depends(get_db)):
    """Get human-readable evaluation report."""
    stmt = select(EvaluationResult).where(EvaluationResult.id == eval_id)
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(404, detail="Evaluation not found")

    metrics = {
        "bleu": record.bleu_score,
        "rouge1": record.rouge1_score,
        "rouge2": record.rouge2_score,
        "rougeL": record.rougeL_score,
        "perplexity": record.perplexity,
        "llm_judge_score": record.llm_judge_score,
        "sample_count": record.sample_count,
    }
    if record.metrics_detail:
        metrics.update(record.metrics_detail)

    report = eval_agent.format_results_report(metrics)
    return {"eval_id": eval_id, "report": report, "metrics": metrics}


@router.post("/{eval_id}/cancel")
async def cancel_evaluation(eval_id: int, db: AsyncSession = Depends(get_db)):
    """Cancel a running evaluation."""
    task = _running_tasks.pop(eval_id, None)
    if task and not task.done():
        task.cancel()
    _eval_progress[eval_id] = {"pct": 0, "step": "평가가 취소되었습니다.", "done": True, "error": True}
    # Mark as error in DB if still pending
    stmt = select(EvaluationResult).where(EvaluationResult.id == eval_id)
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()
    if record:
        record.metrics_detail = {"completed": False, "error": "사용자가 취소했습니다"}
        await db.commit()
    return {"status": "cancelled", "eval_id": eval_id}


@router.delete("/{eval_id}")
async def delete_evaluation(eval_id: int, db: AsyncSession = Depends(get_db)):
    """Cancel if running, then delete evaluation result."""
    # Cancel running task first
    task = _running_tasks.pop(eval_id, None)
    if task and not task.done():
        task.cancel()
    stmt = select(EvaluationResult).where(EvaluationResult.id == eval_id)
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(404, detail="Evaluation not found")
    await db.delete(record)
    await db.commit()
    return {"status": "deleted", "eval_id": eval_id}


@router.delete("/")
async def delete_all_evaluations(db: AsyncSession = Depends(get_db)):
    """Cancel all running evaluations and delete all results."""
    for task in list(_running_tasks.values()):
        if not task.done():
            task.cancel()
    _running_tasks.clear()
    stmt = select(EvaluationResult)
    result = await db.execute(stmt)
    records = result.scalars().all()
    count = len(records)
    for record in records:
        await db.delete(record)
    await db.commit()
    return {"status": "deleted", "count": count}
