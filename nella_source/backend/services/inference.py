"""
Model inference service.
Loads and runs fine-tuned models for chat completion.
Supports streaming and comparison between base and fine-tuned models.
"""
import asyncio
import json
from pathlib import Path
from typing import AsyncGenerator, Optional

from loguru import logger

from backend.config import settings
from backend.services.model_utils import resolve_model_path as _resolve_model_path


class ModelCache:
    """Simple LRU cache for loaded models."""

    def __init__(self, max_models: int = 2):
        self.max_models = max_models
        self._cache: dict = {}
        self._order: list = []

    def get(self, model_path: str):
        return self._cache.get(model_path)

    def set(self, model_path: str, model_data: dict):
        if model_path in self._cache:
            self._order.remove(model_path)
        elif len(self._cache) >= self.max_models:
            # Evict oldest
            oldest = self._order.pop(0)
            old_data = self._cache.pop(oldest)
            # Free GPU memory if possible
            try:
                import torch
                del old_data["model"]
                torch.cuda.empty_cache()
            except Exception:
                pass
            logger.info(f"Evicted model from cache: {oldest}")

        self._cache[model_path] = model_data
        self._order.append(model_path)

    def remove(self, model_path: str):
        if model_path in self._cache:
            self._order.remove(model_path)
            data = self._cache.pop(model_path)
            try:
                import torch
                del data["model"]
                torch.cuda.empty_cache()
            except Exception:
                pass


# Global model cache
_model_cache = ModelCache(max_models=1)


def _resolve_max_input_length(model, tokenizer, fallback: int = 2048) -> int:
    """Pick an input truncation length that fits the model's actual context window.

    The hardcoded 2048 cap silently truncated long RAG contexts (Korean text is
    token-inefficient → 4 retrieved chunks easily exceed 2048 tokens), leaving
    the LLM without the references the UI showed to the user.

    We reserve 512 tokens for generated output and cap at a sane 8192 ceiling
    to avoid OOM on very-large-window models.
    """
    try:
        model_ctx = getattr(model.config, "max_position_embeddings", None)
    except Exception:
        model_ctx = None
    try:
        tok_ctx = getattr(tokenizer, "model_max_length", None)
        # HF tokenizers use a sentinel like 1_000_000 when not explicitly set
        if tok_ctx is not None and tok_ctx > 100_000:
            tok_ctx = None
    except Exception:
        tok_ctx = None
    ctx = model_ctx or tok_ctx or fallback
    # Reserve room for generated tokens, then cap.
    return max(fallback, min(int(ctx) - 512, 8192))


