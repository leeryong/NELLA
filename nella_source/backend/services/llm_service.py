"""
LLM Service abstraction layer.
Supports OpenAI, Anthropic Claude, and local Ollama.
Provides async interface for all operations.
"""
import asyncio
import json
from abc import ABC, abstractmethod
from typing import AsyncGenerator, Optional, Union

from loguru import logger
from tenacity import (
    retry, stop_after_attempt, wait_exponential, retry_if_exception_type,
    wait_random_exponential, retry_if_exception,
)

from backend.config import settings
from backend.services.api_limiter import llm_api_lock as _llm_semaphore

try:
    import json_repair as _json_repair  # type: ignore[import-not-found]
except ImportError:
    _json_repair = None


def _parse_json_array(response: str) -> list[dict]:
    """Robust JSON-array parser for LLM outputs.

    1. Strict json.loads on the bracketed slice
    2. Falls back to json-repair (handles trailing commas, missing commas,
       unescaped quotes, truncated tails — common LLM JSON breakage)
    3. Returns [] if both fail.
    """
    if not response:
        return []
    start = response.find("[")
    end = response.rfind("]") + 1
    candidate = response[start:end] if start >= 0 and end > start else response
    try:
        parsed = json.loads(candidate)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            # Some models wrap the array in {"data": [...]} — pick first list value
            for v in parsed.values():
                if isinstance(v, list):
                    return v
        return []
    except (json.JSONDecodeError, ValueError):
        pass
    if _json_repair is not None:
        try:
            repaired = _json_repair.loads(candidate)
            if isinstance(repaired, list):
                logger.info("JSON repaired successfully")
                return repaired
            if isinstance(repaired, dict):
                for v in repaired.values():
                    if isinstance(v, list):
                        logger.info("JSON repaired successfully (unwrapped)")
                        return v
        except Exception as e:
            logger.warning(f"json-repair also failed: {e}")
    return []


def _is_not_rate_limit(exc: BaseException) -> bool:
    """Return True for transient errors worth retrying; False for rate limits (handled by caller)."""
    name = type(exc).__name__
    msg = str(exc).lower()
    return "ratelimit" not in name.lower() and "rate" not in msg and "quota" not in msg


class LLMError(Exception):
    pass


class LLMProvider(ABC):
    """Abstract base for LLM providers."""

    @abstractmethod
    async def complete(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 2048,
        **kwargs,
    ) -> str:
        """Generate a completion."""
        pass

    @abstractmethod
    async def stream(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 2048,
        **kwargs,
    ) -> AsyncGenerator[str, None]:
        """Stream a completion."""
        pass


_JSON_ARRAY_WRAPPER_INSTRUCTION = (
    "\n\nOUTPUT FORMAT: Return a single JSON object with exactly one key "
    '"items", whose value is the JSON array described above — '
    '{"items": [ ... ]}. Do not return a bare object for a single element; '
    '"items" must always be an array, even when it holds one entry.'
)


def _with_json_array_wrapper(messages: list[dict]) -> list[dict]:
    """Copy of *messages* whose system prompt also asks for an {"items": [...]}
    wrapper, so OpenAI's json_object mode can't collapse an array into one object.

    Appends to the first system message when there is one (models weight the
    system prompt for format rules); otherwise prepends a new system message.
    """
    out = [dict(m) for m in messages]
    for m in out:
        if m.get("role") == "system":
            m["content"] = f"{m.get('content', '')}{_JSON_ARRAY_WRAPPER_INSTRUCTION}"
            return out
    return [{"role": "system", "content": _JSON_ARRAY_WRAPPER_INSTRUCTION.strip()}] + out


