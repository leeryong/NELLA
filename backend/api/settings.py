"""
Settings API - read and update runtime configuration.
Writes changes to the .env file so they persist across restarts.
"""
import platform
import shutil
from pathlib import Path
from typing import Optional

import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config import settings, BASE_DIR
from loguru import logger

router = APIRouter(prefix="/settings", tags=["settings"])

# config.py 의 env_file 해석과 동일한 규칙: NELLA_ENV_FILE 가 있으면 그 경로(컨테이너의 영속 볼륨),
# 없으면 프로젝트 루트의 .env (로컬 개발). UI 의 설정 저장이 backend 재시작 후에도 유지된다.
ENV_FILE = Path(os.environ.get("NELLA_ENV_FILE") or (BASE_DIR / ".env"))


class SettingsResponse(BaseModel):
    finetuning_tool: str
    llm_provider: str
    openai_model: str
    openai_api_key_set: bool
    openai_api_key_masked: Optional[str]
    openai_base_url: Optional[str]
    anthropic_model: str
    anthropic_api_key_set: bool
    anthropic_api_key_masked: Optional[str]
    ollama_base_url: str
    ollama_model: str
    hf_token_set: bool
    default_train_ratio: float
    default_epochs: int
    default_learning_rate: float
    default_batch_size: int
    default_max_seq_length: int
    default_lora_rank: int
    default_lora_alpha: int
    autoresearch_max_trials: int
    autoresearch_steps_per_trial: int
    rag_enabled: bool
    rag_default_extractor: str
    rag_chunk_size: int
    rag_chunk_overlap: int
    rag_top_k: int
    rag_embedding_model: str


class SettingsUpdateRequest(BaseModel):
    finetuning_tool: Optional[str] = None
    llm_provider: Optional[str] = None
    openai_api_key: Optional[str] = None
    openai_model: Optional[str] = None
    openai_base_url: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    anthropic_model: Optional[str] = None
    ollama_base_url: Optional[str] = None
    ollama_model: Optional[str] = None
    hf_token: Optional[str] = None
    default_train_ratio: Optional[float] = None
    default_epochs: Optional[int] = None
    default_learning_rate: Optional[float] = None
    default_batch_size: Optional[int] = None
    default_max_seq_length: Optional[int] = None
    default_lora_rank: Optional[int] = None
    default_lora_alpha: Optional[int] = None
    autoresearch_max_trials: Optional[int] = None
    autoresearch_steps_per_trial: Optional[int] = None
    rag_enabled: Optional[bool] = None
    rag_default_extractor: Optional[str] = None
    rag_chunk_size: Optional[int] = None
    rag_chunk_overlap: Optional[int] = None
    rag_top_k: Optional[int] = None
    rag_embedding_model: Optional[str] = None


def _read_env() -> dict:
    """Read current .env file into a dict."""
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                env[key.strip()] = val.strip()
    return env


def _write_env(env: dict):
    """Write dict back to .env file."""
    lines = []
    for key, val in env.items():
        lines.append(f"{key}={val}")
    ENV_FILE.write_text("\n".join(lines) + "\n")


def _mask_key(key: Optional[str]) -> Optional[str]:
    if not key:
        return None
    return key[:3] + "*" * 16


