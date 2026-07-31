"""
Document management API endpoints.
Includes SSE endpoint for real-time processing progress.
"""
import asyncio
import io
import json
import re
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Query
from fastapi.responses import Response, StreamingResponse, FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database import get_db, Document, DocumentStatus
from backend.schemas.models import DocumentResponse, DocumentUploadResponse, StatusResponse
from backend.agents.document_agent import document_agent
from backend.config import settings
from backend.services.rag_service import rag_service
from backend.utils.thumbnail import generate_thumbnail
from backend.utils.paths import resolve_doc_path
from loguru import logger

router = APIRouter(prefix="/documents", tags=["documents"])

# In-memory progress queues keyed by doc_id
# Each entry: asyncio.Queue of {"message": str, "percent": int, "done": bool}
_progress_queues: Dict[int, asyncio.Queue] = {}


def _delete_path(path_value: str | None) -> bool:
    """Delete a file or directory path recorded for a document."""
    if not path_value:
        return False
    path = Path(path_value)
    if not path.is_absolute():
        path = settings.DATA_DIR / path
    try:
        if path.is_dir():
            shutil.rmtree(path)
            return True
        if path.exists():
            path.unlink()
            return True
    except Exception as exc:
        logger.warning(f"Failed to delete document artifact {path}: {exc}")
    return False


def _delete_document_artifacts(doc: Document) -> int:
    deleted = 0
    kind_map = {"original_path": "documents", "extracted_path": "extracted", "thumbnail_path": "thumbnails"}
    for path_attr, kind in kind_map.items():
        raw = getattr(doc, path_attr, None)
        # Try the resolved (current-env) path first, then the raw stored path
        resolved = resolve_doc_path(raw, kind)  # type: ignore[arg-type]
        if resolved and _delete_path(str(resolved)):
            deleted += 1
        elif _delete_path(raw):
            deleted += 1

    image_dir = settings.EXTRACTED_DIR / f"doc{doc.id}_images"
    if _delete_path(str(image_dir)):
        deleted += 1
    return deleted


# Note: RAG indexing is no longer done implicitly on upload. Users create a
# RAG DB (Chroma collection) explicitly on the RAG DB page and pick which
# documents to include; that flow calls rag_service.index_document with a
# collection name.


async def _update_document_status(
    doc_id: int,
    status: str,
    result: dict = None,
    error: str = None,
):
    """Update document status in database."""
    from backend.database import AsyncSessionLocal, DocumentStatus
    async with AsyncSessionLocal() as db:
        stmt = select(Document).where(Document.id == doc_id)
        result_db = await db.execute(stmt)
        doc = result_db.scalar_one_or_none()
        if doc:
            doc.status = DocumentStatus(status)
            doc.updated_at = datetime.now()   # SQLite onupdate 미작동 방지
            if result:
                doc.extracted_path = result.get("extracted_path")
                doc.page_count = result.get("page_count")
                doc.word_count = result.get("word_count")
                # 미리보기 응답에서 사용하도록 글자 수를 추출 시점에 저장한다.
                char_count = result.get("char_count")
                if char_count is None and result.get("extracted_path"):
                    try:
                        char_count = len(Path(result["extracted_path"]).read_text(encoding="utf-8"))
                    except Exception:
                        char_count = None
                doc.char_count = char_count
                if result.get("extractor"):
                    doc.extractor = result.get("extractor")
                doc.rag_indexed = False
                doc.rag_chunk_count = 0
                doc.rag_indexed_at = None
            if error:
                doc.error_message = error
            await db.commit()


