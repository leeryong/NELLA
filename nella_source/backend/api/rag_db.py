"""
RAG DB (VectorDB collection) management API.

Each RAG DB is a named Chroma collection with a set of documents indexed into it.
Users manage collections on the RAG DB page (step 9), then pick one to use in
the Chat page (step 10).

Indexing runs in a background asyncio task so create/update/reindex return
immediately with status='indexing'. Progress fields on the collection row are
updated as work advances and polled by the frontend.
"""
import asyncio
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from loguru import logger

from backend.database import (
    AsyncSessionLocal,
    get_db, Document, DocumentStatus,
    RagCollection, RagCollectionDocument,
)
from backend.schemas.models import (
    RagCollectionResponse, RagCollectionDocInfo,
    CreateRagCollectionRequest, UpdateRagCollectionRequest,
    StatusResponse,
)
from backend.services.rag_service import rag_service
from backend.config import settings

router = APIRouter(prefix="/rag-db", tags=["rag-db"])

# Track running indexing tasks so we don't launch two concurrent runs on the same collection
_indexing_tasks: dict[int, asyncio.Task] = {}


def _content_disposition(filename: str) -> str:
    """Content-Disposition 헤더를 안전하게 구성 (파일명에 한글 등 non-latin1 문자가 있어도 동작).

    latin-1 인코딩 가능한 ASCII fallback(filename)과 RFC 5987 UTF-8 인코딩(filename*)을 함께 넣는다.
    """
    from urllib.parse import quote
    ascii_name = filename.encode("ascii", "ignore").decode() or "download"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"


def _slugify(name: str) -> str:
    """Chroma requires ASCII names 3-63 chars, no leading/trailing punct."""
    s = re.sub(r"[^a-zA-Z0-9_-]+", "-", name.strip()).strip("-_")
    if len(s) < 3:
        s = f"col-{s}" if s else "col"
    return s[:50].lower()


async def _to_response(collection: RagCollection, db: AsyncSession) -> RagCollectionResponse:
    """Serialize a collection with per-doc info (needs a fresh doc lookup)."""
    doc_ids = [cd.document_id for cd in collection.documents]
    docs_map: dict[int, Document] = {}
    if doc_ids:
        result = await db.execute(select(Document).where(Document.id.in_(doc_ids)))
        docs_map = {d.id: d for d in result.scalars().all()}

    doc_infos: list[RagCollectionDocInfo] = []
    for cd in collection.documents:
        doc = docs_map.get(cd.document_id)
        doc_infos.append(RagCollectionDocInfo(
            document_id=cd.document_id,
            filename=doc.filename if doc else f"(missing #{cd.document_id})",
            chunk_count=cd.chunk_count or 0,
            indexed_at=cd.indexed_at,
        ))
    doc_infos.sort(key=lambda d: d.filename)

    return RagCollectionResponse(
        id=collection.id,
        name=collection.name,
        description=collection.description or "",
        chroma_name=collection.chroma_name,
        chunk_count=collection.chunk_count or 0,
        embedding_model=collection.embedding_model,
        document_count=len(doc_infos),
        documents=doc_infos,
        status=collection.status or "idle",
        progress_stage=collection.progress_stage,
        progress_current=collection.progress_current or 0,
        progress_total=collection.progress_total or 0,
        created_at=collection.created_at,
        updated_at=collection.updated_at,
    )


@router.get("", response_model=list[RagCollectionResponse])
async def list_collections(db: AsyncSession = Depends(get_db)):
    stmt = select(RagCollection).options(selectinload(RagCollection.documents)).order_by(RagCollection.created_at.desc())
    result = await db.execute(stmt)
    collections = result.scalars().all()
    return [await _to_response(c, db) for c in collections]


@router.get("/{collection_id}", response_model=RagCollectionResponse)
async def get_collection(collection_id: int, db: AsyncSession = Depends(get_db)):
    stmt = select(RagCollection).options(selectinload(RagCollection.documents)).where(RagCollection.id == collection_id)
    result = await db.execute(stmt)
    collection = result.scalar_one_or_none()
    if not collection:
        raise HTTPException(404, detail="RAG collection not found")
    return await _to_response(collection, db)


