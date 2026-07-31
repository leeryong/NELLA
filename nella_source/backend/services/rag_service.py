"""
RAG service backed by ChromaDB + BGE-M3 embeddings.

Supports multiple named collections. Each RAG DB (managed via the RAG DB page)
has its own Chroma collection; indexing/search operations take an explicit
collection name.
"""
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import Document
from backend.utils.paths import resolve_doc_path
from loguru import logger


def _split_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not text:
        return []

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    current = ""

    for paragraph in paragraphs:
        if len(paragraph) > chunk_size:
            if current:
                chunks.append(current.strip())
                current = ""
            step = max(1, chunk_size - overlap)
            for start in range(0, len(paragraph), step):
                part = paragraph[start:start + chunk_size].strip()
                if part:
                    chunks.append(part)
            continue

        if current and len(current) + len(paragraph) + 2 > chunk_size:
            chunks.append(current.strip())
            tail = current[-overlap:].strip() if overlap > 0 else ""
            current = f"{tail}\n\n{paragraph}" if tail else paragraph
        else:
            current = f"{current}\n\n{paragraph}" if current else paragraph

    if current.strip():
        chunks.append(current.strip())
    return chunks


# RLock (재진입 가능) — _get_collection 이 lock을 잡은 상태에서 _get_client() 를
# 호출하면 다시 같은 lock을 잡으므로 non-reentrant Lock이면 데드락.
# 최초 RAG 검색 시 서버 응답 없음의 원인이었음.
_embedder_lock = threading.RLock()
_embedder = None
_chroma_client = None
_collection_cache: dict[str, object] = {}


def _get_embedder():
    global _embedder
    if _embedder is None:
        with _embedder_lock:
            if _embedder is None:
                # Avoid HuggingFace hub network calls on load — hangs when hub is unreachable.
                import os as _os
                _os.environ.setdefault("HF_HUB_OFFLINE", "1")
                _os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
                from sentence_transformers import SentenceTransformer
                logger.info(f"Loading embedding model: {settings.RAG_EMBEDDING_MODEL}")
                _embedder = SentenceTransformer(settings.RAG_EMBEDDING_MODEL)
                logger.info("Embedding model loaded")
    return _embedder


def _get_client():
    global _chroma_client
    if _chroma_client is None:
        with _embedder_lock:
            if _chroma_client is None:
                import chromadb
                from chromadb.config import Settings as ChromaSettings
                # Disable telemetry — it makes a POST to posthog.chroma.ai that can hang
                # on network issues and blocks the whole indexing pipeline.
                _chroma_client = chromadb.PersistentClient(
                    path=str(settings.RAG_CHROMA_DIR),
                    settings=ChromaSettings(anonymized_telemetry=False),
                )
    return _chroma_client


def _get_collection(chroma_name: str):
    if chroma_name in _collection_cache:
        return _collection_cache[chroma_name]
    with _embedder_lock:
        if chroma_name in _collection_cache:
            return _collection_cache[chroma_name]
        client = _get_client()
        col = client.get_or_create_collection(
            name=chroma_name,
            metadata={"hnsw:space": "cosine"},
        )
        _collection_cache[chroma_name] = col
        logger.info(f"Chroma collection ready: {chroma_name} (count={col.count()})")
        return col


def _chunk_id(doc_id: int, chunk_index: int) -> str:
    return f"doc{doc_id}_chunk{chunk_index}"