@router.post("/upload", response_model=DocumentUploadResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    extractor: str = Query(default="openDataLoader"),
    extract_images: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    """Upload and process a document."""
    # Read file
    content = await file.read()
    filename = file.filename or "unknown"

    # Validate
    validation = document_agent.validate_file(filename, len(content))
    if not validation["valid"]:
        raise HTTPException(400, detail={"errors": validation["errors"]})

    # Detect file type
    file_ext = Path(filename).suffix.lower().lstrip(".")

    # Create DB record
    doc = Document(
        filename=filename,
        original_path="",  # Will be set during processing
        file_type=file_ext,
        file_size=len(content),
        status=DocumentStatus.PROCESSING,
        extractor=extractor,
    )
    db.add(doc)
    await db.flush()
    await db.refresh(doc)
    await db.commit()  # background task가 새 session으로 문서를 조회하기 전에 반드시 commit

    doc_id = doc.id
    logger.info(f"Created document record {doc_id} for {filename}")

    # Create progress queue for SSE streaming
    q: asyncio.Queue = asyncio.Queue()
    _progress_queues[doc_id] = q

    async def push_progress(message: str, percent: int):
        await q.put({"message": message, "percent": percent, "done": percent >= 100, "extractor": extractor})

    # Process in background
    async def process():
        try:
            await push_progress("업로드 완료, 처리 시작...", 3)
            # 추출 시작 시각 기록
            from backend.database import AsyncSessionLocal as _ASL
            async with _ASL() as _sess:
                _r = await _sess.execute(select(Document).where(Document.id == doc_id))
                _doc = _r.scalar_one_or_none()
                if _doc:
                    _doc.started_at = datetime.now()
                    await _sess.commit()
            result = await document_agent.process_upload(
                file_content=content,
                filename=filename,
                doc_id=doc_id,
                update_status_fn=_update_document_status,
                progress_cb=push_progress,
                extractor=extractor,
                extract_images=extract_images,
            )
            # Update original_path and generate thumbnail
            from backend.database import AsyncSessionLocal
            async with AsyncSessionLocal() as session:
                stmt = select(Document).where(Document.id == doc_id)
                db_result = await session.execute(stmt)
                doc_record = db_result.scalar_one_or_none()
                if doc_record:
                    original_path = result.get("original_path", "")
                    doc_record.original_path = original_path
                    # Generate PDF thumbnail
                    if original_path and Path(original_path).suffix.lower() == ".pdf":
                        from backend.config import settings
                        thumb_dir = settings.DATA_DIR / "thumbnails"
                        thumb_dir.mkdir(parents=True, exist_ok=True)
                        thumb_path = str(thumb_dir / f"doc_{doc_id}.jpg")
                        if generate_thumbnail(original_path, thumb_path):
                            doc_record.thumbnail_path = thumb_path
                    await session.commit()
        except Exception as e:
            logger.error(f"Background processing failed for doc {doc_id}: {e}")
            await q.put({"message": f"오류: {e}", "percent": 0, "done": True, "error": True})
        finally:
            await q.put({"done": True, "message": "처리 완료", "percent": 100})

    background_tasks.add_task(process)

    return doc


@router.get("/{doc_id}/progress")
async def stream_document_progress(doc_id: int):
    """SSE endpoint — streams processing progress for a document."""

    async def event_generator():
        q = _progress_queues.get(doc_id)
        if q is None:
            # 큐 없음 — 서버 재시작 또는 이미 완료된 케이스
            from backend.database import AsyncSessionLocal
            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    select(Document).where(Document.id == doc_id)
                )
                doc = result.scalar_one_or_none()
                if not doc:
                    yield f"data: {json.dumps({'message': '문서를 찾을 수 없습니다', 'percent': 100, 'done': True, 'error': True})}\n\n"
                    return
                status = doc.status.value
                # pending/processing 상태인데 큐가 없으면 서버 재시작으로 처리가 중단된 것
                if status in ("pending", "processing"):
                    doc.status = DocumentStatus("failed")
                    doc.error_message = "서버 재시작으로 처리가 중단됐습니다. 재처리 버튼을 사용하세요."
                    doc.updated_at = datetime.now()
                    await session.commit()
                    yield f"data: {json.dumps({'message': doc.error_message, 'percent': 100, 'done': True, 'error': True})}\n\n"
                else:
                    is_error = status != "completed"
                    msg = "이미 처리 완료" if status == "completed" else f"상태: {status}"
                    yield f"data: {json.dumps({'message': msg, 'percent': 100, 'done': True, 'error': is_error})}\n\n"
            return

        timeout = 300  # max 5 minutes
        elapsed = 0
        while elapsed < timeout:
            try:
                event = await asyncio.wait_for(q.get(), timeout=1.0)
                yield f"data: {json.dumps(event)}\n\n"
                if event.get("done"):
                    break
            except asyncio.TimeoutError:
                # heartbeat
                yield f"data: {json.dumps({'heartbeat': True})}\n\n"
                elapsed += 1

        # Cleanup
        _progress_queues.pop(doc_id, None)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/", response_model=List[DocumentResponse])