def _openai_token_kwargs(model: str, max_tokens: int, temperature: float) -> dict:
    """Build model-appropriate OpenAI chat params.

    Newer OpenAI models reject the legacy `max_tokens` (they require
    `max_completion_tokens`), and the reasoning models (o1/o3/o4/gpt-5) also
    reject any non-default `temperature`. This returns the right combination so
    a single code path works across classic and reasoning models.
    """
    kw: dict = {"max_completion_tokens": max_tokens}
    m = (model or "").lower()
    is_reasoning = m.startswith(("o1", "o3", "o4", "gpt-5"))
    if not is_reasoning:
        kw["temperature"] = temperature
    return kw


class OpenAIProvider(LLMProvider):
    """OpenAI API provider."""

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None, base_url: Optional[str] = None):
        self.api_key = api_key or settings.OPENAI_API_KEY
        self.model = model or settings.OPENAI_MODEL
        self.base_url = base_url or settings.OPENAI_BASE_URL
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                from openai import AsyncOpenAI
                kwargs = {"api_key": self.api_key}
                if self.base_url:
                    kwargs["base_url"] = self.base_url
                self._client = AsyncOpenAI(**kwargs)
            except ImportError:
                raise LLMError("openai package not installed")
        return self._client

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_random_exponential(multiplier=1, min=2, max=8),
        retry=retry_if_exception(_is_not_rate_limit),
    )
    async def complete(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 2048,
        **kwargs,
    ) -> str:
        async with _llm_semaphore:
            client = self._get_client()
            # json_mode=True → OpenAI JSON 모드 활성화 (response_format)
            #
            # OpenAI's json_object mode requires the top-level value to be an
            # OBJECT, but every json_mode caller here asks for an ARRAY of pairs.
            # Left alone the model complies with response_format and returns a
            # single {"question": ..., "answer": ...} object; _parse_json_array
            # then finds no list and returns [], so every chunk yields zero pairs
            # and generation fails with "Failed to generate any QA pairs".
            # (Anthropic never saw this — it ignores **kwargs entirely.)
            # Asking for a one-key wrapper keeps json mode's benefit (no markdown
            # fences) while preserving the array: _parse_json_array already
            # unwraps the first list value it finds in an object.
            if kwargs.pop("json_mode", False) and "response_format" not in kwargs:
                kwargs["response_format"] = {"type": "json_object"}
                messages = _with_json_array_wrapper(messages)
            response = await client.chat.completions.create(
                model=self.model,
                messages=messages,
                **_openai_token_kwargs(self.model, max_tokens, temperature),
                **kwargs,
            )
            return response.choices[0].message.content

    async def stream(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 2048,
        **kwargs,
    ) -> AsyncGenerator[str, None]:
        client = self._get_client()
        async with await client.chat.completions.create(
            model=self.model,
            messages=messages,
            stream=True,
            **_openai_token_kwargs(self.model, max_tokens, temperature),
            **kwargs,
        ) as stream:
            async for chunk in stream:
                if chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content