class RagService:
    def ensure_ready(self, chroma_name: str) -> None:
        """Warm up the embedder + Chroma collection (blocking).

        Call this from a worker thread before the first per-doc index to make
        first-time BGE-M3 load visible as an explicit progress stage rather
        than making the first doc appear slow.
        """
        _get_embedder()
        _get_collection(chroma_name)

    def index_document_sync(self, doc: Document, chroma_name: str) -> int:
        """Synchronous variant of index_document for use inside asyncio.to_thread.

        The DB is not touched here — the caller updates link rows separately.
        Returns the chunk count written.
        """
        if not doc.extracted_path:
            raise ValueError("Document text not yet extracted")

        path = resolve_doc_path(doc.extracted_path, "extracted")
        if not path:
            raise FileNotFoundError(f"Extracted text file not found: {doc.extracted_path}")

        text = path.read_text(encoding="utf-8")
        chunks = _split_text(
            text,
            chunk_size=max(200, settings.RAG_CHUNK_SIZE),
            overlap=max(0, min(settings.RAG_CHUNK_OVERLAP, settings.RAG_CHUNK_SIZE // 2)),
        )

        collection = _get_collection(chroma_name)
        collection.delete(where={"document_id": doc.id})

        if chunks:
            embedder = _get_embedder()
            embeddings = embedder.encode(
                chunks, normalize_embeddings=True, show_progress_bar=False
            ).tolist()
            collection.add(
                ids=[_chunk_id(doc.id, i) for i in range(len(chunks))],
                documents=chunks,
                embeddings=embeddings,
                metadatas=[
                    {
                        "document_id": doc.id,
                        "chunk_index": i,
                        "filename": doc.filename,
                        "extractor": doc.extractor or "",
                    }
                    for i in range(len(chunks))
                ],
            )

        logger.info(f"Indexed doc {doc.id} into '{chroma_name}' ({len(chunks)} chunks)")
        return len(chunks)

    async def index_document(
        self,
        db: AsyncSession,
        doc: Document,
        chroma_name: str,
    ) -> int:
        """Async wrapper kept for compatibility — runs the sync path in a thread."""
        import asyncio as _asyncio
        return await _asyncio.to_thread(self.index_document_sync, doc, chroma_name)

    async def search(
        self,
        db: AsyncSession,
        query: str,
        chroma_name: str,
        top_k: int | None = None,
        document_ids: Iterable[int] | None = None,
    ) -> list[dict]:
        top_k = top_k or settings.RAG_TOP_K
        ids = [int(x) for x in (document_ids or []) if x]

        # BGE-M3 encode + Chroma query는 sync/CPU-bound이므로 스레드로 오프로드해
        # FastAPI 이벤트 루프가 블로킹되지 않게 한다. 이 락이 없으면 첫 임베더 로드
        # 시 서버 전체가 수십 초 얼음.
        import asyncio as _asyncio

        def _run() -> list[dict]:
            collection = _get_collection(chroma_name)
            if collection.count() == 0:
                return []

            embedder = _get_embedder()
            query_vec = embedder.encode(
                [query], normalize_embeddings=True, show_progress_bar=False
            ).tolist()

            where = {"document_id": {"$in": ids}} if ids else None
            result = collection.query(
                query_embeddings=query_vec,
                n_results=top_k,
                where=where,
            )

            hits = []
            for chunk_text, meta, distance in zip(
                result.get("documents", [[]])[0],
                result.get("metadatas", [[]])[0],
                result.get("distances", [[]])[0],
            ):
                # cosine distance → similarity in [-1, 1]; clamp negatives to 0
                score = max(0.0, 1.0 - float(distance))
                hits.append({
                    "score": round(score, 4),
                    "document_id": int(meta.get("document_id")),
                    "filename": meta.get("filename", ""),
                    "chunk_index": int(meta.get("chunk_index", 0)),
                    "content": chunk_text,
                })
            return hits

        return await _asyncio.to_thread(_run)

    def delete_document(self, doc_id: int, chroma_name: str | None = None) -> None:
        """Remove chunks for a doc from a specific collection, or from all cached collections."""
        try:
            if chroma_name:
                _get_collection(chroma_name).delete(where={"document_id": doc_id})
                return
            # No specific collection: sweep all known collections in this Chroma DB
            client = _get_client()
            for c in client.list_collections():
                try:
                    client.get_collection(c.name).delete(where={"document_id": doc_id})
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"Failed to delete chunks for doc {doc_id}: {e}")

    def delete_collection(self, chroma_name: str) -> None:
        """Drop an entire Chroma collection."""
        try:
            _get_client().delete_collection(chroma_name)
            _collection_cache.pop(chroma_name, None)
            logger.info(f"Dropped Chroma collection: {chroma_name}")
        except Exception as e:
            logger.warning(f"Failed to drop collection {chroma_name}: {e}")

    def collection_count(self, chroma_name: str) -> int:
        try:
            return _get_collection(chroma_name).count()
        except Exception:
            return 0


rag_service = RagService()
