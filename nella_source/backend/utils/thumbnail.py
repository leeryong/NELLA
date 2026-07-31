"""
PDF/document thumbnail generation using PyMuPDF.
Generates a small JPEG preview of the first page.
"""
from pathlib import Path
from loguru import logger


def generate_thumbnail(source_path: str, output_path: str, width: int = 240) -> bool:
    """Render first page of a PDF to a JPEG thumbnail. Returns True on success."""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(source_path)
        if doc.page_count == 0:
            doc.close()
            return False
        page = doc[0]
        zoom = width / page.rect.width
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        pix.save(output_path, output="jpeg", jpg_quality=80)
        doc.close()
        return True
    except Exception as e:
        logger.warning(f"Thumbnail generation failed for {source_path}: {e}")
        return False
