"""
Benchmark evaluation endpoints (lm-evaluation-harness).

One user request becomes N rows in benchmark_runs (one per model). The N rows
share a `group_id` so the UI/cancel can address the whole batch as a unit.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import (
    AsyncSessionLocal,
    AutoResearchJob,
    BenchmarkRun,
    JobStatus,
    ModelRecord,
    TrainingJob,
    get_db,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/benchmark", tags=["benchmark"])

# Cancellation state. group_id is shared across all rows of one user request.
_benchmark_tasks: dict[str, asyncio.Task] = {}
_benchmark_cancelled: set[str] = set()
_benchmark_processes: dict[str, asyncio.subprocess.Process] = {}

# Live progress per run_id, populated as we stream lm_eval's stdout/stderr.
# Keyed by BenchmarkRun.id → {"percent": int|None, "message": str|None}
_benchmark_progress: dict[int, dict] = {}

# Match tqdm's "  37%|████" segment in any line.
_TQDM_PERCENT_RE = re.compile(r"(\d{1,3})%\|")
# Split a byte chunk on either \r (tqdm carriage return) or \n.
_LINE_SPLIT_RE = re.compile(rb"[\r\n]")


def _emit_progress(**payload) -> None:
    try:
        from backend.api.chat import _set_agent_progress
        _set_agent_progress("benchmark", **payload)
    except Exception:
        pass


async def _resolve_model_path(model_id: str) -> str:
    """벤치마크 model_id를 실제 체크포인트 경로(or HF id)로 변환한다.

    지원 형식:
    - "sft:<job_id>" → TrainingJob.output_dir (LoRA면 어댑터 디렉터리)
    - "ar:<job_id>"  → autoresearch_{id}/final_model
    - 일반 HF id      → ModelRecord.local_path 가 있으면 로컬 경로, 아니면 HF id 그대로
    """
    if model_id.startswith("sft:"):
        try:
            job_id = int(model_id.split(":", 1)[1])
        except ValueError:
            return model_id
        async with AsyncSessionLocal() as session:
            job = await session.get(TrainingJob, job_id)
        if not job or not job.output_dir:
            raise RuntimeError(f"훈련 작업 #{job_id} 의 output_dir 을 찾을 수 없습니다.")
        local = Path(job.output_dir)
        if not local.is_absolute():
            local = settings.BASE_DIR / local
        if not local.exists():
            raise RuntimeError(f"훈련 작업 #{job_id} 의 모델 경로가 존재하지 않습니다: {local}")
        return str(local)
    if model_id.startswith("ar:"):
        try:
            job_id = int(model_id.split(":", 1)[1])
        except ValueError:
            return model_id
        local = settings.DATA_DIR / "models" / f"autoresearch_{job_id}" / "final_model"
        if not local.exists():
            raise RuntimeError(f"AutoResearch #{job_id} 의 final_model 경로가 존재하지 않습니다: {local}")
        return str(local)
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(ModelRecord).where(ModelRecord.hf_model_id == model_id)
        )
        record = result.scalar_one_or_none()
    if record and record.local_path:
        local = Path(record.local_path)
        if not local.is_absolute():
            local = settings.BASE_DIR / local
        if local.exists():
            return str(local)
    return model_id


def _is_valid_model_dir(p: Path) -> bool:
    """transformers from_pretrained가 로컬 디렉터리로 인정할 최소 조건: config.json 보유."""
    return p.is_dir() and (p / "config.json").is_file()


async def _resolve_base_model(base_ref: str) -> str:
    """어댑터의 base_model_name_or_path를 lm_eval에 넘길 수 있는 식별자로 정리한다.

    우선순위:
    1) 로컬 디렉터리이고 config.json이 있으면 그 경로 그대로
    2) 디렉터리 이름을 'org--repo' → 'org/repo' HF id로 환산해 ModelRecord 조회 → 현재 local_path가 있으면 사용
    3) 환산한 HF id 자체를 반환 (lm_eval/HF Hub가 해결)
    4) 위 모두 실패 시 원본 문자열 반환
    """
    if not base_ref:
        return base_ref
    p = Path(base_ref)
    if _is_valid_model_dir(p):
        return str(p)
    candidate_hf_id = p.name.replace("--", "/", 1) if "--" in p.name else base_ref
    if "/" in candidate_hf_id and not candidate_hf_id.startswith("/"):
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(ModelRecord).where(ModelRecord.hf_model_id == candidate_hf_id)
            )
            record = result.scalar_one_or_none()
        if record and record.local_path:
            local = Path(record.local_path)
            if not local.is_absolute():
                local = settings.BASE_DIR / local
            if _is_valid_model_dir(local):
                return str(local)
        return candidate_hf_id
    return base_ref


async def _lm_eval_model_args(model_path: str) -> str:
    """lm_eval 의 --model_args 문자열을 만든다.

    model_path 가 PEFT/LoRA 어댑터 디렉터리(adapter_config.json 보유)이면
    base_model_name_or_path 를 읽어 'pretrained=<base>,peft=<adapter>' 형식으로 반환한다.
    이때 base 경로가 사라졌으면 디렉터리명을 HF id로 환산하거나 ModelRecord로 재조회해 복구한다.
    그렇지 않으면 'pretrained=<path>' 만 반환한다.
    """
    p = Path(model_path)
    adapter_cfg = p / "adapter_config.json"
    if adapter_cfg.is_file():
        try:
            cfg = json.loads(adapter_cfg.read_text(encoding="utf-8"))
            base = cfg.get("base_model_name_or_path")
            if base:
                resolved_base = await _resolve_base_model(str(base))
                if resolved_base != base:
                    logger.info("adapter base 모델 경로 보정: %s → %s", base, resolved_base)
                return f"pretrained={resolved_base},peft={model_path}"
        except Exception as e:
            logger.warning("adapter_config.json 읽기 실패 (%s), peft 인자 없이 진행: %s", adapter_cfg, e)
    return f"pretrained={model_path}"


async def _resolve_model_display_name(model_id: str) -> str:
    """벤치마크 row에 저장할 사람 친화적 이름."""
    if model_id.startswith("sft:"):
        try:
            job_id = int(model_id.split(":", 1)[1])
        except ValueError:
            return model_id
        async with AsyncSessionLocal() as session:
            job = await session.get(TrainingJob, job_id)
        return f"[SFT #{job_id}] {job.name}" if job else model_id
    if model_id.startswith("ar:"):
        try:
            job_id = int(model_id.split(":", 1)[1])
        except ValueError:
            return model_id
        async with AsyncSessionLocal() as session:
            job = await session.get(AutoResearchJob, job_id)
        return f"[AR #{job_id}] {job.name}" if job else model_id
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(ModelRecord).where(ModelRecord.hf_model_id == model_id)
        )
        record = result.scalar_one_or_none()
    return record.name if record else model_id


class BenchmarkRunRequest(BaseModel):
    # `model_ids` collides with pydantic's protected `model_` namespace by default.
    model_config = {"protected_namespaces": ()}

    model_ids: list[str] = Field(min_length=1)
    tasks: list[str] = Field(min_length=1)
    limit: Optional[int] = None        # samples per task — lm_eval --limit
    batch_size: str = "auto"


class BenchmarkCancelRequest(BaseModel):
    group_id: str


def _extract_primary_metric(task_results: dict) -> Optional[float]:
    """Pick a single representative score from one task's results dict.

    lm_eval emits results like {"acc,none": 0.51, "acc_stderr,none": 0.01, ...}.
    """
    priority = ["acc_norm,none", "acc,none", "exact_match,none", "f1,none"]
    for key in priority:
        value = task_results.get(key)
        if isinstance(value, (int, float)):
            return float(value)
    for key, value in task_results.items():
        if isinstance(value, (int, float)) and "stderr" not in key:
            return float(value)
    return None


def _update_progress(run_id: int, *, percent: Optional[int] = None, message: Optional[str] = None) -> None:
    cur = _benchmark_progress.setdefault(run_id, {"percent": None, "message": None})
    if percent is not None:
        cur["percent"] = max(0, min(100, percent))
    if message is not None:
        cur["message"] = message[-240:]


async def _stream_subprocess_output(
    proc: asyncio.subprocess.Process,
    run_id: int,
    model_id: str,
) -> bytes:
    """Read stdout (stderr merged in) chunk-by-chunk, splitting on \\r or \\n so
    tqdm carriage-return updates are captured. Logs every line and parses the
    most recent tqdm percentage into _benchmark_progress.

    Returns the full captured output for error reporting.
    """
    buf = b""
    captured = bytearray()
    assert proc.stdout is not None
    while True:
        chunk = await proc.stdout.read(1024)
        if not chunk:
            break
        captured.extend(chunk)
        buf += chunk
        while True:
            m = _LINE_SPLIT_RE.search(buf)
            if not m:
                break
            line = buf[:m.start()]
            buf = buf[m.end():]
            text = line.decode(errors="replace").rstrip()
            if not text:
                continue
            logger.info("[lm_eval %s] %s", model_id, text)
            pm = _TQDM_PERCENT_RE.search(text)
            if pm:
                _update_progress(run_id, percent=int(pm.group(1)), message=text)
            else:
                _update_progress(run_id, message=text)
    # Flush any final unterminated bytes (e.g. the last tqdm frame without trailing \n).
    if buf:
        text = buf.decode(errors="replace").rstrip()
        if text:
            logger.info("[lm_eval %s] %s", model_id, text)
            pm = _TQDM_PERCENT_RE.search(text)
            if pm:
                _update_progress(run_id, percent=int(pm.group(1)), message=text)
            else:
                _update_progress(run_id, message=text)
    return bytes(captured)


async def _run_lm_eval(
    group_id: str,
    run_id: int,
    model_id: str,
    model_path: str,
    tasks: list[str],
    limit: Optional[int],
    batch_size: str,
) -> dict[str, Optional[float]]:
    out_dir = settings.DATA_DIR / "benchmark" / group_id / str(run_id)
    out_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable, "-u", "-m", "lm_eval",
        "--model", "hf",
        "--model_args", await _lm_eval_model_args(model_path),
        "--tasks", ",".join(tasks),
        "--batch_size", batch_size,
        "--output_path", str(out_dir),
    ]
    if limit:
        cmd += ["--limit", str(limit)]

    _update_progress(run_id, percent=0, message="lm_eval 시작 중...")

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,  # merge so tqdm (stderr) and prints (stdout) interleave
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )
    _benchmark_processes[group_id] = proc
    try:
        captured = await _stream_subprocess_output(proc, run_id, model_id)
        await proc.wait()
    except asyncio.CancelledError:
        proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), timeout=5)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
        raise
    finally:
        _benchmark_processes.pop(group_id, None)

    if proc.returncode != 0:
        tail = captured.decode(errors="replace")[-1500:]
        raise RuntimeError(f"lm_eval exited {proc.returncode}: {tail}")

    results_files = sorted(out_dir.rglob("results_*.json"))
    if not results_files:
        raise RuntimeError("lm_eval finished but no results file was produced")
    payload = json.loads(results_files[-1].read_text(encoding="utf-8"))
    raw = payload.get("results", {})
    return {task: _extract_primary_metric(raw.get(task) or {}) for task in tasks}


async def _execute_group(
    group_id: str,
    req: BenchmarkRunRequest,
    run_id_by_model: dict[str, int],
) -> None:
    total_models = len(run_id_by_model)
    for idx, (model_id, run_id) in enumerate(run_id_by_model.items(), 1):
        async with AsyncSessionLocal() as session:
            row = await session.get(BenchmarkRun, run_id)
            if row:
                row.status = JobStatus.RUNNING
                row.started_at = datetime.now()
                await session.commit()

        _emit_progress(
            status="running",
            phase="evaluating",
            percent=int((idx - 1) / total_models * 90) + 5,
            message=f"벤치마크 실행 중: {model_id} ({idx}/{total_models})",
            group_id=group_id,
            current_model=model_id,
            current_model_index=idx,
            total_models=total_models,
            tasks=req.tasks,
        )

        try:
            model_path = await _resolve_model_path(model_id)
            scores = await _run_lm_eval(
                group_id, run_id, model_id, model_path,
                req.tasks, req.limit, req.batch_size,
            )
            async with AsyncSessionLocal() as session:
                row = await session.get(BenchmarkRun, run_id)
                if row:
                    row.results = scores
                    row.status = JobStatus.COMPLETED
                    row.finished_at = datetime.now()
                    await session.commit()
            _benchmark_progress.pop(run_id, None)
        except asyncio.CancelledError:
            async with AsyncSessionLocal() as session:
                row = await session.get(BenchmarkRun, run_id)
                if row:
                    row.status = JobStatus.FAILED
                    row.error_message = "사용자가 중단했습니다"
                    row.finished_at = datetime.now()
                    await session.commit()
            _benchmark_progress.pop(run_id, None)
            raise
        except Exception as e:
            logger.exception("benchmark run %s (%s) failed", run_id, model_id)
            async with AsyncSessionLocal() as session:
                row = await session.get(BenchmarkRun, run_id)
                if row:
                    row.status = JobStatus.FAILED
                    row.error_message = str(e)[:1000]
                    row.finished_at = datetime.now()
                    await session.commit()
            _emit_progress(
                status="running",
                phase="evaluating",
                percent=int(idx / total_models * 95),
                message=f"{model_id} 실패: {e}",
                group_id=group_id,
            )
            _benchmark_progress.pop(run_id, None)

    _emit_progress(
        status="completed",
        phase="done",
        percent=100,
        message="벤치마크가 완료되었습니다.",
        group_id=group_id,
        total_models=total_models,
        tasks=req.tasks,
    )


@router.post("/cancel")
async def cancel_benchmark(req: BenchmarkCancelRequest):
    """Cancel a running benchmark group. Kills the subprocess via task.cancel()."""
    _benchmark_cancelled.add(req.group_id)
    task = _benchmark_tasks.get(req.group_id)
    if task and not task.done():
        task.cancel()
        return {"status": "cancelling", "group_id": req.group_id}
    _benchmark_cancelled.discard(req.group_id)
    return {"status": "no_active_job", "group_id": req.group_id}


@router.post("/run")
async def run_benchmarks(req: BenchmarkRunRequest, db: AsyncSession = Depends(get_db)):
    """Start lm_eval for each model on the selected tasks in the background."""
    group_id = uuid.uuid4().hex[:12]
    _benchmark_cancelled.discard(group_id)

    run_id_by_model: dict[str, int] = {}
    for model_id in req.model_ids:
        display_name = await _resolve_model_display_name(model_id)
        row = BenchmarkRun(
            group_id=group_id,
            model_hf_id=model_id,
            model_name=display_name,
            tasks=list(req.tasks),
            results=None,
            status=JobStatus.PENDING,
        )
        db.add(row)
        await db.flush()
        await db.refresh(row)
        run_id_by_model[model_id] = row.id
    await db.commit()

    async def _runner():
        try:
            await _execute_group(group_id, req, run_id_by_model)
        except asyncio.CancelledError:
            _emit_progress(
                status="failed", phase="cancelled", percent=0,
                message="사용자 요청으로 벤치마크가 중단되었습니다.",
                group_id=group_id,
            )

    task = asyncio.create_task(_runner())
    _benchmark_tasks[group_id] = task

    def _cleanup(_t: asyncio.Task, _gid: str = group_id):
        _benchmark_tasks.pop(_gid, None)
        _benchmark_cancelled.discard(_gid)

    task.add_done_callback(_cleanup)

    _emit_progress(
        status="running",
        phase="evaluating",
        percent=2,
        message=f"벤치마크 시작: {len(req.model_ids)}개 모델 × {len(req.tasks)}개 태스크",
        group_id=group_id,
        total_models=len(req.model_ids),
        tasks=req.tasks,
    )

    return {
        "group_id": group_id,
        "run_ids": list(run_id_by_model.values()),
        "model_ids": req.model_ids,
        "tasks": req.tasks,
    }


@router.get("/runs")
async def list_benchmark_runs(limit: int = 50, db: AsyncSession = Depends(get_db)):
    """Return the most recent benchmark runs (one row per model)."""
    stmt = select(BenchmarkRun).order_by(desc(BenchmarkRun.id)).limit(limit)
    result = await db.execute(stmt)
    rows = result.scalars().all()
    out = []
    for r in rows:
        prog = _benchmark_progress.get(r.id) if r.status == JobStatus.RUNNING else None
        out.append({
            "id": r.id,
            "group_id": r.group_id,
            "model_hf_id": r.model_hf_id,
            "model_name": r.model_name,
            "tasks": r.tasks,
            "results": r.results,
            "status": r.status.value if hasattr(r.status, "value") else str(r.status),
            "error_message": r.error_message,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "progress_percent": (prog or {}).get("percent"),
            "progress_message": (prog or {}).get("message"),
        })
    return out
