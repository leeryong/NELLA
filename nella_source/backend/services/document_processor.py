"""
Document processing service.
PDF: OpenDataLoader (default) / MarkItDown / pypdf / Docling
Others: MarkItDown → type-specific fallback
"""
import asyncio
import re
import shutil
import tempfile
from pathlib import Path
from typing import Optional, Tuple, Callable, Awaitable, List
import uuid

from loguru import logger

from backend.config import settings


class DocumentProcessorError(Exception):
    pass


class DocumentProcessor:
    SUPPORTED_EXTENSIONS = {
        ".pdf", ".docx", ".xlsx", ".pptx",
        ".hwp", ".hwpx",
        ".txt", ".md", ".html", ".htm",
        ".csv", ".json",
    }

    # Extractors that support image extraction
    IMAGE_CAPABLE_EXTRACTORS = {"openDataLoader", "docling"}

    def __init__(self):
        self._markitdown = None

    def _get_markitdown(self):
        if self._markitdown is None:
            try:
                from markitdown import MarkItDown
                self._markitdown = MarkItDown()
            except ImportError:
                logger.warning("MarkItDown not available")
                self._markitdown = False
        return self._markitdown

    async def process_document(
        self,
        file_path: Path,
        save_extracted: bool = True,
        progress_cb: Optional[Callable[[str, int], Awaitable[None]]] = None,
        original_filename: Optional[str] = None,
        extractor: str = "openDataLoader",
        extract_images: bool = False,
        doc_id: Optional[int] = None,
    ) -> dict:
        file_path = Path(file_path)
        if not file_path.exists():
            raise DocumentProcessorError(f"File not found: {file_path}")

        ext = file_path.suffix.lower()
        if ext not in self.SUPPORTED_EXTENSIONS:
            raise DocumentProcessorError(
                f"Unsupported file type: {ext}. "
                f"Supported: {', '.join(self.SUPPORTED_EXTENSIONS)}"
            )

        async def progress(msg: str, pct: int):
            logger.info(f"[{pct}%] {msg}")
            if progress_cb:
                await progress_cb(msg, pct)

        await progress(f"파일 확인 중: {file_path.name}", 5)

        # HWP → PDF
        if ext in (".hwp", ".hwpx"):
            await progress("HWP → PDF 변환 중...", 10)
            file_path = await self._convert_hwp_to_pdf(file_path)
            ext = ".pdf"

        # Determine image output dir if needed.
        # Keyed by doc_id so multiple extractors on the same file don't share/overwrite output.
        images_dir = None
        if extract_images and extractor in self.IMAGE_CAPABLE_EXTRACTORS:
            if doc_id is not None:
                images_dir = settings.EXTRACTED_DIR / f"doc{doc_id}_images"
            else:
                stem = re.sub(r"[^\w.-]", "_", Path(original_filename or file_path.name).stem)
                images_dir = settings.EXTRACTED_DIR / f"source_{stem}_images"
            # Reset directory so a re-extract doesn't accumulate stale files from prior runs
            if images_dir.exists():
                shutil.rmtree(images_dir, ignore_errors=True)

        await progress("텍스트 추출 시작", 15)
        text, page_count, image_paths = await self._extract_text(
            file_path, ext, progress, extractor, extract_images, images_dir
        )

        await progress("단어 수 계산 중", 90)
        word_count = len(text.split()) if text else 0

        extracted_path = None
        if save_extracted and text and text.strip():
            await progress("추출 결과 저장 중", 93)
            extracted_path = await self._save_extracted_text(
                file_path, text, original_filename, as_markdown=True, doc_id=doc_id
            )

        await progress("추출 완료", 99)

        result = {
            "text": text,
            "page_count": page_count,
            "word_count": word_count,
            "extracted_path": str(extracted_path) if extracted_path else None,
            "images": image_paths,
            "extractor": extractor,
            "extract_images": extract_images,
        }

        logger.info(
            f"Processed {file_path.name}: "
            f"{word_count} words, {page_count or 'unknown'} pages, "
            f"{len(image_paths)} images"
        )
        return result

    async def _extract_text(
        self,
        file_path: Path,
        ext: str,
        progress: Callable,
        extractor: str = "openDataLoader",
        extract_images: bool = False,
        images_dir: Optional[Path] = None,
    ) -> Tuple[str, Optional[int], List[str]]:
        """Returns (text, page_count, image_paths)"""

        # Non-PDF: MarkItDown first, fallback to type-specific
        if ext != ".pdf":
            try:
                await progress("MarkItDown으로 추출 중...", 30)
                text, page_count = await self._extract_with_markitdown(file_path)
                return text, page_count, []
            except Exception:
                if ext == ".docx":
                    text, page_count = await self._extract_docx_fallback(file_path)
                    return text, page_count, []
                elif ext in (".txt", ".md", ".csv", ".json"):
                    text = file_path.read_text(encoding="utf-8", errors="replace")
                    return text, None, []
                raise DocumentProcessorError(f"추출 실패: {ext}")

        # PDF: dispatch by extractor
        try:
            if extractor == "markitdown":
                await progress("MarkItDown으로 PDF 추출 중...", 30)
                text, page_count = await self._extract_with_markitdown(file_path)
                return text, page_count, []

            elif extractor == "openDataLoader":
                await progress("OpenDataLoader로 추출 중...", 30)
                text, page_count, image_paths = await self._extract_with_opendataloader(
                    file_path, progress, extract_images, images_dir
                )
                return text, page_count, image_paths

            elif extractor == "docling":
                await progress("Docling으로 추출 중...", 30)
                text, page_count, image_paths = await self._extract_with_docling(
                    file_path, progress, extract_images, images_dir
                )
                return text, page_count, image_paths

            elif extractor == "ocr":
                await progress("OCR로 텍스트 인식 중...", 30)
                text, page_count = await self._extract_with_ocr(file_path, progress)
                return text, page_count, []

            else:  # pypdf (default)
                await progress("pypdf로 텍스트 추출 중...", 30)
                text, page_count = await self._extract_pdf_fallback(file_path)
                return text, page_count, []

        except DocumentProcessorError:
            raise
        except Exception as e:
            logger.warning(f"{extractor} failed: {e}, falling back to pypdf")
            await progress("pypdf 폴백으로 추출 중...", 60)
            text, page_count = await self._extract_pdf_fallback(file_path)
            return text, page_count, []

    async def _extract_with_opendataloader(
        self,
        file_path: Path,
        progress: Callable,
        extract_images: bool = False,
        images_dir: Optional[Path] = None,
    ) -> Tuple[str, Optional[int], List[str]]:
        """Extract using opendataloader-pdf, optionally collecting images."""
        loop = asyncio.get_event_loop()
        tmp_dir = Path(tempfile.mkdtemp(prefix="odl_"))

        await progress("PDF 구조 파싱 중...", 35)

        def _run():
            try:
                import opendataloader_pdf
            except ImportError as exc:
                raise DocumentProcessorError(
                    f"opendataloader-pdf 미설치: pip install opendataloader-pdf — {exc}"
                )
            # Homebrew Java 17이 있으면 PATH에 추가 (시스템 Java 8 대신 사용)
            import os as _os
            _java_dirs = [
                "/opt/homebrew/opt/openjdk@17/bin",
                "/opt/homebrew/opt/openjdk/bin",
                "/usr/local/opt/openjdk@17/bin",
            ]
            _extra = ":".join(d for d in _java_dirs if _os.path.isfile(f"{d}/java"))
            if _extra:
                _os.environ["PATH"] = _extra + ":" + _os.environ.get("PATH", "")
                _os.environ["JAVA_HOME"] = _os.path.dirname(_extra.split(":")[0])
            opendataloader_pdf.convert(
                input_path=[str(file_path)],
                output_dir=str(tmp_dir),
                format="markdown",
                quiet=True,
            )

        try:
            await loop.run_in_executor(None, _run)
            await progress("추출 결과 읽는 중...", 75)

            md_files = list(tmp_dir.glob("**/*.md"))
            if not md_files:
                raise DocumentProcessorError("OpenDataLoader: 출력 없음")

            text = md_files[0].read_text(encoding="utf-8", errors="replace")
            page_count = text.count("---") + 1 if "---" in text else None

            # Collect images
            image_paths: List[str] = []
            if extract_images and images_dir:
                image_exts = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
                img_files = [
                    f for f in tmp_dir.glob("**/*")
                    if f.suffix.lower() in image_exts
                ]
                if img_files:
                    images_dir.mkdir(parents=True, exist_ok=True)
                    for img in sorted(img_files):
                        dest = images_dir / img.name
                        shutil.copy2(str(img), str(dest))
                        image_paths.append(str(dest))
                    # Update markdown image refs to use local paths
                    text = self._rewrite_image_refs(text, img_files, images_dir)

            await progress(f"OpenDataLoader 추출 완료 ({page_count or '?'}페이지)", 85)
            return text, page_count, image_paths

        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    async def _extract_with_docling(
        self,
        file_path: Path,
        progress: Callable,
        extract_images: bool = False,
        images_dir: Optional[Path] = None,
    ) -> Tuple[str, Optional[int], List[str]]:
        """Extract using Docling, optionally extracting images."""
        loop = asyncio.get_event_loop()

        def _run():
            try:
                from docling.document_converter import DocumentConverter
            except ImportError as exc:
                raise DocumentProcessorError(
                    f"docling 미설치: pip install docling — {exc}"
                )

            if extract_images:
                try:
                    from docling.datamodel.pipeline_options import PdfPipelineOptions
                    from docling.datamodel.base_models import InputFormat
                    from docling.document_converter import PdfFormatOption

                    pipeline_options = PdfPipelineOptions()
                    pipeline_options.generate_picture_images = True

                    converter = DocumentConverter(
                        format_options={
                            InputFormat.PDF: PdfFormatOption(
                                pipeline_options=pipeline_options
                            )
                        }
                    )
                except Exception:
                    converter = DocumentConverter()
            else:
                converter = DocumentConverter()

            result = converter.convert(str(file_path))
            doc = result.document

            image_paths: List[str] = []

            if extract_images and images_dir:
                images_dir.mkdir(parents=True, exist_ok=True)

                # Try saving images from pictures
                saved_images = {}
                try:
                    for i, picture in enumerate(doc.pictures):
                        img_name = f"image_{i + 1:03d}.png"
                        img_path = images_dir / img_name
                        pil_img = None

                        if hasattr(picture, "image") and picture.image is not None:
                            if hasattr(picture.image, "pil_image"):
                                pil_img = picture.image.pil_image
                            elif hasattr(picture.image, "as_pil"):
                                pil_img = picture.image.as_pil()

                        if pil_img is not None:
                            pil_img.save(str(img_path))
                            image_paths.append(str(img_path))
                            saved_images[i] = img_name
                except Exception as e:
                    logger.warning(f"Docling image extraction failed: {e}")

                # Build markdown with image refs (relative paths)
                try:
                    from docling_core.types.doc import ImageRefMode
                    text = doc.export_to_markdown(image_mode=ImageRefMode.REFERENCED)
                    for i, img_name in saved_images.items():
                        relative = f"images/{img_name}"
                        text = re.sub(
                            rf"!\[([^\]]*)\]\([^)]*picture[^)]*{i}[^)]*\)",
                            rf"![\1]({relative})",
                            text,
                        )
                except Exception:
                    text = doc.export_to_markdown()

                # Append image list at the end if we saved any
                if image_paths and saved_images:
                    text += "\n\n---\n\n## 추출된 이미지\n\n"
                    for img_path in image_paths:
                        text += f"![image](images/{Path(img_path).name})\n\n"
            else:
                text = doc.export_to_markdown()

            return text, image_paths

        text, image_paths = await loop.run_in_executor(None, _run)
        page_count = self._estimate_page_count(text)
        return text, page_count, image_paths

    async def _extract_with_markitdown(self, file_path: Path) -> Tuple[str, Optional[int]]:
        loop = asyncio.get_event_loop()

        def _run():
            md = self._get_markitdown()
            if not md:
                raise ImportError("MarkItDown not available")
            result = md.convert(str(file_path))
            text = result.text_content or ""
            # Clean up form-feed chars and collapsed double-spaces from PDF layout
            text = text.replace("\x0c", "\n")
            text = re.sub(r"  +", " ", text)
            return text

        text = await loop.run_in_executor(None, _run)
        page_count = self._estimate_page_count(text)
        return text, page_count

    async def _extract_pdf_fallback(self, file_path: Path) -> Tuple[str, int]:
        loop = asyncio.get_event_loop()

        def _run():
            try:
                import pypdf
                reader = pypdf.PdfReader(str(file_path))
                pages = [page.extract_text() or "" for page in reader.pages]
                text = "\n\n".join(p for p in pages if p.strip())
                return text, len(reader.pages)
            except ImportError:
                raise DocumentProcessorError("pypdf not installed")

        return await loop.run_in_executor(None, _run)

    async def _extract_with_ocr(self, file_path: Path, progress: Callable) -> Tuple[str, int]:
        """OCR extraction using tesseract — for image-based PDFs."""
        loop = asyncio.get_event_loop()

        def _run():
            try:
                import pytesseract
                from pdf2image import convert_from_path
            except ImportError as e:
                raise DocumentProcessorError(f"OCR 패키지 미설치: {e}")

            # Choose best available languages
            available = pytesseract.get_languages(config="")
            langs = "+".join(l for l in ["kor", "jpn", "eng"] if l in available) or "eng"

            pages = convert_from_path(str(file_path), dpi=250)
            texts = []
            for i, page_img in enumerate(pages):
                page_text = pytesseract.image_to_string(page_img, lang=langs)
                texts.append(page_text)
            return "\n\n".join(texts), len(pages)

        await progress("이미지→텍스트 변환 중 (OCR)...", 40)
        text, page_count = await loop.run_in_executor(None, _run)
        await progress(f"OCR 완료 ({page_count}페이지)", 85)
        return text, page_count

    async def _extract_docx_fallback(self, file_path: Path) -> Tuple[str, Optional[int]]:
        loop = asyncio.get_event_loop()

        def _run():
            try:
                import docx
                doc = docx.Document(str(file_path))
                paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
                return "\n\n".join(paragraphs), None
            except ImportError:
                raise DocumentProcessorError("python-docx not installed")

        return await loop.run_in_executor(None, _run)

    async def _convert_hwp_to_pdf(self, hwp_path: Path) -> Path:
        output_dir = hwp_path.parent
        pdf_path = output_dir / (hwp_path.stem + ".pdf")
        if pdf_path.exists():
            return pdf_path

        logger.info(f"Converting HWP to PDF: {hwp_path.name}")

        try:
            result = await asyncio.create_subprocess_exec(
                "libreoffice", "--headless", "--convert-to", "pdf",
                "--outdir", str(output_dir), str(hwp_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await result.communicate()
            if result.returncode == 0 and pdf_path.exists():
                return pdf_path
        except FileNotFoundError:
            pass

        try:
            result = await asyncio.create_subprocess_exec(
                "hwp2pdf", str(hwp_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(output_dir),
            )
            await result.communicate()
            if pdf_path.exists():
                return pdf_path
        except FileNotFoundError:
            pass

        raise DocumentProcessorError(
            "HWP 변환 실패: libreoffice 또는 hwp2pdf가 필요합니다."
        )

    def _estimate_page_count(self, text: str) -> Optional[int]:
        if not text:
            return None
        words = len(text.split())
        return max(1, words // 300)

    def _rewrite_image_refs(
        self,
        text: str,
        original_files: List[Path],
        images_dir: Path,
    ) -> str:
        """Replace image refs in markdown with relative paths (images/{name}).

        Handles both ``![alt](path/file.png)`` and the angle-bracket form
        ``![alt](<path/file.png>)`` that OpenDataLoader emits.
        """
        for img_file in original_files:
            relative = f"images/{img_file.name}"
            text = re.sub(
                r'(!\[[^\]]*\]\()<?[^)>]*' + re.escape(img_file.name) + r'>?(\))',
                rf'\g<1>{relative}\2',
                text,
            )
        return text

    async def _save_extracted_text(
        self,
        original_path: Path,
        text: str,
        original_filename: Optional[str] = None,
        as_markdown: bool = True,
        doc_id: Optional[int] = None,
    ) -> Path:
        extracted_dir = settings.EXTRACTED_DIR
        if original_filename:
            stem = re.sub(r"[^\w.-]", "_", Path(original_filename).stem)
        else:
            stem = original_path.stem
        ext = ".md" if as_markdown else ".txt"
        prefix = f"doc{doc_id}_" if doc_id else ""
        extracted_path = extracted_dir / f"{prefix}{stem}{ext}"
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: extracted_path.write_text(text, encoding="utf-8")
        )
        return extracted_path

    def chunk_text(
        self,
        text: str,
        chunk_size: int = 2000,
        overlap: int = 200,
    ) -> list:
        if not text:
            return []
        chunks = []
        start = 0
        while start < len(text):
            end = start + chunk_size
            chunks.append(text[start:end])
            start += chunk_size - overlap
        return chunks


# Singleton
document_processor = DocumentProcessor()
