"""
Document Processing Agent.
Orchestrates document upload, processing, and text extraction.
"""
import asyncio
import uuid
from pathlib import Path
from typing import Optional

from loguru import logger

from backend.config import settings
from backend.services.document_processor import document_processor


class DocumentAgent:
    """
    Agent responsible for processing uploaded documents.
    Handles file saving, format conversion, and text extraction.
    """

    async def process_upload(
        self,
        file_content: bytes,
        filename: str,
        doc_id: int,
        update_status_fn=None,
        progress_cb=None,
        extractor: str = "openDataLoader",
        extract_images: bool = False,
    ) -> dict:
        """
        Process an uploaded document file.

        Args:
            file_content: Raw file bytes
            filename: Original filename
            doc_id: Database document ID
            update_status_fn: Async callback to update DB status

        Returns:
            dict with processing results
        """
        logger.info(f"DocumentAgent processing: {filename} (id={doc_id})")

        # Generate unique filename to avoid collisions
        file_ext = Path(filename).suffix.lower()
        unique_name = f"{doc_id}_{uuid.uuid4().hex[:8]}{file_ext}"
        save_path = settings.DOCUMENTS_DIR / unique_name

        # Save original file
        save_path.write_bytes(file_content)
        logger.info(f"Saved document to {save_path}")

        # Update status to processing
        if update_status_fn:
            await update_status_fn(doc_id, "processing")

        try:
            # Process document (with progress callback if provided)
            result = await document_processor.process_document(
                save_path,
                progress_cb=progress_cb,
                original_filename=filename,
                extractor=extractor,
                extract_images=extract_images,
                doc_id=doc_id,
            )

            if update_status_fn:
                await update_status_fn(doc_id, "completed", result)

            return {
                "success": True,
                "doc_id": doc_id,
                "original_path": str(save_path),
                "extracted_path": result.get("extracted_path"),
                "page_count": result.get("page_count"),
                "word_count": result.get("word_count"),
                "text_preview": result.get("text", "")[:500],
            }

        except Exception as e:
            logger.error(f"Document processing failed for {filename}: {e}")
            if update_status_fn:
                await update_status_fn(doc_id, "failed", error=str(e))
            raise

    async def get_text_chunks(
        self,
        doc_id: int,
        extracted_path: str,
        chunk_size: int = 2000,
        overlap: int = 200,
    ) -> list[str]:
        """
        Get text chunks from an extracted document for data generation.
        """
        extracted_path = Path(extracted_path)
        if not extracted_path.exists():
            raise FileNotFoundError(f"Extracted text not found: {extracted_path}")

        text = extracted_path.read_text(encoding="utf-8")
        chunks = document_processor.chunk_text(text, chunk_size, overlap)

        logger.info(
            f"Split document {doc_id} into {len(chunks)} chunks "
            f"(chunk_size={chunk_size})"
        )
        return chunks

    def validate_file(self, filename: str, file_size: int) -> dict:
        """Validate file before upload."""
        errors = []
        ext = Path(filename).suffix.lower()

        if ext not in document_processor.SUPPORTED_EXTENSIONS:
            errors.append(
                f"Unsupported file type: {ext}. "
                f"Supported: {', '.join(document_processor.SUPPORTED_EXTENSIONS)}"
            )

        max_size_mb = 100
        if file_size > max_size_mb * 1024 * 1024:
            errors.append(f"File too large. Maximum size: {max_size_mb}MB")

        return {"valid": len(errors) == 0, "errors": errors}


# Module-level singleton
document_agent = DocumentAgent()
