"""
Adapter Card generator.

After a training job finishes, we drop two files next to the adapter weights so
the folder is self-describing when handed off to someone else:

- `nella_adapter_card.json` — structured metadata (machine-readable)
- `NELLA_ADAPTER_CARD.md`   — human-readable summary

The card records: base model, training method + hyperparameters, dataset(s)
used and their source documents, final loss, timing, and a code snippet for
loading the adapter.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import (
    AutoResearchJob,
    Document,
    ModelRecord,
    TrainingDataset,
    TrainingJob,
)


NELLA_VERSION = "0.78"


def _method_label(method: str) -> tuple[str, str]:
    """Return (short_code, human_readable) for a training method."""
    m = (method or "").lower()
    if m == "lora":
        return "lora", "LoRA (Low-Rank Adaptation)"
    if m == "qlora":
        return "qlora", "QLoRA (4-bit Quantized LoRA)"
    if m in ("sft", "full"):
        return "full", "Full Fine-tuning"
    if m == "dpo":
        return "dpo", "DPO (Direct Preference Optimization)"
    return m or "unknown", m or "unknown"


def _is_adapter(method: str) -> bool:
    return _method_label(method)[0] in ("lora", "qlora", "dpo")


async def _resolve_datasets(session: AsyncSession, primary_id: int, extra_ids: list[int]) -> list[TrainingDataset]:
    """Return dataset rows for primary + extras (deduped, order preserved)."""
    ids: list[int] = []
    seen: set[int] = set()
    for i in [primary_id, *(extra_ids or [])]:
        if i is None:
            continue
        try:
            ii = int(i)
        except (TypeError, ValueError):
            continue
        if ii in seen:
            continue
        seen.add(ii)
        ids.append(ii)
    if not ids:
        return []
    r = await session.execute(select(TrainingDataset).where(TrainingDataset.id.in_(ids)))
    by_id = {d.id: d for d in r.scalars().all()}
    return [by_id[i] for i in ids if i in by_id]


async def _resolve_source_documents(session: AsyncSession, datasets: list[TrainingDataset]) -> list[dict]:
    doc_ids = [d.document_id for d in datasets if d.document_id]
    if not doc_ids:
        return []
    r = await session.execute(select(Document).where(Document.id.in_(doc_ids)))
    return [
        {"id": d.id, "filename": d.filename, "extractor": d.extractor or ""}
        for d in r.scalars().all()
    ]


def _render_markdown(card: dict[str, Any]) -> str:
    adapter = card["adapter"]
    training = card["training"]
    dataset = card["dataset"]
    nella = card["nella"]
    method_short, method_human = _method_label(training.get("method", ""))
    ttype = training.get("training_type", "").upper()

    hp = training.get("hyperparameters", {}) or {}
    hp_lines: list[str] = []
    for label, key in [
        ("Learning rate", "learning_rate"),
        ("Epochs", "num_train_epochs"),
        ("Batch size / device", "per_device_train_batch_size"),
        ("Gradient accumulation", "gradient_accumulation_steps"),
        ("Max sequence length", "max_seq_length"),
        ("LoRA rank (r)", "lora_r"),
        ("LoRA alpha", "lora_alpha"),
        ("LoRA dropout", "lora_dropout"),
        ("Warmup ratio", "warmup_ratio"),
        ("Weight decay", "weight_decay"),
        ("LR scheduler", "lr_scheduler_type"),
        ("Max steps", "max_steps"),
        ("DPO beta", "beta"),
    ]:
        if key in hp and hp[key] is not None:
            hp_lines.append(f"- **{label}**: `{hp[key]}`")

    docs = dataset.get("source_documents") or []
    doc_lines = "\n".join(f"  - `{d['filename']}` (id {d['id']})" for d in docs) or "  - (none tracked)"

    combined = dataset.get("combined_dataset_names") or []
    combined_line = ""
    if len(combined) > 1:
        combined_line = f"\n- **Merged datasets**: {', '.join(combined)}"

    results = training.get("results", {}) or {}
    dur = results.get("duration_seconds")
    dur_str = f"{int(dur // 60)}m {int(dur % 60)}s" if isinstance(dur, (int, float)) else "-"

    base = adapter.get("base_model", {}) or {}
    is_adapter = _is_adapter(training.get("method", ""))
    kind_line = "This is a **LoRA/QLoRA adapter** — load it *on top of* the base model below." if is_adapter and method_short != "dpo" \
        else ("This is a **DPO adapter/model** — load per DPO usage." if method_short == "dpo"
              else "This is a **full fine-tuned model** — no base merge required.")

    load_snippet = card.get("usage", {}).get("load_example_python", "").strip()

    return f"""# NELLA Adapter Card — {adapter.get('name', '(unnamed)')}