class AnthropicProvider(LLMProvider):
    """Anthropic Claude API provider."""

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.api_key = api_key or settings.ANTHROPIC_API_KEY
        self.model = model or settings.ANTHROPIC_MODEL
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                import anthropic
                self._client = anthropic.AsyncAnthropic(api_key=self.api_key)
            except ImportError:
                raise LLMError("anthropic package not installed")
        return self._client

    @retry(
        stop=stop_after_attempt(6),
        wait=wait_random_exponential(multiplier=2, min=4, max=90),
    )
    async def complete(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 2048,
        **kwargs,
    ) -> str:
        async with _llm_semaphore:
            client = self._get_client()
            # Separate system message
            system_msg = None
            user_messages = []
            for msg in messages:
                if msg["role"] == "system":
                    system_msg = msg["content"]
                else:
                    user_messages.append(msg)

            create_kwargs = {
                "model": self.model,
                "messages": user_messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            if system_msg:
                create_kwargs["system"] = system_msg

            response = await client.messages.create(**create_kwargs)
            return response.content[0].text

    async def stream(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 2048,
        **kwargs,
    ) -> AsyncGenerator[str, None]:
        client = self._get_client()
        system_msg = None
        user_messages = []
        for msg in messages:
            if msg["role"] == "system":
                system_msg = msg["content"]
            else:
                user_messages.append(msg)

        create_kwargs = {
            "model": self.model,
            "messages": user_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if system_msg:
            create_kwargs["system"] = system_msg

        async with client.messages.stream(**create_kwargs) as stream:
            async for text in stream.text_stream:
                yield text


class OllamaProvider(LLMProvider):
    """Local Ollama provider."""

    def __init__(self, base_url: Optional[str] = None, model: Optional[str] = None):
        self.base_url = base_url or settings.OLLAMA_BASE_URL
        self.model = model or settings.OLLAMA_MODEL

    async def complete(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 2048,
        **kwargs,
    ) -> str:
        import aiohttp
        url = f"{self.base_url}/api/chat"
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    raise LLMError(f"Ollama error {resp.status}: {text}")
                data = await resp.json()
                return data["message"]["content"]

    async def stream(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 2048,
        **kwargs,
    ) -> AsyncGenerator[str, None]:
        import aiohttp
        url = f"{self.base_url}/api/chat"
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload) as resp:
                async for line in resp.content:
                    if line:
                        try:
                            data = json.loads(line)
                            if not data.get("done"):
                                yield data["message"]["content"]
                        except json.JSONDecodeError:
                            pass


class MockProvider(LLMProvider):
    """Mock provider for testing without real API keys."""

    async def complete(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 2048,
        **kwargs,
    ) -> str:
        """Return a mock response based on the last user message."""
        last_msg = messages[-1]["content"] if messages else "Hello"
        logger.debug(f"Mock LLM complete called with {len(messages)} messages")

        # Generate mock Q&A if asked to generate training data
        if "question" in last_msg.lower() and "answer" in last_msg.lower():
            return json.dumps([
                {
                    "question": "What is the main topic of this document?",
                    "answer": "The document covers various important topics related to the subject matter.",
                    "context": "Based on the provided text content."
                },
                {
                    "question": "What are the key findings?",
                    "answer": "The key findings include several important insights about the topic.",
                    "context": "As described in the document."
                }
            ])
        return f"Mock response to: {last_msg[:100]}..."

    async def stream(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 2048,
        **kwargs,
    ) -> AsyncGenerator[str, None]:
        response = await self.complete(messages, temperature, max_tokens)
        for word in response.split():
            yield word + " "
            await asyncio.sleep(0.01)


def get_llm_provider(
    provider: Optional[str] = None,
    **kwargs,
) -> LLMProvider:
    """Factory function to get LLM provider."""
    provider = provider or settings.LLM_PROVIDER

    if provider == "openai":
        if not settings.OPENAI_API_KEY:
            logger.warning("No OPENAI_API_KEY set, using mock provider")
            return MockProvider()
        return OpenAIProvider(**kwargs)
    elif provider == "anthropic":
        if not settings.ANTHROPIC_API_KEY:
            logger.warning("No ANTHROPIC_API_KEY set, using mock provider")
            return MockProvider()
        return AnthropicProvider(**kwargs)
    elif provider == "ollama":
        return OllamaProvider(**kwargs)
    elif provider == "mock":
        return MockProvider()
    else:
        raise LLMError(f"Unknown provider: {provider}")


class LLMService:
    """
    High-level LLM service with common operations.
    Manages provider instances and provides convenience methods.
    """

    def __init__(self, provider: Optional[str] = None):
        self.provider = get_llm_provider(provider)

    async def generate_qa_pairs(
        self,
        text: str,
        num_pairs: int = 10,
        language: str = "auto",
        custom_system_prompt: Optional[str] = None,
        custom_user_prompt_template: Optional[str] = None,
    ) -> list[dict]:
        """Generate Q&A pairs from text for SFT training."""
        system_prompt = custom_system_prompt or (
            "You are an expert at creating high-quality question-answer pairs for training language models.\n"
            "Generate diverse, informative Q&A pairs that cover different aspects of the provided text.\n"
            "Return ONLY a valid JSON array of objects with keys: \"question\", \"answer\", \"context\".\n"
            "Ensure answers are accurate, complete, and based solely on the provided text.\n"
            "IMPORTANT: Write all questions and answers in the SAME LANGUAGE as the provided text. "
            "If the text is in Korean, write in Korean. If in English, write in English. Never switch languages."
        )

        if custom_user_prompt_template:
            user_prompt = (
                custom_user_prompt_template
                .replace("{text}", text[:4000])
                .replace("{num_pairs}", str(num_pairs))
            )
        else:
            user_prompt = (
                f"Generate {num_pairs} diverse question-answer pairs from the following text.\n"
                "The questions should range from factual to analytical to comprehension-based.\n"
                "All questions and answers MUST be written in the same language as the TEXT below.\n\n"
                f"TEXT:\n{text[:4000]}\n\n"
                "Return a JSON array like:\n"
                "[\n"
                "  {\"question\": \"...\", \"answer\": \"...\", \"context\": \"...\"},\n"
                "  ...\n"
                "]"
            )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        response = await self.provider.complete(
            messages, temperature=0.3, max_tokens=4096, json_mode=True,
        )
        pairs = _parse_json_array(response)
        if not pairs:
            logger.warning("QA: empty result after parsing (raw response preview): %s", (response or "")[:200])
        return pairs

    async def generate_cot_pairs(
        self,
        text: str,
        num_pairs: int = 10,
        custom_system_prompt: Optional[str] = None,
        custom_user_prompt_template: Optional[str] = None,
    ) -> list[dict]:
        """Generate Chain-of-Thought reasoning pairs from text."""
        system_prompt = custom_system_prompt or (
            "You are an expert at creating high-quality Chain-of-Thought (CoT) training data.\n"
            "For each question, write a step-by-step reasoning chain that leads to the final answer.\n"
            "The reasoning must be explicit, logical, and grounded ONLY in the provided text.\n"
            "Return ONLY a valid JSON array of objects with keys: \"question\", \"reasoning\", \"answer\", \"context\".\n"
            "IMPORTANT: Write all fields in the SAME LANGUAGE as the provided text. "
            "If the text is in Korean, write in Korean. Never switch languages."
        )

        if custom_user_prompt_template:
            user_prompt = (
                custom_user_prompt_template
                .replace("{text}", text[:4000])
                .replace("{num_pairs}", str(num_pairs))
            )
        else:
            user_prompt = (
                f"Generate {num_pairs} Chain-of-Thought reasoning examples from the following text.\n"
                "For each example: produce a question, an explicit multi-step reasoning chain, and the final answer.\n"
                "All fields MUST be in the same language as the TEXT below.\n\n"
                f"TEXT:\n{text[:4000]}\n\n"
                "Return a JSON array like:\n"
                "[\n"
                "  {\n"
                "    \"question\": \"...\",\n"
                "    \"reasoning\": \"Step 1: ...\\nStep 2: ...\\nStep 3: ...\",\n"
                "    \"answer\": \"final concise answer\",\n"
                "    \"context\": \"relevant excerpt from the text\"\n"
                "  },\n"
                "  ...\n"
                "]"
            )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        response = await self.provider.complete(
            messages, temperature=0.3, max_tokens=4096, json_mode=True,
        )
        pairs = _parse_json_array(response)
        if not pairs:
            logger.warning("CoT: empty result after parsing (raw response preview): %s", (response or "")[:200])
        return pairs

    async def generate_tot_pairs(
        self,
        text: str,
        num_pairs: int = 10,
        custom_system_prompt: Optional[str] = None,
        custom_user_prompt_template: Optional[str] = None,
    ) -> list[dict]:
        """Generate Tree-of-Thought reasoning pairs from text."""
        system_prompt = custom_system_prompt or (
            "You are an expert at creating high-quality Tree-of-Thought (ToT) training data.\n"
            "For each question, explore 2-3 candidate reasoning paths, score each, and select the best.\n"
            "The reasoning must be grounded ONLY in the provided text.\n"
            "Return ONLY a valid JSON array. Each item has keys: \"question\", \"reasoning\" (object with \"paths\" array), \"answer\", \"context\".\n"
            "Each path: {\"id\": int, \"steps\": [str, ...], \"score\": float 0-1, \"selected\": bool}.\n"
            "Exactly one path must have selected=true.\n"
            "IMPORTANT: Write all fields in the SAME LANGUAGE as the provided text."
        )

        if custom_user_prompt_template:
            user_prompt = (
                custom_user_prompt_template
                .replace("{text}", text[:4000])
                .replace("{num_pairs}", str(num_pairs))
            )
        else:
            user_prompt = (
                f"Generate {num_pairs} Tree-of-Thought reasoning examples from the following text.\n"
                "For each: produce a question, 2-3 candidate reasoning paths with scores, mark the best as selected, then the final answer.\n"
                "All fields MUST be in the same language as the TEXT below.\n\n"
                f"TEXT:\n{text[:4000]}\n\n"
                "Return a JSON array like:\n"
                "[\n"
                "  {\n"
                "    \"question\": \"...\",\n"
                "    \"reasoning\": {\n"
                "      \"paths\": [\n"
                "        {\"id\": 1, \"steps\": [\"...\", \"...\"], \"score\": 0.4, \"selected\": false},\n"
                "        {\"id\": 2, \"steps\": [\"...\", \"...\"], \"score\": 0.9, \"selected\": true}\n"
                "      ]\n"
                "    },\n"
                "    \"answer\": \"final answer from selected path\",\n"
                "    \"context\": \"relevant excerpt\"\n"
                "  },\n"
                "  ...\n"
                "]"
            )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        response = await self.provider.complete(
            messages, temperature=0.3, max_tokens=6144, json_mode=True,
        )
        pairs = _parse_json_array(response)
        if not pairs:
            logger.warning("ToT: empty result after parsing (raw response preview): %s", (response or "")[:200])
        return pairs

    async def generate_got_pairs(
        self,
        text: str,
        num_pairs: int = 10,
        custom_system_prompt: Optional[str] = None,
        custom_user_prompt_template: Optional[str] = None,
    ) -> list[dict]:
        """Generate Graph-of-Thought reasoning pairs from text."""
        system_prompt = custom_system_prompt or (
            "You are an expert at creating high-quality Graph-of-Thought (GoT) training data.\n"
            "For each question, decompose reasoning into a graph of inter-connected thought nodes that merge into a final answer.\n"
            "The reasoning must be grounded ONLY in the provided text.\n"
            "Return ONLY a valid JSON array. Each item has keys: \"question\", \"reasoning\" (object with \"nodes\" and \"edges\"), \"answer\", \"context\".\n"
            "nodes: [{\"id\": str, \"content\": str}, ...]\n"
            "edges: [{\"from\": str, \"to\": str, \"relation\": str}, ...]\n"
            "IMPORTANT: Write all fields in the SAME LANGUAGE as the provided text."
        )

        if custom_user_prompt_template:
            user_prompt = (
                custom_user_prompt_template
                .replace("{text}", text[:4000])
                .replace("{num_pairs}", str(num_pairs))
            )
        else:
            user_prompt = (
                f"Generate {num_pairs} Graph-of-Thought reasoning examples from the following text.\n"
                "For each: produce a question, a graph of reasoning nodes with directed edges, then the final answer aggregated from the graph.\n"
                "All fields MUST be in the same language as the TEXT below.\n\n"
                f"TEXT:\n{text[:4000]}\n\n"
                "Return a JSON array like:\n"
                "[\n"
                "  {\n"
                "    \"question\": \"...\",\n"
                "    \"reasoning\": {\n"
                "      \"nodes\": [\n"
                "        {\"id\": \"n1\", \"content\": \"premise from text\"},\n"
                "        {\"id\": \"n2\", \"content\": \"derived inference\"},\n"
                "        {\"id\": \"n3\", \"content\": \"merged conclusion\"}\n"
                "      ],\n"
                "      \"edges\": [\n"
                "        {\"from\": \"n1\", \"to\": \"n2\", \"relation\": \"implies\"},\n"
                "        {\"from\": \"n2\", \"to\": \"n3\", \"relation\": \"supports\"}\n"
                "      ]\n"
                "    },\n"
                "    \"answer\": \"final answer\",\n"
                "    \"context\": \"relevant excerpt\"\n"
                "  },\n"
                "  ...\n"
                "]"
            )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        response = await self.provider.complete(
            messages, temperature=0.3, max_tokens=6144, json_mode=True,
        )
        pairs = _parse_json_array(response)
        if not pairs:
            logger.warning("GoT: empty result after parsing (raw response preview): %s", (response or "")[:200])
        return pairs

    async def generate_preference_pairs(
        self,
        text: str,
        num_pairs: int = 5,
        custom_system_prompt: Optional[str] = None,
        custom_user_prompt_template: Optional[str] = None,
    ) -> list[dict]:
        """Generate DPO preference pairs from text."""
        system_prompt = custom_system_prompt or (
            "You are an expert at creating preference pairs for reinforcement learning from human feedback.\n"
            "For each question, generate one chosen (preferred/correct) response and one rejected (inferior/incorrect) response.\n"
            "Return ONLY a valid JSON array.\n"
            "IMPORTANT: Write all prompts, chosen, and rejected responses in the SAME LANGUAGE as the provided text. "
            "If the text is in Korean, write in Korean. If in English, write in English. Never switch languages."
        )

        if custom_user_prompt_template:
            user_prompt = (
                custom_user_prompt_template
                .replace("{text}", text[:3000])
                .replace("{num_pairs}", str(num_pairs))
            )
        else:
            user_prompt = (
                f"Generate {num_pairs} preference pairs from this text for DPO training.\n"
                "All prompts, chosen, and rejected responses MUST be written in the same language as the TEXT below.\n\n"
                f"TEXT:\n{text[:3000]}\n\n"
                "Return JSON array:\n"
                "[\n"
                "  {\n"
                "    \"prompt\": \"Question about the text\",\n"
                "    \"chosen\": \"High-quality, accurate, detailed answer\",\n"
                "    \"rejected\": \"Poor quality, vague, or incorrect answer\"\n"
                "  },\n"
                "  ...\n"
                "]"
            )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        response = await self.provider.complete(
            messages, temperature=0.3, max_tokens=4096, json_mode=True,
        )
        pairs = _parse_json_array(response)
        if not pairs:
            logger.warning("DPO: empty result after parsing (raw response preview): %s", (response or "")[:200])
        return pairs

    async def judge_response(
        self,
        question: str,
        reference: str,
        candidate: str,
    ) -> dict:
        """Use LLM as judge to evaluate a response."""
        prompt = f"""Evaluate the following response to a question on a scale of 1-10.
Consider: accuracy, completeness, clarity, and relevance.

Question: {question}
Reference Answer: {reference}
Candidate Response: {candidate}

Respond with JSON: {{"score": <1-10>, "reasoning": "brief explanation"}}"""

        messages = [{"role": "user", "content": prompt}]
        try:
            response = await self.provider.complete(messages, temperature=0.1)
            start = response.find("{")
            end = response.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(response[start:end])
        except Exception as e:
            logger.warning(f"LLM judge failed: {e}")
        return {"score": 5.0, "reasoning": "Evaluation unavailable"}

    async def complete(self, messages: list[dict], **kwargs) -> str:
        """Direct completion passthrough."""
        return await self.provider.complete(messages, **kwargs)

    async def stream(self, messages: list[dict], **kwargs) -> AsyncGenerator[str, None]:
        """Direct stream passthrough."""
        async for chunk in self.provider.stream(messages, **kwargs):
            yield chunk


# Module-level singleton
llm_service = LLMService()