class InferenceService:
    """
    Inference service for running fine-tuned models.
    Provides chat completion and streaming interfaces.
    """

    async def load_model(self, model_path: str, use_cache: bool = True) -> bool:
        """
        Load a model into memory (or verify it's cached).

        Returns True if successful.
        """
        model_path = _resolve_model_path(model_path)

        if use_cache and _model_cache.get(model_path):
            logger.info(f"Model already loaded: {model_path}")
            return True

        loop = asyncio.get_event_loop()

        def _load():
            try:
                import torch
                from transformers import AutoModelForCausalLM, AutoTokenizer

                logger.info(f"Loading model: {model_path}")

                # Detect best available device
                if torch.cuda.is_available():
                    device = "cuda"
                    torch_dtype = torch.float16
                    device_map = "auto"
                elif torch.backends.mps.is_available():
                    device = "mps"
                    torch_dtype = torch.bfloat16  # PyTorch 2.x MPS는 bfloat16 지원 (훈련과 동일 dtype)
                    device_map = None             # MPS는 device_map="auto" 미지원
                else:
                    device = "cpu"
                    torch_dtype = torch.float32
                    device_map = None

                logger.info(f"Using device: {device}, dtype: {torch_dtype}")

                # Check config.json for actual FP8 quantization (not just path name)
                config_path = Path(model_path) / "config.json"
                model_config = {}
                if config_path.exists():
                    with open(config_path) as f:
                        model_config = json.load(f)

                quant_config = model_config.get("quantization_config", {})
                is_fp8 = quant_config.get("quant_type", "").lower() == "fp8" or \
                         quant_config.get("quant_method", "").lower() == "fp8"
                if is_fp8:
                    capable = (
                        torch.cuda.is_available()
                        and torch.cuda.get_device_capability()[0] >= 9
                    )
                    if not capable:
                        raise RuntimeError(
                            "FP8 양자화 모델은 H100 GPU (Hopper 아키텍처, sm_90+)가 필요합니다. "
                            f"현재 환경({device})에서는 지원되지 않습니다. "
                            "대신 일반 모델(예: google/gemma-2-2b-it, Qwen/Qwen2.5-3B-Instruct)을 사용해 주세요."
                        )

                # Determine config dtype to override load dtype if specified
                config_dtype_str = model_config.get("dtype") or model_config.get("torch_dtype")
                if config_dtype_str == "bfloat16":
                    torch_dtype = torch.bfloat16  # MPS도 bfloat16 지원

                tokenizer = AutoTokenizer.from_pretrained(
                    model_path, trust_remote_code=True
                )
                if tokenizer.pad_token is None:
                    tokenizer.pad_token = tokenizer.eos_token

                # Detect architecture to choose correct AutoModel class
                architectures = model_config.get("architectures", [])
                arch = architectures[0] if architectures else ""
                # Multimodal / conditional generation models (VLMs)
                is_multimodal = any(
                    kw in arch
                    for kw in ("ForConditionalGeneration", "ForImageTextToText", "VisionEncoderDecoder")
                )

                # Check if this is a PEFT/LoRA model
                peft_config_path = Path(model_path) / "adapter_config.json"
                if peft_config_path.exists():
                    from peft import PeftModel
                    with open(peft_config_path) as f:
                        peft_config = json.load(f)
                    base_model_id = peft_config.get("base_model_name_or_path", model_path)

                    # Remap stale paths (e.g. server absolute path → local MODELS_DIR)
                    base_model_id = _resolve_model_path(base_model_id)

                    # If still not found locally, try to derive HF model ID from cache path
                    # e.g. ...hub/models--Org--Model/snapshots/hash → Org/Model
                    if base_model_id and not Path(base_model_id).exists():
                        for part in Path(base_model_id).parts:
                            if part.startswith("models--"):
                                derived = part[len("models--"):].replace("--", "/", 1)
                                logger.info(f"Base model path not found, trying HF ID: {derived}")
                                base_model_id = derived
                                break

                    if device_map:
                        load_kwargs = dict(torch_dtype=torch_dtype, trust_remote_code=True, device_map=device_map)
                    else:
                        # CPU에 실데이터로 적재 후 target device로 이동 (meta tensor 오류 방지)
                        load_kwargs = dict(torch_dtype=torch.float32, trust_remote_code=True, device_map={"": "cpu"})
                    base_model = AutoModelForCausalLM.from_pretrained(base_model_id, **load_kwargs)
                    model = PeftModel.from_pretrained(base_model, model_path)
                    model = model.merge_and_unload()
                    if device_map is None:
                        model = model.to(dtype=torch_dtype, device=device)
                elif is_multimodal:
                    try:
                        from transformers import AutoModelForImageTextToText
                        loader = AutoModelForImageTextToText
                    except ImportError:
                        from transformers import AutoModel
                        loader = AutoModel
                    if device_map:
                        load_kwargs = dict(torch_dtype=torch_dtype, trust_remote_code=True, device_map=device_map)
                    else:
                        load_kwargs = dict(torch_dtype=torch.float32, trust_remote_code=True, device_map={"": "cpu"})
                    model = loader.from_pretrained(model_path, **load_kwargs)
                    if device_map is None:
                        model = model.to(dtype=torch_dtype, device=device)
                else:
                    if device_map:
                        load_kwargs = dict(torch_dtype=torch_dtype, trust_remote_code=True, device_map=device_map)
                    else:
                        load_kwargs = dict(torch_dtype=torch.float32, trust_remote_code=True, device_map={"": "cpu"})
                    model = AutoModelForCausalLM.from_pretrained(model_path, **load_kwargs)
                    if device_map is None:
                        model = model.to(dtype=torch_dtype, device=device)

                model.eval()
                logger.info(f"Model loaded successfully: {model_path} on {device}")
                return {"model": model, "tokenizer": tokenizer, "device": device}
            except Exception as e:
                logger.error(f"Failed to load model {model_path}: {e}")
                raise

        model_data = await loop.run_in_executor(None, _load)
        if use_cache:
            _model_cache.set(model_path, model_data)
        return True

    async def chat_complete(
        self,
        model_path: str,
        messages: list[dict],
        max_new_tokens: int = 512,
        temperature: float = 0.7,
        top_p: float = 0.9,
        do_sample: bool = True,
    ) -> str:
        """
        Generate a chat completion from a fine-tuned model.
        """
        model_path = _resolve_model_path(model_path)

        # Ensure model is loaded
        if not _model_cache.get(model_path):
            success = await self.load_model(model_path)
            if not success:
                raise RuntimeError(f"Failed to load model: {model_path}")

        model_data = _model_cache.get(model_path)
        loop = asyncio.get_event_loop()

        def _generate():
            import torch

            model = model_data["model"]
            tokenizer = model_data["tokenizer"]
            device = model_data.get("device", "cpu")

            # Apply chat template if available
            try:
                text = tokenizer.apply_chat_template(
                    messages,
                    tokenize=False,
                    add_generation_prompt=True,
                )
            except Exception:
                # Fallback format
                text = ""
                for msg in messages:
                    role = msg["role"].upper()
                    content = msg["content"]
                    text += f"{role}: {content}\n"
                text += "ASSISTANT:"

            max_input_len = _resolve_max_input_length(model, tokenizer)
            # 좌측 절단으로 — 가장 오래된 대화 이력보다 최근 사용자 질문과
            # RAG/시스템 지시문이 끝쪽에 위치하므로 우선 보존하는 게 안전.
            try:
                tokenizer.truncation_side = "left"
            except Exception:
                pass
            inputs = tokenizer(
                text,
                return_tensors="pt",
                max_length=max_input_len,
                truncation=True,
            ).to(device)

            generation_config = {
                "max_new_tokens": max_new_tokens,
                "temperature": temperature if do_sample else 1.0,
                "top_p": top_p if do_sample else 1.0,
                "do_sample": do_sample,
                "pad_token_id": tokenizer.eos_token_id,
                "eos_token_id": tokenizer.eos_token_id,
                "repetition_penalty": 1.3,
                "no_repeat_ngram_size": 3,
            }

            try:
                with torch.no_grad():
                    outputs = model.generate(**inputs, **generation_config)
            except RuntimeError as e:
                err_s = str(e).lower()
                if "probability tensor" in err_s or "nan" in err_s or "inf" in err_s:
                    # Logit instability — fall back to greedy decoding
                    logger.warning(f"Sampling failed ({e}); retrying with greedy decoding")
                    generation_config["do_sample"] = False
                    generation_config["temperature"] = 1.0
                    generation_config["top_p"] = 1.0
                    with torch.no_grad():
                        outputs = model.generate(**inputs, **generation_config)
                else:
                    raise

            # Decode only new tokens
            new_tokens = outputs[0][inputs["input_ids"].shape[1]:]
            response = tokenizer.decode(new_tokens, skip_special_tokens=True)
            return response.strip()

        return await loop.run_in_executor(None, _generate)

    async def stream_chat(
        self,
        model_path: str,
        messages: list[dict],
        max_new_tokens: int = 512,
        temperature: float = 0.7,
    ) -> AsyncGenerator[str, None]:
        """
        Stream chat completion tokens.
        """
        model_path = _resolve_model_path(model_path)

        # Ensure model is loaded
        if not _model_cache.get(model_path):
            success = await self.load_model(model_path)
            if not success:
                raise RuntimeError(f"Failed to load model: {model_path}")

        model_data = _model_cache.get(model_path)
        queue = asyncio.Queue()
        loop = asyncio.get_event_loop()

        def _stream():
            try:
                import torch
                from transformers import TextIteratorStreamer
                from threading import Thread

                model = model_data["model"]
                tokenizer = model_data["tokenizer"]
                device = model_data.get("device", "cpu")

                # Format input
                try:
                    text = tokenizer.apply_chat_template(
                        messages,
                        tokenize=False,
                        add_generation_prompt=True,
                    )
                except Exception:
                    text = "\n".join([f"{m['role'].upper()}: {m['content']}" for m in messages])
                    text += "\nASSISTANT:"

                max_input_len = _resolve_max_input_length(model, tokenizer)
                try:
                    tokenizer.truncation_side = "left"
                except Exception:
                    pass
                inputs = tokenizer(
                    text, return_tensors="pt", truncation=True, max_length=max_input_len
                ).to(device)

                streamer = TextIteratorStreamer(
                    tokenizer, skip_prompt=True, skip_special_tokens=True
                )

                generation_kwargs = {
                    **inputs,
                    "streamer": streamer,
                    "max_new_tokens": max_new_tokens,
                    "temperature": temperature,
                    "do_sample": temperature > 0,
                    "pad_token_id": tokenizer.eos_token_id,
                    "repetition_penalty": 1.3,
                    "no_repeat_ngram_size": 3,
                }

                # Run in thread so we can stream
                def generate():
                    with torch.no_grad():
                        model.generate(**generation_kwargs)
                    loop.call_soon_threadsafe(queue.put_nowait, None)  # Signal done

                thread = Thread(target=generate)
                thread.start()

                for token in streamer:
                    loop.call_soon_threadsafe(queue.put_nowait, token)

            except Exception as e:
                logger.error(f"Streaming error: {e}")
                loop.call_soon_threadsafe(queue.put_nowait, None)

        # Start streaming in executor
        asyncio.ensure_future(loop.run_in_executor(None, _stream))

        while True:
            token = await queue.get()
            if token is None:
                break
            yield token

    async def compare_models(
        self,
        base_model_path: str,
        finetuned_model_path: str,
        messages: list[dict],
        **kwargs,
    ) -> dict:
        """Compare responses from base and fine-tuned models."""
        base_response = await self.chat_complete(base_model_path, messages, **kwargs)
        ft_response = await self.chat_complete(finetuned_model_path, messages, **kwargs)

        return {
            "base_model": base_model_path,
            "base_response": base_response,
            "finetuned_model": finetuned_model_path,
            "finetuned_response": ft_response,
        }

    def unload_model(self, model_path: str):
        """Unload a model from cache."""
        _model_cache.remove(model_path)
        logger.info(f"Unloaded model: {model_path}")

    def get_loaded_models(self) -> list[str]:
        """Get list of currently loaded model paths."""
        return list(_model_cache._cache.keys())


# Module-level singleton
inference_service = InferenceService()