{kind_line}

## Adapter

- **Name**: {adapter.get('name', '(unnamed)')}
- **Type**: `{method_short}` — {method_human}
- **Training objective**: {ttype or '(unspecified)'}
- **Base model**: `{base.get('hf_id', '?')}` — {base.get('name', '?')}

## Training

- **Method**: {method_human}
- **Final loss**: `{results.get('final_loss', '-')}`
- **Started**: {results.get('started_at', '-')}
- **Completed**: {results.get('completed_at', '-')}
- **Duration**: {dur_str}

### Hyperparameters
{chr(10).join(hp_lines) if hp_lines else '- (defaults)'}

## Dataset

- **Primary**: {dataset.get('primary_name', '?')} (id {dataset.get('primary_id', '-')}, type `{dataset.get('data_type', '-')}`)
- **Train samples**: {dataset.get('train_count', '-')}
- **Test samples**: {dataset.get('test_count', '-')}
- **LLM used to generate**: {dataset.get('llm_provider', '-')}{combined_line}
- **Source documents**:
{doc_lines}

## Loading

```python
{load_snippet}
```

---

Generated by **NELLA v{nella.get('version')}** on {nella.get('generated_at')}
· training job id `{nella.get('training_job_id', '-')}`{f" · autoresearch id `{nella['autoresearch_job_id']}`" if nella.get('autoresearch_job_id') else ''}
"""


def _load_snippet(base_hf_id: str, method: str) -> str:
    if _method_label(method)[0] in ("lora", "qlora"):
        return f"""from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

# 1) Load base
base = AutoModelForCausalLM.from_pretrained(
    "{base_hf_id}",
    torch_dtype="auto",
    device_map="auto",
)
tokenizer = AutoTokenizer.from_pretrained("{base_hf_id}")

# 2) Attach this adapter (path = folder containing this card)
model = PeftModel.from_pretrained(base, "./")
model.eval()"""
    if _method_label(method)[0] == "dpo":
        return f"""# DPO output may be a full model or an adapter depending on use_lora at train time.
# If adapter_config.json exists in this folder, load like a LoRA adapter (see LoRA snippet);
# otherwise load as a full model with AutoModelForCausalLM.from_pretrained("./")."""
    # full
    return """from transformers import AutoModelForCausalLM, AutoTokenizer

model = AutoModelForCausalLM.from_pretrained("./", torch_dtype="auto", device_map="auto")
tokenizer = AutoTokenizer.from_pretrained("./")"""


def _base_model_from_adapter_config(output_dir: str) -> Optional[str]:
    """Fallback: read base model id from adapter_config.json if the DB lost it.

    NELLA stores models under `data/models/{org}--{repo}/` so a local path like
    `.../data/models/Qwen--Qwen2.5-1.5B-Instruct` maps back to `Qwen/Qwen2.5-1.5B-Instruct`.
    """
    try:
        p = Path(output_dir) / "adapter_config.json"
        if p.exists():
            cfg = json.loads(p.read_text(encoding="utf-8"))
            raw = cfg.get("base_model_name_or_path") or ""
            if not raw:
                return None
            # If it's a local path under data/models/{org}--{repo}, recover the HF id
            leaf = Path(raw).name if "/" in raw or "\\" in raw else raw
            if "--" in leaf and Path(raw).exists() or "--" in leaf:
                return leaf.replace("--", "/", 1)
            return raw
    except Exception:
        pass
    return None