async def list_documents(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """List all uploaded documents."""
    stmt = select(Document).offset(skip).limit(limit).order_by(Document.created_at.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{doc_id}", response_model=DocumentResponse)
async def get_document(doc_id: int, db: AsyncSession = Depends(get_db)):
    """Get document details."""
    stmt = select(Document).where(Document.id == doc_id)
    result = await db.execute(stmt)
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, detail="Document not found")
    return doc


@router.get("/{doc_id}/text")
async def get_document_text(
    doc_id: int,
    max_chars: int = 5000,
    db: AsyncSession = Depends(get_db),
):
    """Get extracted text from a document."""
    stmt = select(Document).where(Document.id == doc_id)
    result = await db.execute(stmt)
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, detail="Document not found")
    if not doc.extracted_path:
        raise HTTPException(400, detail="Document text not yet extracted")

    extracted_path = resolve_doc_path(doc.extracted_path, "extracted")
    if not extracted_path:
        raise HTTPException(404, detail="Extracted text file not found")

    def _read_head_with_trailing_images(path: Path, limit: int) -> tuple[str, int, bool]:
        """앞부분 텍스트를 반환하되, 잘려나간 뒤쪽에 있는 이미지 참조는
        본문 끝에 부록처럼 부착해 미리보기에서 이미지가 보이도록 한다.

        Docling 등은 모든 이미지를 마크다운 끝에 모아 출력하기 때문에,
        단순 슬라이스로는 이미지 참조가 모두 잘려나간다.
        """
        with open(path, encoding="utf-8") as f:
            full = f.read()
        total = len(full)
        head = full[:limit]
        truncated = total > limit
        if truncated:
            tail = full[limit:]
            # 일반 및 꺾쇠 괄호 양쪽 마크다운 이미지 패턴 모두 매치
            trailing_images = re.findall(r'!\[[^\]]*\]\(<?[^)>]+>?\)', tail)
            if trailing_images:
                head = head.rstrip() + "\n\n" + "\n\n".join(trailing_images) + "\n"
        return head, total, truncated

    head, total_chars, truncated = await asyncio.to_thread(
        _read_head_with_trailing_images, extracted_path, max_chars
    )

    if doc.char_count is None:
        try:
            doc.char_count = total_chars
            await db.commit()
        except Exception:
            await db.rollback()

    return {
        "doc_id": doc_id,
        "filename": doc.filename,
        "text": head,
        "total_chars": total_chars,
        "truncated": truncated,
    }


@router.get("/{doc_id}/file")
async def get_document_file(doc_id: int, db: AsyncSession = Depends(get_db)):
    """Serve the original uploaded file for in-browser viewing."""
    stmt = select(Document).where(Document.id == doc_id)
    result = await db.execute(stmt)
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, detail="Document not found")
    if not doc.original_path:
        raise HTTPException(400, detail="Original file path not set")
    path = resolve_doc_path(doc.original_path, "documents")
    if not path:
        raise HTTPException(404, detail="Original file not found on disk")
    media_type_map = {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "txt": "text/plain; charset=utf-8",
        "md":  "text/markdown; charset=utf-8",
        "html": "text/html; charset=utf-8",
        "htm":  "text/html; charset=utf-8",
        "csv":  "text/csv; charset=utf-8",
        "json": "application/json; charset=utf-8",
    }
    media_type = media_type_map.get(doc.file_type or "", "application/octet-stream")
    return FileResponse(
        path=str(path),
        filename=doc.filename,
        media_type=media_type,
        content_disposition_type="inline",  # browser 내에서 바로 표시 (다운로드 방지)
    )


@router.get("/{doc_id}/thumbnail")
async def get_document_thumbnail(doc_id: int, db: AsyncSession = Depends(get_db)):
    """Serve the thumbnail image for a document (PDF first-page preview)."""
    stmt = select(Document).where(Document.id == doc_id)
    result = await db.execute(stmt)
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, detail="Document not found")
    if not doc.thumbnail_path:
        raise HTTPException(404, detail="Thumbnail not available")
    path = resolve_doc_path(doc.thumbnail_path, "thumbnails")
    if not path:
        raise HTTPException(404, detail="Thumbnail file not found")
    return FileResponse(str(path), media_type="image/jpeg",
                        headers={"Cache-Control": "public, max-age=86400"})


@router.get("/{doc_id}/images/{filename}")
async def get_document_image(doc_id: int, filename: str, db: AsyncSession = Depends(get_db)):
    """Serve an image extracted alongside a document."""
    from backend.config import settings
    stmt = select(Document).where(Document.id == doc_id)
    result = await db.execute(stmt)
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, detail="Document not found")
    img_path = settings.EXTRACTED_DIR / f"doc{doc_id}_images" / filename
    if not img_path.exists() or not img_path.is_file():
        raise HTTPException(404, detail="Image not found")
    suffix = img_path.suffix.lower()
    media_map = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                 ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml"}
    return FileResponse(str(img_path), media_type=media_map.get(suffix, "application/octet-stream"))


