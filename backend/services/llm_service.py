import asyncio
import logging
import os
import re
from typing import Type, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

MAX_TOKENS_DEFAULT = 2000


class LLMRateLimitError(Exception):
    """Raised when the LLM provider returns a rate limit / quota exceeded error."""
    pass


class LLMParseError(Exception):
    """Raised when LLM response cannot be parsed into the expected model."""
    pass


class LLMService:
    """
    LLM service using Fireworks AI (AMD Instinct MI300X hardware).
    All inference runs on AMD MI300X via the Fireworks platform.

    Performance optimizations applied:
    - Persistent httpx.AsyncClient with connection pooling (avoids TCP handshake per call)
    - Fireworks 'fast' speed tier for higher generated-token throughput
    - Tuned temperatures (0.1 for structured JSON, 0.3 for prose)
    - Reduced max_tokens where safe to do so
    """

    def __init__(self):
        self._api_key = os.getenv("FIREWORKS_API_KEY", "")
        if not self._api_key:
            raise ValueError(
                "FIREWORKS_API_KEY is required. "
                "Set it in your .env file or Railway environment variables. "
                "Get a key at https://app.fireworks.ai/settings/api-keys"
            )
        self._endpoint = os.getenv("FIREWORKS_ENDPOINT", "https://api.fireworks.ai/inference/v1")
        if not self._endpoint:
            raise ValueError(
                "FIREWORKS_ENDPOINT is required. "
                "Set it in your .env file or Railway environment variables."
            )
        self._model = os.getenv("FIREWORKS_MODEL", "accounts/fireworks/models/llama-4-maverick-instruct")

        # Persistent async HTTP client — avoids TCP handshake overhead on every call.
        # limits: 20 keepalive connections, up to 100 concurrent (covers our 5 parallel calls easily).
        self._client = httpx.AsyncClient(
            timeout=100.0,
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=100),
        )

        logger.info(f"Fireworks AI configured: endpoint={self._endpoint[:30]}...")
        logger.info(f"Fireworks Model: {self._model}")
        logger.info(f"LLMService initialized (Fireworks/AMD, model: {self._model}, persistent client)")

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = MAX_TOKENS_DEFAULT,
        temperature: float = 0.1,
    ) -> str:
        """Send a completion request to Fireworks AI with automatic rate-limit retry."""
        for attempt in range(3):
            try:
                return await self._call_fireworks(system_prompt, user_prompt, max_tokens, temperature)
            except LLMRateLimitError:
                if attempt < 2:
                    wait = (attempt + 1) * 2  # 2s then 4s
                    logger.warning(
                        f"[Fireworks] Rate limited, retry {attempt + 1}/3 in {wait}s..."
                    )
                    await asyncio.sleep(wait)
                else:
                    logger.error("[Fireworks] Rate limit — all retries exhausted")
                    raise
        raise LLMRateLimitError("Max retries exceeded")

    async def aclose(self) -> None:
        """Close the persistent HTTP client. Call on app shutdown."""
        await self._client.aclose()

    async def _call_fireworks(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
        temperature: float,
    ) -> str:
        """Execute a single Fireworks AI completion request using the persistent client."""
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": 0.9,
            "frequency_penalty": 0.3,
            # Fireworks 'fast' tier: higher generated-token throughput on shared serverless
            "speed": "fast",
        }

        try:
            response = await self._client.post(
                f"{self._endpoint}/chat/completions",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            exc_str = str(exc).lower()
            if "429" in exc_str or "rate limit" in exc_str:
                raise LLMRateLimitError(f"Fireworks rate limit: {exc}") from exc
            raise

        data = response.json()
        content = data["choices"][0]["message"]["content"]
        content = _sanitize_unicode(content)
        logger.info(f"[Fireworks/AMD] Response received ({len(content)} chars)")
        return content

    async def _parse_with_retry(
        self,
        system_prompt: str,
        user_prompt: str,
        model_class: Type[T],
        max_tokens: int = MAX_TOKENS_DEFAULT,
    ) -> T:
        """
        Call LLM and parse into a Pydantic model.
        Retries once with a correction prompt if the first parse fails.
        """
        raw = await self.complete(system_prompt, user_prompt, max_tokens)
        raw = _strip_json_fences(raw)

        try:
            return model_class.model_validate_json(raw)
        except (ValidationError, Exception) as first_error:
            logger.warning(f"First parse attempt failed: {first_error}. Retrying.")
            corrective_prompt = (
                user_prompt
                + "\n\nIMPORTANT: Your previous response contained invalid JSON. "
                "Respond ONLY with valid JSON matching the exact schema. "
                "Do not include any text outside the JSON object."
            )
            raw2 = await self.complete(system_prompt, corrective_prompt, max_tokens)
            raw2 = _strip_json_fences(raw2)

            try:
                return model_class.model_validate_json(raw2)
            except (ValidationError, Exception) as second_error:
                raise LLMParseError(
                    f"LLM failed to produce valid JSON after retry: {second_error}"
                ) from second_error


def _strip_json_fences(text: str) -> str:
    """Remove markdown code fences, thinking tags, and extract JSON from verbose LLM responses."""
    text = text.strip()
    # Strip <think>...</think> blocks (DeepSeek/Kimi reasoning models)
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL)
    text = text.strip()
    # Strip [think]...[/think] variant
    text = re.sub(r'\[think\].*?\[/think\]', '', text, flags=re.DOTALL)
    text = text.strip()
    # Strip markdown code fences
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[-1].strip() == "```":
            lines = lines[1:-1]
        else:
            lines = lines[1:]
        text = "\n".join(lines)
    text = text.strip()
    # If the text doesn't start with { or [, try to find JSON in the response
    if text and text[0] not in ('{', '['):
        # Look for the first { or [ and extract from there
        json_start = -1
        for i, ch in enumerate(text):
            if ch in ('{', '['):
                json_start = i
                break
        if json_start >= 0:
            # Find the matching closing bracket
            candidate = text[json_start:]
            bracket = candidate[0]
            close_bracket = '}' if bracket == '{' else ']'
            # Find the last occurrence of the closing bracket
            last_close = candidate.rfind(close_bracket)
            if last_close > 0:
                candidate = candidate[:last_close + 1]
            text = candidate
    text = text.strip()
    # Remove control characters that break JSON parsing (keep \n and \t as escaped)
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', text)
    return text