async def _ensure_unique_chroma_name(db: AsyncSession, base: str) -> str:
    """Return a chroma_name based on `base` that isn't already used."""
    candidate = base
    n = 1
    while True:
        stmt = select(RagCollection).where(RagCollection.chroma_name == candidate)
        result = await db.execute(stmt)
        if result.scalar_one_or_none() is None:
            return candidate
        n += 1
        candidate = f"{base}-{n}"


async def _set_progress(
    collection_id: int,
    *,
    status: str | None = None,
    stage: str | None = None,
    current: int | None = None,
    total: int | None = None,
    chunk_count: int | None = None,
    embedding_model: str | None = None,
) -> None:
    """Atomically update progress fields on a collection row from a background task."""
    async with AsyncSessionLocal() as db:
        collection = await db.get(RagCollection, collection_id)
        if not collection:
            return
        if status is not None:
            collection.status = status
        if stage is not None:
            collection.progress_stage = stage
        if current is not None:
            collection.progress_current = current
        if total is not None:
            collection.progress_total = total
        if chunk_count is not None:
            collection.chunk_count = chunk_count
        if embedding_model is not None:
            collection.embedding_model = embedding_model
        await db.commit()


async def _run_indexing_bg(collection_id: int, doc_ids: list[int], purge_first: bool) -> None:
    """Background: index docs into the collection, updating progress on the row.

    When purge_first=True, drops the entire Chroma collection before re-indexing
    (used by reindex). Otherwise chunks are replaced per-document.
    """
    try:
        # Fetch collection + docs in a short-lived session, then release
        async with AsyncSessionLocal() as db:
            stmt = (
                select(RagCollection)
                .options(selectinload(RagCollection.documents))
                .where(RagCollection.id == collection_id)
            )
            result = await db.execute(stmt)
            collection = result.scalar_one_or_none()
            if not collection:
                logger.warning(f"[rag-index] collection {collection_id} disappeared")
                return
            chroma_name = collection.chroma_name

            docs_res = await db.execute(select(Document).where(Document.id.in_(doc_ids)))
            docs = docs_res.scalars().all()

        total_docs = len(docs)
        await _set_progress(
            collection_id,
            status="indexing",
            stage="임베딩 모델 준비 중...",
            current=0,
            total=total_docs,
        )

        if purge_first:
            rag_service.delete_collection(chroma_name)

        # Warm up the embedder so the "model loading" stage is visible before
        # per-doc encoding starts (BGE-M3 first-load can take a while).
        await asyncio.to_thread(rag_service.ensure_ready, chroma_name)

        now = datetime.now()
        skipped: list[int] = []
        for idx, doc in enumerate(docs, start=1):
            if doc.status != DocumentStatus.COMPLETED or not doc.extracted_path:
                skipped.append(doc.id)
                await _set_progress(
                    collection_id,
                    stage=f"건너뜀 ({idx}/{total_docs}): {doc.filename}",
                    current=idx,
                )
                continue
            await _set_progress(
                collection_id,
                stage=f"인덱싱 중 ({idx}/{total_docs}): {doc.filename}",
                current=idx - 1,
            )
            try:
                count = await asyncio.to_thread(
                    rag_service.index_document_sync, doc, chroma_name
                )
            except Exception as e:
                logger.warning(f"[rag-index] doc {doc.id} failed: {e}")
                skipped.append(doc.id)
                await _set_progress(
                    collection_id,
                    stage=f"실패 ({idx}/{total_docs}): {doc.filename} — {str(e)[:120]}",
                    current=idx,
                )
                continue

            # Upsert the link row (replace any existing)
            async with AsyncSessionLocal() as db:
                await db.execute(
                    __import__("sqlalchemy").text(
                        "DELETE FROM rag_collection_documents "
                        "WHERE collection_id=:cid AND document_id=:did"
                    ),
                    {"cid": collection_id, "did": doc.id},
                )
                db.add(RagCollectionDocument(
                    collection_id=collection_id,
                    document_id=doc.id,
                    chunk_count=count,
                    indexed_at=now,
                ))
                await db.commit()

            await _set_progress(
                collection_id,
                current=idx,
            )

        final_chunks = rag_service.collection_count(chroma_name)
        summary = f"완료 · {total_docs - len(skipped)}/{total_docs}문서"
        if skipped:
            summary += f" (건너뜀 {len(skipped)})"
        await _set_progress(
            collection_id,
            status="completed",
            stage=summary,
            current=total_docs,
            total=total_docs,
            chunk_count=final_chunks,
            embedding_model=settings.RAG_EMBEDDING_MODEL,
        )
    except Exception as e:
        logger.exception(f"[rag-index] collection {collection_id} crashed")
        await _set_progress(
            collection_id,
            status="failed",
            stage=f"오류: {str(e)[:200]}",
        )
    finally:
        _indexing_tasks.pop(collection_id, None)