@router.get("", response_model=SettingsResponse)
async def get_settings():
    """Return current settings (API keys partially masked)."""
    return SettingsResponse(
        finetuning_tool=settings.FINETUNING_TOOL,
        llm_provider=settings.LLM_PROVIDER,
        openai_model=settings.OPENAI_MODEL,
        openai_api_key_set=bool(settings.OPENAI_API_KEY),
        openai_api_key_masked=_mask_key(settings.OPENAI_API_KEY),
        openai_base_url=settings.OPENAI_BASE_URL,
        anthropic_model=settings.ANTHROPIC_MODEL,
        anthropic_api_key_set=bool(settings.ANTHROPIC_API_KEY),
        anthropic_api_key_masked=_mask_key(settings.ANTHROPIC_API_KEY),
        ollama_base_url=settings.OLLAMA_BASE_URL,
        ollama_model=settings.OLLAMA_MODEL,
        hf_token_set=bool(settings.HF_TOKEN),
        default_train_ratio=settings.DEFAULT_TRAIN_RATIO,
        default_epochs=settings.DEFAULT_EPOCHS,
        default_learning_rate=settings.DEFAULT_LEARNING_RATE,
        default_batch_size=settings.DEFAULT_BATCH_SIZE,
        default_max_seq_length=settings.DEFAULT_MAX_SEQ_LENGTH,
        default_lora_rank=settings.DEFAULT_LORA_RANK,
        default_lora_alpha=settings.DEFAULT_LORA_ALPHA,
        autoresearch_max_trials=settings.AUTORESEARCH_MAX_TRIALS,
        autoresearch_steps_per_trial=settings.AUTORESEARCH_STEPS_PER_TRIAL,
        rag_enabled=settings.RAG_ENABLED,
        rag_default_extractor=settings.RAG_DEFAULT_EXTRACTOR,
        rag_chunk_size=settings.RAG_CHUNK_SIZE,
        rag_chunk_overlap=settings.RAG_CHUNK_OVERLAP,
        rag_top_k=settings.RAG_TOP_K,
        rag_embedding_model=settings.RAG_EMBEDDING_MODEL,
    )