def _sanitize_unicode(text: str) -> str:
    """
    Replace problematic Unicode characters that render as black boxes/squares
    in web fonts (Inter, system fonts) with their ASCII equivalents.
    
    Common culprits from LLM outputs:
    - \u2010 (hyphen), \u2011 (non-breaking hyphen), \u2012 (figure dash) → regular hyphen
    - \u2013 (en-dash), \u2014 (em-dash) → kept as-is (most fonts support these)
    - \u00AD (soft hyphen) → removed
    - \u200B (zero-width space), \u200C, \u200D, \uFEFF (BOM) → removed
    - \u2018, \u2019 (smart single quotes) → regular apostrophe
    - \u201C, \u201D (smart double quotes) → regular double quote
    """
    if not text:
        return text
    # Replace uncommon hyphens with regular hyphen
    text = text.replace('\u2010', '-')  # hyphen
    text = text.replace('\u2011', '-')  # non-breaking hyphen
    text = text.replace('\u2012', '-')  # figure dash
    # Remove soft hyphen and zero-width characters
    text = text.replace('\u00AD', '')   # soft hyphen
    text = text.replace('\u200B', '')   # zero-width space
    text = text.replace('\u200C', '')   # zero-width non-joiner
    text = text.replace('\u200D', '')   # zero-width joiner
    text = text.replace('\uFEFF', '')   # BOM / zero-width no-break space
    # Smart quotes → regular quotes
    text = text.replace('\u2018', "'")  # left single quote
    text = text.replace('\u2019', "'")  # right single quote
    text = text.replace('\u201C', '"')  # left double quote
    text = text.replace('\u201D', '"')  # right double quote
    # Replace other problematic dashes that some fonts can't render
    text = text.replace('\u2015', '—')  # horizontal bar → em-dash
    text = text.replace('\u2212', '-')  # minus sign → hyphen
    return text