async def _build_card(
    session: AsyncSession,
    *,
    output_dir: str,
    adapter_name: str,
    method: str,
    training_type: str,
    hyperparameters: dict,
    results: dict,
    base_model: Optional[ModelRecord],
    datasets: list[TrainingDataset],
    combined_dataset_ids: list[int],
    training_job_id: Optional[int] = None,
    autoresearch_job_id: Optional[int] = None,
) -> dict[str, Any]:
    """Assemble the metadata dict — no I/O."""
    primary_ds = datasets[0] if datasets else None
    docs = await _resolve_source_documents(session, datasets)

    base_hf_id = base_model.hf_model_id if base_model else _base_model_from_adapter_config(output_dir) or "?"
    base_name = base_model.name if base_model else (base_hf_id.split("/")[-1] if base_hf_id != "?" else "?")

    card = {
        "nella": {
            "version": NELLA_VERSION,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "training_job_id": training_job_id,
            "autoresearch_job_id": autoresearch_job_id,
        },
        "adapter": {
            "name": adapter_name,
            "type": _method_label(method)[0],
            "training_type": training_type,
            "output_dir": str(output_dir),
            "base_model": {
                "hf_id": base_hf_id,
                "name": base_name,
                "local_path": base_model.local_path if base_model else None,
                "size_gb": base_model.download_size_gb if base_model else None,
            },
        },
        "training": {
            "method": method,
            "training_type": training_type,
            "hyperparameters": hyperparameters,
            "results": results,
        },
        "dataset": {
            "primary_id": primary_ds.id if primary_ds else None,
            "primary_name": primary_ds.name if primary_ds else None,
            "data_type": primary_ds.data_type if primary_ds else None,
            "train_count": primary_ds.train_count if primary_ds else None,
            "test_count": primary_ds.test_count if primary_ds else None,
            "llm_provider": primary_ds.llm_provider if primary_ds else None,
            "combined_dataset_ids": combined_dataset_ids,
            "combined_dataset_names": [d.name for d in datasets],
            "source_documents": docs,
        },
        "usage": {
            "load_example_python": _load_snippet(base_hf_id, method),
        },
    }
    return card


