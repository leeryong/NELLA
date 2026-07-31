"""
Shared model path resolution utility.

Handles old absolute paths from different machines by falling back to
MODELS_DIR or converting the folder name back to a HuggingFace repo ID.
"""
from pathlib import Path
from loguru import logger

from backend.config import settings


def resolve_model_path(model_path: str) -> str:
    """Resolve a model path that may be stale (from a different machine).

    Resolution order:
    1. Path exists as-is → return it
    2. Relative path → try BASE_DIR / path
    3. Any path → try MODELS_DIR / folder_name
    4. Folder name contains '--' → convert to HF repo ID (Org--Model → Org/Model)
    5. Fall through → return original (let from_pretrained try HF Hub)
    """
    if not model_path:
        return model_path

    p = Path(model_path)

    if p.exists():
        return model_path

    if not p.is_absolute():
        candidate = settings.BASE_DIR / p
        if candidate.exists():
            return str(candidate)

    candidate = settings.MODELS_DIR / p.name
    if candidate.exists():
        return str(candidate)

    # Convert folder name Org--Model-Name → Org/Model-Name (HF repo ID)
    if "--" in p.name:
        hf_id = p.name.replace("--", "/", 1)
        logger.info(f"Model not found locally, resolving to HF Hub ID: {hf_id}")
        return hf_id

    return model_path