def _launch_indexing(collection_id: int, doc_ids: list[int], purge_first: bool = False) -> None:
    """Kick off (or replace) the background indexing task for a collection."""
    existing = _indexing_tasks.get(collection_id)
    if existing and not existing.done():
        existing.cancel()
    task = asyncio.create_task(_run_indexing_bg(collection_id, doc_ids, purge_first))
    _indexing_tasks[collection_id] = task


@router.post("", response_model=RagCollectionResponse)
async def create_collection(
    req: CreateRagCollectionRequest,
    db: AsyncSession = Depends(get_db),
):
    # Uniqueness of user-facing name
    existing = await db.execute(select(RagCollection).where(RagCollection.name == req.name))
    if existing.scalar_one_or_none():
        raise HTTPException(400, detail=f"이미 존재하는 이름입니다: {req.name}")

    chroma_name = await _ensure_unique_chroma_name(db, _slugify(req.name))
    doc_ids = list(req.document_ids or [])
    collection = RagCollection(
        name=req.name.strip(),
        description=req.description or "",
        chroma_name=chroma_name,
        documents=[],  # pre-init to avoid async lazy-load after flush
        status="pending" if doc_ids else "idle",
        progress_stage="대기열 등록됨" if doc_ids else None,
        progress_current=0,
        progress_total=len(doc_ids),
    )
    db.add(collection)
    await db.commit()

    if doc_ids:
        _launch_indexing(collection.id, doc_ids, purge_first=False)

    # Reload with docs (relationship will be empty until indexing writes link rows)
    stmt = select(RagCollection).options(selectinload(RagCollection.documents)).where(RagCollection.id == collection.id)
    result = await db.execute(stmt)
    return await _to_response(result.scalar_one(), db)