@router.get("/{doc_id}/extracted-file")
async def get_extracted_file(doc_id: int, db: AsyncSession = Depends(get_db)):
    """Download the extracted markdown file.
    If an images folder exists alongside it, returns a zip containing both.
    """
    from backend.config import settings

    stmt = select(Document).where(Document.id == doc_id)
    result = await db.execute(stmt)
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, detail="Document not found")
    if not doc.extracted_path:
        raise HTTPException(400, detail="Extracted file not available")
    path = resolve_doc_path(doc.extracted_path, "extracted")
    if not path:
        raise HTTPException(404, detail="Extracted file not found on disk")

    file_stem = re.sub(r"[^\w.-]", "_", Path(doc.filename).stem)
    images_dir = settings.EXTRACTED_DIR / f"doc{doc_id}_images"
    image_files = sorted(images_dir.iterdir()) if images_dir.exists() else []

    def _cd(name: str) -> str:
        """Build Content-Disposition with RFC 5987 UTF-8 encoded filename."""
        from urllib.parse import quote
        ascii_name = name.encode("ascii", "ignore").decode()
        return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"

    if image_files:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(path, path.name)
            for img in image_files:
                zf.write(img, f"images/{img.name}")
        return Response(
            content=buf.getvalue(),
            media_type="application/zip",
            headers={"Content-Disposition": _cd(f"{file_stem}.zip")},
        )

    return Response(
        content=path.read_bytes(),
        media_type="application/octet-stream",
        headers={"Content-Disposition": _cd(f"{file_stem}.md")},
    )


@router.post("/{doc_id}/reprocess")
async def reprocess_document(
    doc_id: int,
    background_tasks: BackgroundTasks,
    extractor: str = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Re-process a document that is in pending or failed state."""
    stmt = select(Document).where(Document.id == doc_id)
    result = await db.execute(stmt)
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, detail="Document not found")

    original_path = resolve_doc_path(doc.original_path, "documents") if doc.original_path else None
    if not original_path:
        raise HTTPException(400, detail="원본 파일을 찾을 수 없습니다. 다시 업로드하세요.")

    doc.status = DocumentStatus.PENDING
    doc.error_message = None
    effective_extractor = extractor or doc.extractor or "openDataLoader"
    if extractor:
        doc.extractor = extractor
    await db.commit()

    # Create progress queue
    q: asyncio.Queue = asyncio.Queue()
    _progress_queues[doc_id] = q

    async def push_progress(message: str, percent: int):
        await q.put({"message": message, "percent": percent, "done": percent >= 100, "extractor": effective_extractor})

    filename = doc.filename

    async def reprocess():
        try:
            await push_progress("재처리 시작...", 3)
            # 추출 시작 시각 기록
            from backend.database import AsyncSessionLocal as _ASL2
            async with _ASL2() as _sess2:
                _r2 = await _sess2.execute(select(Document).where(Document.id == doc_id))
                _doc2 = _r2.scalar_one_or_none()
                if _doc2:
                    _doc2.started_at = datetime.now()
                    await _sess2.commit()
            file_content = original_path.read_bytes()
            result = await document_agent.process_upload(
                file_content=file_content,
                filename=filename,
                doc_id=doc_id,
                update_status_fn=_update_document_status,
                progress_cb=push_progress,
                extractor=effective_extractor,
            )
            from backend.database import AsyncSessionLocal
            async with AsyncSessionLocal() as session:
                stmt2 = select(Document).where(Document.id == doc_id)
                db_result = await session.execute(stmt2)
                doc_record = db_result.scalar_one_or_none()
                if doc_record:
                    doc_record.original_path = result.get("original_path", str(original_path))
                    await session.commit()
        except Exception as e:
            logger.error(f"Reprocessing failed for doc {doc_id}: {e}")
            await q.put({"message": f"오류: {e}", "percent": 0, "done": True, "error": True})
        finally:
            await q.put({"done": True, "message": "처리 완료", "percent": 100})

    background_tasks.add_task(reprocess)
    return {"status": "reprocessing", "doc_id": doc_id}


@router.delete("/all", response_model=StatusResponse)
async def delete_all_documents(db: AsyncSession = Depends(get_db)):
    """Delete all documents and their files."""
    # Cancel all active progress queues
    for doc_id, q in list(_progress_queues.items()):
        await q.put({"message": "삭제됨", "percent": 0, "done": True, "error": True})
    _progress_queues.clear()

    stmt = select(Document)
    result = await db.execute(stmt)
    docs = result.scalars().all()

    for doc in docs:
        _delete_document_artifacts(doc)
        rag_service.delete_document(doc.id)
        await db.delete(doc)

    await db.commit()
    return StatusResponse(status="success", message=f"{len(docs)}개 문서 전체 삭제 완료")


@router.delete("/{doc_id}", response_model=StatusResponse)
async def delete_document(doc_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a document and its extracted text."""
    stmt = select(Document).where(Document.id == doc_id)
    result = await db.execute(stmt)
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, detail="Document not found")

    _delete_document_artifacts(doc)
    rag_service.delete_document(doc_id)

    await db.delete(doc)
    await db.commit()
    return StatusResponse(status="success", message=f"Document {doc_id} deleted")
