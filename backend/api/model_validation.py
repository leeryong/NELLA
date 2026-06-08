"""
Scout-based model validation endpoints.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import BASE_DIR, settings
from backend.database import ModelRecord, TrainingDataset, get_db
from backend.agents.model_validation_agent import model_validation_agent, model_short_name
from backend.services.evaluator import model_evaluator
from backend.api.training import _resolve_train_path


router = APIRouter(prefix="/model-validation", tags=["model-validation"])

SCOUT_DIR = BASE_DIR / "backend" / "scout"
REFERENCE_TCM_DIR = SCOUT_DIR / "nella_reference_tcm_10pct_25bins"

# Cancellation state. Keyed by the primary dataset id of the running validation.
_scout_tasks: dict[int, asyncio.Task] = {}
_scout_cancelled: set[int] = set()


class ScoutValidationRequest(BaseModel):
    # 단일/다중 데이터셋 모두 허용. dataset_ids가 비면 dataset_id에서 보충.
    dataset_id: Optional[int] = None
    dataset_ids: list[int] = Field(default_factory=list)
    model_ids: list[str] = Field(min_length=1)
    selection_mode: Literal["final_score", "improvement"] = "improvement"
    judge_provider: Optional[Literal["openai", "anthropic", "ollama", "mock"]] = None
    sample_limit: int = Field(default=10, ge=1)

    @validator("dataset_ids", pre=True, always=True)
    def coerce_dataset_ids(cls, v, values):
        if v:
            return [int(x) for x in v]
        legacy = values.get("dataset_id")
        return [int(legacy)] if legacy else []


async def _run_command(cmd: list[str], cwd: Path) -> str:
    # Cython 컴파일된 scout 모듈을 `python -m backend.scout.X` 로 호출할 수 있도록
    # PYTHONPATH 에 프로젝트 루트(BASE_DIR)를 끼워둔다. cwd 는 SCOUT_DIR 유지 →
    # scout 스크립트 내부의 `./mmlu/...`, `./biomistral-...jsonl` 등 상대경로 호환.
    existing_pp = os.environ.get("PYTHONPATH", "")
    pythonpath = str(BASE_DIR) + (os.pathsep + existing_pp if existing_pp else "")
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(cwd),
        env={
            **os.environ,
            "PYTHONPATH": pythonpath,
            "OLAPH_JSONL": str(SCOUT_DIR / "biomistral-7b_wo-healthsearch_qa_train_iter_sft_step1.jsonl"),
        },
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout_bytes, stderr_bytes = await proc.communicate()
    except asyncio.CancelledError:
        proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), timeout=5)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
        raise

    stdout = stdout_bytes.decode(errors="replace")
    stderr = stderr_bytes.decode(errors="replace")
    if proc.returncode != 0:
        raise RuntimeError(
            f"Command failed ({proc.returncode}): {' '.join(cmd)}\n"
            f"STDOUT:\n{stdout}\nSTDERR:\n{stderr}"
        )
    return stdout


def _emit_agent_progress(**payload) -> None:
    """Best-effort bridge to the NELLA agent UI progress endpoint."""
    try:
        from backend.api.chat import _set_agent_progress
        _set_agent_progress("model-validation", **payload)
    except Exception:
        pass


def _model_short_name(model_id: str) -> str:
    return model_short_name(model_id)


async def _resolve_model_path(db: AsyncSession, model_id: str) -> str:
    result = await db.execute(select(ModelRecord).where(ModelRecord.hf_model_id == model_id))
    record = result.scalar_one_or_none()
    if record and record.local_path:
        local = Path(record.local_path)
        if not local.is_absolute():
            local = settings.BASE_DIR / local
        if local.exists():
            return str(local)
    return model_id


async def _score_base_models_with_judge(
    db: AsyncSession,
    model_ids: list[str],
    test_data_path: str,
    provider: str,
    sample_limit: int,
) -> dict[str, float | None]:
    from backend.services.llm_service import LLMService

    judge = LLMService(provider=provider)
    scores: dict[str, float | None] = {}
    for model_id in model_ids:
        model_path = await _resolve_model_path(db, model_id)
        try:
            test_data = model_evaluator._load_test_data(test_data_path, sample_limit)
            predictions, _references = await model_evaluator._generate_predictions(model_path, test_data)
            sample_scores = []
            for item, pred in zip(test_data[:sample_limit], predictions[:sample_limit]):
                prompt, reference = model_evaluator._extract_prompt_and_reference(item)
                if not prompt or not reference:
                    continue
                judged = await judge.judge_response(prompt, reference, pred)
                sample_scores.append(float(judged.get("score", 5.0)))
            scores[_model_short_name(model_id)] = (
                sum(sample_scores) / len(sample_scores) if sample_scores else None
            )
        except Exception:
            scores[_model_short_name(model_id)] = None
    return scores


class ScoutCancelRequest(BaseModel):
    dataset_id: int


@router.post("/scout/cancel")
async def cancel_scout_validation(req: ScoutCancelRequest):
    """Cancel an in-flight scout validation run keyed by its primary dataset id."""
    primary_id = req.dataset_id
    _scout_cancelled.add(primary_id)
    task = _scout_tasks.get(primary_id)
    if task and not task.done():
        task.cancel()
        return {"status": "cancelling", "dataset_id": primary_id}
    _scout_cancelled.discard(primary_id)
    return {"status": "no_active_job", "dataset_id": primary_id}


@router.post("/scout")
async def run_scout_validation(
    request: ScoutValidationRequest,
    db: AsyncSession = Depends(get_db),
):
    if not request.dataset_ids:
        raise HTTPException(400, detail="dataset_id 또는 dataset_ids는 필수입니다.")
    # 다중 데이터셋: training의 _resolve_train_path를 재사용해 JSONL을 1개로 병합.
    primary_id, train_path = await _resolve_train_path(db, request.dataset_ids)
    # Register this run for cancellation. Replace any prior stale entry for the same primary_id.
    _scout_cancelled.discard(primary_id)
    prior = _scout_tasks.get(primary_id)
    if prior and not prior.done():
        prior.cancel()
    current = asyncio.current_task()
    _scout_tasks[primary_id] = current

    def _on_done(task: asyncio.Task, _pid: int = primary_id) -> None:
        _scout_tasks.pop(_pid, None)
        was_requested = _pid in _scout_cancelled
        _scout_cancelled.discard(_pid)
        if task.cancelled() or was_requested:
            _emit_agent_progress(
                status="failed",
                phase="cancelled",
                percent=0,
                message="사용자 요청으로 검증이 중단되었습니다.",
                dataset_id=_pid,
            )

    if current is not None:
        current.add_done_callback(_on_done)
    dataset_result = await db.execute(select(TrainingDataset).where(TrainingDataset.id == primary_id))
    dataset = dataset_result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(404, detail="Dataset not found")
    if request.selection_mode == "final_score" and not request.judge_provider:
        raise HTTPException(400, detail="LLM Judge provider is required for final-score mode")
    if not SCOUT_DIR.exists():
        raise HTTPException(500, detail=f"Scout directory not found: {SCOUT_DIR}")
    if not REFERENCE_TCM_DIR.exists():
        raise HTTPException(500, detail=f"Reference TCM directory not found: {REFERENCE_TCM_DIR}")

    # 병합된 데이터셋이면 모든 dataset의 train_count 합계, 단일이면 그대로
    total_samples = 0
    dataset_names: list[str] = []
    for ds_id in request.dataset_ids:
        _r = await db.execute(select(TrainingDataset).where(TrainingDataset.id == ds_id))
        _ds = _r.scalar_one_or_none()
        if _ds:
            total_samples += int(_ds.train_count or 0)
            dataset_names.append(_ds.name)
    available_samples = total_samples or (dataset.train_count or 1)
    sample_limit = max(1, min(request.sample_limit, max(available_samples, 1)))

    job_id_suffix = "_".join(str(i) for i in request.dataset_ids)
    job_root = settings.DATA_DIR / "model_validation" / f"dataset_{job_id_suffix}"
    raw_dir = job_root / "raw_tcm"
    resampled_dir = job_root / "resampled_tcm"
    prediction_dir = job_root / "prediction"
    model_validation_agent.prepare_run_dirs(raw_dir, resampled_dir, prediction_dir)

    target_name = f"nella_dataset_{job_id_suffix}"
    models_arg = [m for m in request.model_ids if m.strip()]

    total_models = len(models_arg)
    for idx, model_id in enumerate(models_arg, 1):
        base_percent = 8 + int((idx - 1) / max(total_models, 1) * 52)
        _emit_agent_progress(
            status="running",
            phase="extracting",
            percent=base_percent,
            message=f"모델의 내부 반응 추출 중: {model_id} ({idx}/{total_models})",
            dataset_id=dataset.id,
            dataset_ids=list(request.dataset_ids),
            dataset_name=dataset.name,
            dataset_names=dataset_names,
            model_ids=models_arg,
            current_model=model_id,
            current_model_index=idx,
            total_models=total_models,
            completed_models=models_arg[:idx - 1],
            selection_mode=request.selection_mode,
            sample_limit=sample_limit,
        )
        await _run_command(
            [
                sys.executable, "-m", "backend.scout._run_extract",
                "--input-jsonl",
                str(train_path),
                "--target-name",
                target_name,
                "--outdir",
                str(raw_dir),
                "--models",
                model_id,
            ],
            SCOUT_DIR,
        )
        _emit_agent_progress(
            status="running",
            phase="extracting",
            percent=8 + int(idx / max(total_models, 1) * 52),
            message=f"모델의 내부 반응 추출 완료: {model_id} ({idx}/{total_models})",
            dataset_id=dataset.id,
            dataset_ids=list(request.dataset_ids),
            dataset_name=dataset.name,
            dataset_names=dataset_names,
            model_ids=models_arg,
            current_model=model_id,
            current_model_index=idx,
            total_models=total_models,
            completed_models=models_arg[:idx],
            selection_mode=request.selection_mode,
            sample_limit=sample_limit,
        )
    _emit_agent_progress(
        status="running",
        phase="resampling",
        percent=68,
        message="모델의 내부 반응을 리샘플링하고 있습니다.",
        dataset_id=dataset.id,
        dataset_name=dataset.name,
        model_ids=models_arg,
        total_models=total_models,
        completed_models=models_arg,
        selection_mode=request.selection_mode,
        sample_limit=sample_limit,
    )
    await _run_command(
        [
            sys.executable, "-m", "backend.scout._run_resample",
            "--src-root",
            str(raw_dir),
            "--out-root",
            str(resampled_dir),
        ],
        SCOUT_DIR,
    )
    _emit_agent_progress(
        status="running",
        phase="predicting",
        percent=82,
        message="후보 모델 순위를 예측하고 있습니다.",
        dataset_id=dataset.id,
        dataset_name=dataset.name,
        model_ids=models_arg,
        total_models=total_models,
        completed_models=models_arg,
        selection_mode=request.selection_mode,
        sample_limit=sample_limit,
    )
    await _run_command(
        [
            sys.executable, "-m", "backend.scout._run_prediction",
            "--target-jsonl",
            str(train_path),
            "--candidate-tcm-root",
            str(resampled_dir),
            "--reference-tcm-root",
            str(REFERENCE_TCM_DIR),
            "--outdir",
            str(prediction_dir),
            "--rf-cache-dir",
            str(job_root / "rf_cache"),
        ],
        SCOUT_DIR,
    )

    prediction_path = prediction_dir / "predictions.json"
    if not prediction_path.exists():
        raise HTTPException(500, detail="Prediction output was not created")
    payload = json.loads(prediction_path.read_text(encoding="utf-8"))
    predictions = model_validation_agent.filter_predictions(payload.get("predictions", []), models_arg)

    judge_scores: dict[str, float | None] = {}
    if request.selection_mode == "final_score":
        _emit_agent_progress(
            status="running",
            phase="judging",
            percent=90,
            message="LLM Judge로 후보 모델 응답 품질을 채점하고 있습니다.",
            dataset_id=dataset.id,
            dataset_ids=list(request.dataset_ids),
            dataset_name=dataset.name,
            dataset_names=dataset_names,
            model_ids=models_arg,
            total_models=total_models,
            completed_models=models_arg,
            selection_mode=request.selection_mode,
            sample_limit=sample_limit,
        )
        eval_path = train_path
        judge_scores = await _score_base_models_with_judge(
            db=db,
            model_ids=request.model_ids,
            test_data_path=str(eval_path),
            provider=request.judge_provider or "mock",
            sample_limit=sample_limit,
        )
        for row in predictions:
            model_id = str(row.get("model") or "")
            base_score = judge_scores.get(model_id) or judge_scores.get(_model_short_name(model_id))
            row["base_judge_score"] = base_score
            row["estimated_final_score"] = (
                float(base_score) * (1.0 + float(row.get("predicted_delta", 0.0)))
                if base_score is not None else None
            )
        predictions.sort(
            key=lambda row: row.get("estimated_final_score") if row.get("estimated_final_score") is not None else -1e9,
            reverse=True,
        )
        for idx, row in enumerate(predictions, 1):
            row["rank"] = idx
    else:
        for row in predictions:
            row["base_judge_score"] = None
            row["estimated_final_score"] = None

    _emit_agent_progress(
        status="completed",
        phase="done",
        percent=100,
        message="모델 검증이 완료되었습니다.",
        dataset_id=dataset.id,
        dataset_ids=list(request.dataset_ids),
        dataset_name=dataset.name,
        dataset_names=dataset_names,
        model_ids=models_arg,
        total_models=total_models,
        completed_models=models_arg,
        selection_mode=request.selection_mode,
        sample_limit=sample_limit,
        predictions=predictions,
    )

    return {
        "dataset_id": dataset.id,
        "dataset_ids": list(request.dataset_ids),
        "dataset_name": dataset.name,
        "dataset_names": dataset_names,
        "selection_mode": request.selection_mode,
        "judge_provider": request.judge_provider if request.selection_mode == "final_score" else None,
        "sample_limit": sample_limit,
        "meta": payload.get("meta", {}),
        "predictions": predictions,
        "artifacts": {
            "raw_tcm_dir": str(raw_dir),
            "resampled_tcm_dir": str(resampled_dir),
            "prediction_dir": str(prediction_dir),
        },
    }