@router.patch("/{collection_id}", response_model=RagCollectionResponse)
async def update_collection(
    collection_id: int,
    req: UpdateRagCollectionRequest,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(RagCollection).options(selectinload(RagCollection.documents)).where(RagCollection.id == collection_id)
    result = await db.execute(stmt)
    collection = result.scalar_one_or_none()
    if not collection:
        raise HTTPException(404, detail="RAG collection not found")

    if req.name is not None and req.name.strip() != collection.name:
        dup = await db.execute(
            select(RagCollection).where(RagCollection.name == req.name.strip(), RagCollection.id != collection_id)
        )
        if dup.scalar_one_or_none():
            raise HTTPException(400, detail=f"이미 존재하는 이름입니다: {req.name}")
        collection.name = req.name.strip()

    if req.description is not None:
        collection.description = req.description

    new_ids: list[int] = []
    if req.document_ids is not None:
        current_ids = {cd.document_id for cd in collection.documents}
        target_ids = set(req.document_ids)

        # Remove docs no longer wanted (both from Chroma and the link rows)
        for doc_id in current_ids - target_ids:
            rag_service.delete_document(doc_id, collection.chroma_name)
            for link in list(collection.documents):
                if link.document_id == doc_id:
                    collection.documents.remove(link)

        new_ids = list(target_ids - current_ids)
        if new_ids:
            collection.status = "pending"
            collection.progress_stage = "대기열 등록됨"
            collection.progress_current = 0
            collection.progress_total = len(new_ids)

        collection.chunk_count = rag_service.collection_count(collection.chroma_name)

    await db.commit()

    if new_ids:
        _launch_indexing(collection_id, new_ids, purge_first=False)

    stmt = select(RagCollection).options(selectinload(RagCollection.documents)).where(RagCollection.id == collection.id)
    result = await db.execute(stmt)
    return await _to_response(result.scalar_one(), db)


@router.post("/{collection_id}/reindex", response_model=RagCollectionResponse)
async def reindex_collection(collection_id: int, db: AsyncSession = Depends(get_db)):
    """Rebuild every document currently linked to this collection."""
    stmt = select(RagCollection).options(selectinload(RagCollection.documents)).where(RagCollection.id == collection_id)
    result = await db.execute(stmt)
    collection = result.scalar_one_or_none()
    if not collection:
        raise HTTPException(404, detail="RAG collection not found")

    doc_ids = [cd.document_id for cd in collection.documents]

    # Wipe link rows now — the background task will recreate them per-doc as it goes
    collection.documents.clear()
    collection.chunk_count = 0
    collection.status = "pending" if doc_ids else "idle"
    collection.progress_stage = "재인덱스 대기열 등록됨" if doc_ids else None
    collection.progress_current = 0
    collection.progress_total = len(doc_ids)
    await db.commit()

    if doc_ids:
        _launch_indexing(collection_id, doc_ids, purge_first=True)

    stmt = select(RagCollection).options(selectinload(RagCollection.documents)).where(RagCollection.id == collection.id)
    result = await db.execute(stmt)
    return await _to_response(result.scalar_one(), db)


@router.delete("/{collection_id}", response_model=StatusResponse)
async def delete_collection(collection_id: int, db: AsyncSession = Depends(get_db)):
    stmt = select(RagCollection).where(RagCollection.id == collection_id)
    result = await db.execute(stmt)
    collection = result.scalar_one_or_none()
    if not collection:
        raise HTTPException(404, detail="RAG collection not found")

    rag_service.delete_collection(collection.chroma_name)
    await db.delete(collection)
    await db.commit()
    return StatusResponse(status="success", message=f"RAG DB '{collection.name}' 삭제 완료")


@router.get("/{collection_id}/download")
async def download_collection(collection_id: int, db: AsyncSession = Depends(get_db)):
    """RAG DB(Chroma 컬렉션)을 zip으로 내보낸다.

    아카이브 구성:
    - manifest.json: 컬렉션 메타데이터 (name/chroma_name/embedding_model/문서 목록 등)
    - chunks.jsonl: 청크 한 줄당 {id, document, embedding, metadata}
    - README.md: 재사용 방법 간단 안내
    """
    import io
    import json as _json
    import tempfile
    import zipfile
    from pathlib import Path as _Path
    from fastapi.responses import StreamingResponse

    stmt = (
        select(RagCollection)
        .where(RagCollection.id == collection_id)
        .options(selectinload(RagCollection.documents))
    )
    result = await db.execute(stmt)
    collection = result.scalar_one_or_none()
    if not collection:
        raise HTTPException(404, detail="RAG collection not found")

    # 문서 이름을 함께 넣어주기 위한 조회
    doc_ids = [d.document_id for d in collection.documents]
    doc_map: dict[int, str] = {}
    if doc_ids:
        d_result = await db.execute(select(Document).where(Document.id.in_(doc_ids)))
        for d in d_result.scalars().all():
            doc_map[d.id] = d.filename

    documents_meta = [
        {
            "document_id": d.document_id,
            "filename": doc_map.get(d.document_id, ""),
            "chunk_count": d.chunk_count,
            "indexed_at": d.indexed_at.isoformat() if d.indexed_at else None,
        }
        for d in collection.documents
    ]

    manifest = {
        "nella_export_type": "rag_collection",
        "nella_export_version": 1,
        "id": collection.id,
        "name": collection.name,
        "description": collection.description or "",
        "chroma_name": collection.chroma_name,
        "embedding_model": collection.embedding_model,
        "chunk_count": collection.chunk_count,
        "status": collection.status,
        "created_at": collection.created_at.isoformat() if collection.created_at else None,
        "documents": documents_meta,
    }

    # Chroma 접근·zip 생성은 스레드로 오프로드 (event loop 안 얼게)
    loop = asyncio.get_event_loop()

    def _create_zip() -> str:
        chroma_col = None
        try:
            from backend.services.rag_service import _get_collection as _get_col
            chroma_col = _get_col(collection.chroma_name)
        except Exception as e:
            logger.warning(f"Chroma collection not accessible on export: {e}")

        tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
        tmp.close()
        with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
            zf.writestr(
                "manifest.json",
                _json.dumps(manifest, ensure_ascii=False, indent=2),
            )
            # chunks.jsonl 스트리밍 write
            buf = io.StringIO()
            if chroma_col is not None:
                try:
                    # get 전체 (embeddings 포함) — 큰 컬렉션은 배치로 처리해야 하지만,
                    # NELLA 사용 범위(문서 몇 개 ~ 수천 청크) 에선 한 번에 뽑아도 OK.
                    dump = chroma_col.get(include=["documents", "embeddings", "metadatas"])
                    ids = dump.get("ids")
                    docs = dump.get("documents")
                    embs = dump.get("embeddings")
                    metas = dump.get("metadatas")
                    ids = ids if ids is not None else []
                    docs = docs if docs is not None else []
                    embs = embs if embs is not None else []
                    metas = metas if metas is not None else []
                    for i, chunk_id in enumerate(ids):
                        row = {
                            "id": chunk_id,
                            "document": docs[i] if i < len(docs) else "",
                            "embedding": (embs[i].tolist() if hasattr(embs[i], "tolist") else embs[i]) if i < len(embs) else None,
                            "metadata": metas[i] if i < len(metas) else {},
                        }
                        buf.write(_json.dumps(row, ensure_ascii=False))
                        buf.write("\n")
                except Exception as e:
                    logger.warning(f"Failed to dump chunks for {collection.chroma_name}: {e}")
            zf.writestr("chunks.jsonl", buf.getvalue())

            readme = (
                f"# NELLA RAG DB Export: {collection.name}\n\n"
                f"이 아카이브는 NELLA에서 만든 RAG DB(Chroma 컬렉션)의 스냅샷입니다.\n\n"
                f"## 구성\n\n"
                f"- `manifest.json` — 컬렉션 메타데이터 (이름, 임베딩 모델, 원본 문서 목록 등)\n"
                f"- `chunks.jsonl` — 청크 한 줄당 `{{id, document, embedding, metadata}}`\n\n"
                f"## 재사용\n\n"
                f"동일한 임베딩 모델(`{collection.embedding_model or 'BAAI/bge-m3'}`)을 사용해서\n"
                f"chromadb에 같은 이름으로 `add(ids=..., documents=..., embeddings=..., metadatas=...)`\n"
                f"하면 그대로 복원됩니다.\n"
            )
            zf.writestr("README.md", readme)
        return tmp.name

    zip_path = await loop.run_in_executor(None, _create_zip)

    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in (collection.name or f"ragdb{collection_id}"))
    filename = f"NELLA_RAG_{safe_name}_{collection_id}.zip"

    async def _stream():
        try:
            with open(zip_path, "rb") as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    yield chunk
        finally:
            _Path(zip_path).unlink(missing_ok=True)

    return StreamingResponse(
        _stream(),
        media_type="application/zip",
        headers={"Content-Disposition": _content_disposition(filename)},
    )