async def _write_card_files(output_dir: str, card: dict[str, Any]) -> None:
    """Write both the JSON and the markdown card to output_dir."""
    out = Path(output_dir)
    if not out.exists():
        logger.warning(f"[adapter-card] output_dir does not exist, skipping: {output_dir}")
        return
    (out / "nella_adapter_card.json").write_text(
        json.dumps(card, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out / "NELLA_ADAPTER_CARD.md").write_text(_render_markdown(card), encoding="utf-8")
    logger.info(f"[adapter-card] wrote card to {out}")


async def write_card_for_training_job(session: AsyncSession, job: TrainingJob) -> None:
    """Write an adapter card for a completed SFT/DPO TrainingJob."""
    if not job.output_dir:
        logger.warning(f"[adapter-card] job {job.id} has no output_dir")
        return

    # Base model
    r = await session.execute(select(ModelRecord).where(ModelRecord.id == job.base_model_id))
    base_model = r.scalar_one_or_none()

    # Datasets — primary + any extras from job.config
    combined_ids: list[int] = []
    cfg = dict(job.config or {})
    if isinstance(cfg.get("dataset_ids"), list):
        combined_ids = [int(x) for x in cfg["dataset_ids"] if x is not None]
    datasets = await _resolve_datasets(session, job.dataset_id, [i for i in combined_ids if i != job.dataset_id])

    # Method + training_type
    method_raw = job.method.value if hasattr(job.method, "value") else str(job.method)
    method_norm = method_raw.lower()
    if method_norm == "sft":
        method_norm = "full"  # DB stores "sft" for full fine-tune; card uses "full"
        training_type = "sft"
    elif method_norm in ("lora", "qlora"):
        training_type = "sft"
    elif method_norm == "dpo":
        training_type = "dpo"
    else:
        training_type = "sft"

    # Hyperparameters — pull from job.config, strip non-hp keys
    hp = {k: v for k, v in cfg.items() if k not in {"dataset_ids"}}

    results = {
        "final_loss": job.final_loss,
        "started_at": job.started_at.isoformat(timespec="seconds") if job.started_at else None,
        "completed_at": job.completed_at.isoformat(timespec="seconds") if job.completed_at else None,
        "duration_seconds": (
            (job.completed_at - job.started_at).total_seconds()
            if (job.started_at and job.completed_at)
            else None
        ),
        "total_metric_points": len(job.training_metrics or []),
    }

    card = await _build_card(
        session,
        output_dir=job.output_dir,
        adapter_name=job.name,
        method=method_norm,
        training_type=training_type,
        hyperparameters=hp,
        results=results,
        base_model=base_model,
        datasets=datasets,
        combined_dataset_ids=combined_ids or ([job.dataset_id] if job.dataset_id else []),
        training_job_id=job.id,
    )
    await _write_card_files(job.output_dir, card)


async def write_card_for_autoresearch_job(session: AsyncSession, ar_job_id: int, output_dir: str) -> None:
    """Write an adapter card for a completed AutoResearchJob's final_model."""
    r = await session.execute(select(AutoResearchJob).where(AutoResearchJob.id == ar_job_id))
    ar_job = r.scalar_one_or_none()
    if not ar_job:
        logger.warning(f"[adapter-card] AutoResearch {ar_job_id} not found")
        return
    if not output_dir:
        logger.warning(f"[adapter-card] AutoResearch {ar_job_id}: no output_dir")
        return

    r = await session.execute(select(ModelRecord).where(ModelRecord.id == ar_job.base_model_id))
    base_model = r.scalar_one_or_none()

    datasets = await _resolve_datasets(session, ar_job.dataset_id, [])

    method_norm = (ar_job.method or "lora").lower()
    training_type = "sft"

    hp = dict(ar_job.best_config or {})

    results = {
        "final_loss": (ar_job.best_loss if ar_job.best_loss is not None else None),
        "started_at": ar_job.created_at.isoformat(timespec="seconds") if ar_job.created_at else None,
        "completed_at": ar_job.updated_at.isoformat(timespec="seconds") if ar_job.updated_at else None,
        "duration_seconds": (
            (ar_job.updated_at - ar_job.created_at).total_seconds()
            if (ar_job.created_at and ar_job.updated_at)
            else None
        ),
        "trials": len(ar_job.trial_results or []),
        "max_trials": ar_job.max_trials,
    }

    card = await _build_card(
        session,
        output_dir=output_dir,
        adapter_name=ar_job.name,
        method=method_norm,
        training_type=training_type,
        hyperparameters=hp,
        results=results,
        base_model=base_model,
        datasets=datasets,
        combined_dataset_ids=[ar_job.dataset_id] if ar_job.dataset_id else [],
        autoresearch_job_id=ar_job.id,
    )
    await _write_card_files(output_dir, card)


async def rewrite_card(session: AsyncSession, output_dir: str) -> bool:
    """Regenerate the card for a folder whose adapter already exists.

    Looks up which TrainingJob/AutoResearchJob has this output_dir and rewrites.
    Returns True on success, False if no matching job was found.
    """
    r = await session.execute(select(TrainingJob).where(TrainingJob.output_dir == output_dir))
    job = r.scalar_one_or_none()
    if job:
        await write_card_for_training_job(session, job)
        return True

    # Try AutoResearch: folder is data/models/autoresearch_{id}/final_model
    p = Path(output_dir).resolve()
    if p.parent.name.startswith("autoresearch_"):
        try:
            ar_id = int(p.parent.name.split("_", 1)[1])
        except ValueError:
            return False
        await write_card_for_autoresearch_job(session, ar_id, output_dir)
        return True
    return False
