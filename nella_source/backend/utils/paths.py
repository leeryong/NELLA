"""
Path resolver for document artifacts.

DB는 과거에 생성될 때의 절대경로(예: 백업 위치)를 그대로 저장한다.
환경/위치가 바뀌면 이 경로들이 깨지므로, 읽기 시점에 다음 순서로 복구한다:
  1) 저장된 경로 그대로 존재하면 사용
  2) 파일명만 추출해 현재 settings 하위(documents/extracted/thumbnails)에서 찾아 사용
  3) 못 찾으면 None 반환
"""
from pathlib import Path
from typing import Literal, Optional

from backend.config import settings


PathKind = Literal["documents", "extracted", "thumbnails"]


def _base_for(kind: PathKind) -> Path:
    return {
        "documents": settings.DOCUMENTS_DIR,
        "extracted": settings.EXTRACTED_DIR,
        "thumbnails": settings.DATA_DIR / "thumbnails",
    }[kind]


def resolve_doc_path(stored_path: Optional[str], kind: PathKind) -> Optional[Path]:
    """Return a Path that exists, or None.

    Tries the stored absolute path first. If missing, falls back to
    ``<current DATA_DIR>/<kind>/<basename>`` so DB rows copied from another
    machine/backup still resolve to local files.
    """
    if not stored_path:
        return None
    p = Path(stored_path)
    if p.exists():
        return p
    fallback = _base_for(kind) / p.name
    if fallback.exists():
        return fallback
    return None


def remap_to_current(stored_path: Optional[str], kind: PathKind) -> Optional[str]:
    """Best-effort remap of a stored path to the current environment.

    Returns the new absolute path string if a matching file is found under the
    current DATA_DIR; otherwise returns the original stored_path unchanged.
    Used by the startup migration to rewrite DB rows.
    """
    resolved = resolve_doc_path(stored_path, kind)
    if resolved is None:
        return stored_path
    return str(resolved)