@router.patch("")
async def update_settings(req: SettingsUpdateRequest):
    """
    Update settings and persist to .env file.
    Changes take effect immediately in the running process AND on next restart.
    """
    env = _read_env()
    updated = []

    mapping = {
        "finetuning_tool": ("FINETUNING_TOOL", req.finetuning_tool),
        "llm_provider": ("LLM_PROVIDER", req.llm_provider),
        "openai_api_key": ("OPENAI_API_KEY", req.openai_api_key),
        "openai_model": ("OPENAI_MODEL", req.openai_model),
        "openai_base_url": ("OPENAI_BASE_URL", req.openai_base_url),
        "anthropic_api_key": ("ANTHROPIC_API_KEY", req.anthropic_api_key),
        "anthropic_model": ("ANTHROPIC_MODEL", req.anthropic_model),
        "ollama_base_url": ("OLLAMA_BASE_URL", req.ollama_base_url),
        "ollama_model": ("OLLAMA_MODEL", req.ollama_model),
        "hf_token": ("HF_TOKEN", req.hf_token),
        "default_train_ratio": ("DEFAULT_TRAIN_RATIO", req.default_train_ratio),
        "default_epochs": ("DEFAULT_EPOCHS", req.default_epochs),
        "default_learning_rate": ("DEFAULT_LEARNING_RATE", req.default_learning_rate),
        "default_batch_size": ("DEFAULT_BATCH_SIZE", req.default_batch_size),
        "default_max_seq_length": ("DEFAULT_MAX_SEQ_LENGTH", req.default_max_seq_length),
        "default_lora_rank": ("DEFAULT_LORA_RANK", req.default_lora_rank),
        "default_lora_alpha": ("DEFAULT_LORA_ALPHA", req.default_lora_alpha),
        "autoresearch_max_trials": ("AUTORESEARCH_MAX_TRIALS", req.autoresearch_max_trials),
        "autoresearch_steps_per_trial": ("AUTORESEARCH_STEPS_PER_TRIAL", req.autoresearch_steps_per_trial),
        "rag_enabled": ("RAG_ENABLED", req.rag_enabled),
        "rag_default_extractor": ("RAG_DEFAULT_EXTRACTOR", req.rag_default_extractor),
        "rag_chunk_size": ("RAG_CHUNK_SIZE", req.rag_chunk_size),
        "rag_chunk_overlap": ("RAG_CHUNK_OVERLAP", req.rag_chunk_overlap),
        "rag_top_k": ("RAG_TOP_K", req.rag_top_k),
        "rag_embedding_model": ("RAG_EMBEDDING_MODEL", req.rag_embedding_model),
    }

    for field, (env_key, value) in mapping.items():
        if value is None:
            continue
        str_val = str(value)
        env[env_key] = str_val
        # Also update the live settings object
        attr = env_key  # same name
        if hasattr(settings, attr):
            try:
                setattr(settings, attr, value)
            except Exception:
                pass
        updated.append(env_key)

    _write_env(env)
    logger.info(f"Settings updated: {updated}")

    # Rebuild the global llm_service provider so changes take effect immediately
    if any(k in updated for k in ("LLM_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "OLLAMA_BASE_URL", "OLLAMA_MODEL")):
        try:
            from backend.services.llm_service import llm_service, get_llm_provider
            llm_service.provider = get_llm_provider()
            logger.info(f"LLM provider reloaded: {settings.LLM_PROVIDER}")
        except Exception as e:
            logger.warning(f"Failed to reload LLM provider: {e}")

    if "HF_TOKEN" in updated:
        try:
            from backend.services.hf_registry import hf_registry
            hf_registry.reset_api()
            logger.info("HuggingFace API client reloaded with updated token")
        except Exception as e:
            logger.warning(f"Failed to reload HuggingFace API client: {e}")

    return {"status": "success", "updated": updated, "message": "Settings saved. Restart server to apply all changes."}


@router.post("/test-llm")
async def test_llm_connection():
    """Test the currently configured LLM connection."""
    try:
        from backend.services.llm_service import llm_service
        result = await llm_service.generate(
            prompt="Reply with just 'OK'",
            system="You are a test assistant.",
            max_tokens=10,
        )
        return {"status": "success", "provider": settings.LLM_PROVIDER, "response": result}
    except Exception as e:
        raise HTTPException(400, detail=f"LLM connection failed: {str(e)}")


class TestProviderRequest(BaseModel):
    provider: str          # "openai" | "anthropic" | "ollama"
    api_key: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None


@router.post("/test-provider")
async def test_provider_connection(req: TestProviderRequest):
    """Test a specific provider connection with given credentials (without saving)."""
    import httpx

    if req.provider == "openai":
        import openai
        key = req.api_key or settings.OPENAI_API_KEY
        if not key:
            raise HTTPException(400, detail="OpenAI API Key가 설정되지 않았습니다.")
        model = req.model or settings.OPENAI_MODEL
        base_url = req.base_url or settings.OPENAI_BASE_URL
        try:
            client = openai.AsyncOpenAI(api_key=key, base_url=base_url or None)
            resp = await client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": "Reply with just OK"}],
                max_tokens=5,
            )
            return {"status": "success", "provider": "openai", "model": model,
                    "response": resp.choices[0].message.content}
        except Exception as e:
            raise HTTPException(400, detail=str(e))

    elif req.provider == "anthropic":
        import anthropic
        key = req.api_key or settings.ANTHROPIC_API_KEY
        if not key:
            raise HTTPException(400, detail="Anthropic API Key가 설정되지 않았습니다.")
        model = req.model or settings.ANTHROPIC_MODEL
        try:
            client = anthropic.AsyncAnthropic(api_key=key)
            resp = await client.messages.create(
                model=model,
                max_tokens=5,
                messages=[{"role": "user", "content": "Reply with just OK"}],
            )
            return {"status": "success", "provider": "anthropic", "model": model,
                    "response": resp.content[0].text}
        except Exception as e:
            raise HTTPException(400, detail=str(e))

    elif req.provider == "ollama":
        base_url = req.base_url or settings.OLLAMA_BASE_URL
        model = req.model or settings.OLLAMA_MODEL
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"{base_url}/api/generate",
                    json={"model": model, "prompt": "Reply with just OK", "stream": False},
                )
                resp.raise_for_status()
                data = resp.json()
                return {"status": "success", "provider": "ollama", "model": model,
                        "response": data.get("response", "")}
        except httpx.ConnectError:
            raise HTTPException(400, detail=f"Ollama 서버({base_url})에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.")
        except Exception as e:
            raise HTTPException(400, detail=str(e))

    else:
        raise HTTPException(400, detail=f"알 수 없는 제공자: {req.provider}")


