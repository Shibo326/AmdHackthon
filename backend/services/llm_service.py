import asyncio
import logging
import os
from enum import Enum
from typing import Type, TypeVar

from pydantic import BaseModel, ValidationError

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# LLM model constants
GROQ_MODEL_DEFAULT = "llama-3.3-70b-versatile"
CLAUDE_MODEL = "claude-3-5-sonnet-20241022"
MAX_TOKENS_DEFAULT = 4096


class LLMProvider(str, Enum):
    GROQ = "GROQ"
    CLAUDE = "CLAUDE"
    AMD = "AMD"


class ConfigurationError(Exception):
    """Raised when required configuration is missing at startup."""
    pass


class LLMRateLimitError(Exception):
    """Raised when the LLM provider returns a rate limit / quota exceeded error."""
    pass


class LLMParseError(Exception):
    """Raised when LLM response cannot be parsed into the expected model."""
    pass


class LLMService:
    """
    LLM abstraction that routes inference to Groq, Claude, or AMD Developer Cloud.
    Provider is selected via the LLM_PROVIDER environment variable.
    No mock/stub data — all responses come from the real LLM.
    """

    def __init__(self):
        provider_str = os.getenv("LLM_PROVIDER", "GROQ").upper()
        try:
            self.provider = LLMProvider(provider_str)
        except ValueError:
            logger.warning(f"Unknown LLM_PROVIDER '{provider_str}', defaulting to GROQ")
            self.provider = LLMProvider.GROQ

        if self.provider == LLMProvider.GROQ:
            api_key = os.getenv("GROQ_API_KEY")
            if not api_key:
                raise ConfigurationError(
                    "GROQ_API_KEY is required when LLM_PROVIDER=GROQ. "
                    "Get a free key at https://console.groq.com"
                )
            from groq import Groq
            self._groq_client = Groq(api_key=api_key)
            self._groq_model = os.getenv("GROQ_MODEL", GROQ_MODEL_DEFAULT)
            logger.info(f"LLM provider: GROQ (model: {self._groq_model})")

        elif self.provider == LLMProvider.CLAUDE:
            api_key = os.getenv("ANTHROPIC_API_KEY")
            if not api_key:
                raise ConfigurationError(
                    "ANTHROPIC_API_KEY is required when LLM_PROVIDER=CLAUDE."
                )
            import anthropic
            self._anthropic_client = anthropic.Anthropic(api_key=api_key)
            logger.info(f"LLM provider: CLAUDE ({CLAUDE_MODEL})")

        else:
            # AMD Developer Cloud
            self._amd_endpoint = os.getenv("AMD_CLOUD_ENDPOINT", "")
            self._amd_api_key = os.getenv("AMD_CLOUD_API_KEY", "")
            if self._amd_endpoint:
                logger.info(f"LLM provider: AMD Developer Cloud ({self._amd_endpoint})")
            else:
                raise ConfigurationError(
                    "AMD_CLOUD_ENDPOINT is required when LLM_PROVIDER=AMD. "
                    "Set it in your .env file."
                )

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = MAX_TOKENS_DEFAULT,
    ) -> str:
        """Route a completion request to the active LLM provider."""
        if self.provider == LLMProvider.GROQ:
            return await self._complete_groq(system_prompt, user_prompt, max_tokens)
        elif self.provider == LLMProvider.CLAUDE:
            return await self._complete_claude(system_prompt, user_prompt, max_tokens)
        else:
            return await self._complete_amd(system_prompt, user_prompt, max_tokens)

    async def _complete_groq(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
    ) -> str:
        """
        Call Groq API — Llama 3.3 70B, fast and free.
        Retries up to 3 attempts with exponential backoff on rate limit errors.
        Raises immediately on any non-rate-limit exception.
        """
        for attempt in range(3):
            try:
                def _sync_call() -> str:
                    try:
                        response = self._groq_client.chat.completions.create(
                            model=self._groq_model,
                            messages=[
                                {"role": "system", "content": system_prompt},
                                {"role": "user", "content": user_prompt},
                            ],
                            max_tokens=max_tokens,
                            temperature=0.1,
                        )
                    except Exception as exc:
                        # Detect rate limit / quota errors from Groq SDK
                        exc_str = str(exc).lower()
                        if "rate_limit_exceeded" in exc_str or "429" in exc_str or "rate limit" in exc_str:
                            raise LLMRateLimitError(str(exc)) from exc
                        raise
                    content = response.choices[0].message.content
                    logger.info(f"[GROQ] Response received ({len(content)} chars)")
                    return content

                loop = asyncio.get_event_loop()
                return await loop.run_in_executor(None, _sync_call)

            except LLMRateLimitError:
                if attempt < 2:
                    wait = (attempt + 1) * 3
                    logger.warning(f"[GROQ] Rate limited — retry {attempt + 1}/3 in {wait}s")
                    await asyncio.sleep(wait)
                    continue
                raise
            except Exception:
                raise

    async def _complete_claude(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
    ) -> str:
        """Call Anthropic Claude API."""
        def _sync_call() -> str:
            response = self._anthropic_client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=max_tokens,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )
            content = response.content[0].text
            logger.info(f"[CLAUDE] Response received ({len(content)} chars)")
            return content

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _sync_call)

    async def _complete_amd(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
    ) -> str:
        """
        # AMD: LLM inference via AMD Developer Cloud API
        # AMD: Model: Llama 3.2 Vision 11B on MI300X hardware
        """
        import httpx

        headers = {
            "Authorization": f"Bearer {self._amd_api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": "meta-llama/Llama-3.2-11B-Vision-Instruct",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "max_tokens": max_tokens,
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{self._amd_endpoint}/chat/completions",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            logger.info(f"[AMD] Response received ({len(content)} chars)")
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
    """Remove markdown code fences and sanitize control characters from LLM responses."""
    import re
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[-1].strip() == "```":
            lines = lines[1:-1]
        else:
            lines = lines[1:]
        text = "\n".join(lines)
    text = text.strip()
    # Remove control characters that break JSON parsing (keep \n and \t as escaped)
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', text)
    return text