@router.get("/system-info")
async def get_system_info():
    """Return CPU, memory, GPU, and disk information."""
    import psutil

    # CPU
    cpu_info = {
        "physical_cores": psutil.cpu_count(logical=False),
        "logical_cores": psutil.cpu_count(logical=True),
        "usage_percent": psutil.cpu_percent(interval=None),
        "model": platform.processor() or platform.machine(),
    }

    # Memory
    mem = psutil.virtual_memory()
    memory_info = {
        "total_gb": round(mem.total / 1e9, 1),
        "used_gb": round(mem.used / 1e9, 1),
        "available_gb": round(mem.available / 1e9, 1),
        "percent": mem.percent,
    }

    # Disk (data directory)
    disk = shutil.disk_usage(str(settings.DATA_DIR))
    disk_info = {
        "total_gb": round(disk.total / 1e9, 1),
        "used_gb": round(disk.used / 1e9, 1),
        "free_gb": round(disk.free / 1e9, 1),
        "percent": round(disk.used / disk.total * 100, 1),
    }

    # GPU / Accelerator — torch is optional
    gpu_info = []
    cuda_available = False
    mps_available = False
    torch_version = None
    try:
        import torch
        torch_version = torch.__version__
        cuda_available = torch.cuda.is_available()
        mps_available = torch.backends.mps.is_available()

        if cuda_available:
            for i in range(torch.cuda.device_count()):
                props = torch.cuda.get_device_properties(i)
                allocated = torch.cuda.memory_allocated(i)
                reserved  = torch.cuda.memory_reserved(i)
                total     = props.total_memory
                gpu_info.append({
                    "index": i,
                    "name": props.name,
                    "total_gb": round(total / 1e9, 1),
                    "used_gb": round(allocated / 1e9, 2),
                    "reserved_gb": round(reserved / 1e9, 2),
                    "free_gb": round((total - reserved) / 1e9, 2),
                    "type": "cuda",
                })
        elif mps_available:
            gpu_info.append({
                "index": 0,
                "name": f"Apple {platform.processor() or 'Silicon'} (MPS)",
                "total_gb": round(mem.total / 1e9, 1),
                "used_gb": None,
                "reserved_gb": None,
                "free_gb": None,
                "type": "mps",
                "note": "Apple Silicon은 CPU와 메모리를 공유합니다.",
            })
    except Exception:
        pass  # torch not available in this environment

    return {
        "platform": platform.system(),
        "python_version": platform.python_version(),
        "torch_version": torch_version,
        "cpu": cpu_info,
        "memory": memory_info,
        "disk": disk_info,
        "gpu": gpu_info,
        "cuda_available": cuda_available,
        "mps_available": mps_available,
    }


@router.get("/ollama-models")
async def get_ollama_models(base_url: Optional[str] = None):
    """Fetch model list from a running Ollama server via GET /api/tags."""
    import httpx
    url = (base_url or settings.OLLAMA_BASE_URL).rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{url}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            models = [m["name"] for m in data.get("models", [])]
            return {"status": "success", "models": models, "base_url": url}
    except httpx.ConnectError:
        raise HTTPException(400, detail=f"Ollama 서버({url})에 연결할 수 없습니다.")
    except Exception as e:
        raise HTTPException(400, detail=str(e))


@router.post("/reset")
async def reset_all_data():
    """Reset all work data: training jobs, datasets, evaluation results, documents, and files."""
    from backend.database import AsyncSessionLocal
    from sqlalchemy import text

    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("PRAGMA foreign_keys=OFF"))
            for tbl in ("autoresearch_jobs", "training_jobs", "training_datasets", "evaluation_results", "documents"):
                await db.execute(text(f"DELETE FROM {tbl}"))
            await db.execute(text("PRAGMA foreign_keys=ON"))
            await db.commit()

        import glob
        data_dir = settings.DATA_DIR  # BASE_DIR/data/
        for subdir in ("training_data", "documents", "extracted"):
            d = data_dir / subdir
            if d.exists():
                shutil.rmtree(d)
                d.mkdir(parents=True, exist_ok=True)

        for p in glob.glob(str(data_dir / "models/trained_output*")):
            shutil.rmtree(p, ignore_errors=True)

        logger.info("시스템 전체 초기화 완료")
        return {"status": "ok", "message": "모든 작업 이력, 데이터셋, 문서가 삭제되었습니다."}
    except Exception as e:
        logger.error(f"Reset failed: {e}")
        raise HTTPException(500, detail=str(e))


@router.get("/available-providers")
async def get_available_providers():
    """Return which providers have API keys configured."""
    return {
        "openai": bool(settings.OPENAI_API_KEY),
        "anthropic": bool(settings.ANTHROPIC_API_KEY),
        "ollama": True,  # Ollama is always listed (local)
        "default": settings.LLM_PROVIDER,
        "openai_model": settings.OPENAI_MODEL,
        "anthropic_model": settings.ANTHROPIC_MODEL,
        "ollama_model": settings.OLLAMA_MODEL,
    }
