import asyncio
import json
import logging
import os
from datetime import datetime

from models.document import Chunk
from models.response import (
    AnalysisResult,
    ComparisonRow,
    Recommendation,
    Risk,
)
from prompts.recommendation import build_recommendation_prompt
from prompts.risk_analysis import build_risk_prompt
from prompts.system_prompt import get_system_prompt
from services.conflict_engine import ConflictEngine
from services.llm_service import LLMService, LLMParseError, _strip_json_fences
from services.session_manager import SessionManager

logger = logging.getLogger(__name__)

# Timeout for individual LLM calls (seconds)
# deepseek-v4-flash reasoning model may need a bit more time than gpt-oss-120b
LLM_CALL_TIMEOUT = 80

# Prompt for comparison matrix — adapts to any document type with deep analytical reasoning
COMPARISON_MATRIX_PROMPT = """Based on the document content above, create a detailed comparison matrix that a decision-maker can use to make an immediate choice.

REASONING STEPS (follow internally):
1. What entities, options, or subjects in these documents can be meaningfully compared?
2. What are the CRITICAL differentiators that would actually influence a decision?
3. For each comparison field, which option is objectively superior and WHY?

ADAPT TO DOCUMENT TYPE:
- Multiple suppliers/vendors: Compare price, payment terms, delivery timeline, warranty, SLA, penalties, hidden costs, and strategic fit
- Academic/research: Compare methodology rigor, sample size, statistical validity, recency, applicability, and limitations
- Multiple contracts: Compare obligations, risk allocation, termination flexibility, IP terms, and commercial structure
- Policy documents: Compare coverage, thresholds, approval requirements, and compliance gaps
- Financial documents: Compare cost structures, margins, trends, anomalies, and benchmarks

WINNER SELECTION RULES:
- Only declare a winner when there's a meaningful, defensible advantage
- For price fields: lowest wins (unless quality/risk tradeoff exists — note it)
- For terms: most favorable to the buyer/reader wins
- For risk: lowest risk exposure wins
- If genuinely equal or not applicable: winner = null

Return ONLY valid JSON in this exact format:
{{
  "comparisonMatrix": [
    {{
      "field": "<specific comparison dimension — not generic labels like 'Cost' but rather 'Total 3-Year Cost (including maintenance)'>",
      "values": {{
        "<Entity/Option/Document Name>": "<specific value with units, percentages, or clear qualitative assessment — not vague>"
      }},
      "winner": "<name of the objectively superior option for this specific field, with brief reason — or null if genuinely tied>"
    }}
  ]
}}

Include 5-8 comparison fields based on what's ACTUALLY IMPORTANT for this decision.
Every value must be grounded in document content. Flag assumptions with (estimated) or (inferred).
Do NOT include any text outside the JSON object."""


class AnalysisService:
    """
    Orchestrates the full multi-document AI analysis pipeline.

    Performance-optimized architecture:
    - Tiered model routing: deepseek-v4-flash for reasoning, gpt-oss-120b for structured tasks
    - SINGLE_CALL_MODE: combine all analysis into 1 call (set SINGLE_CALL_MODE=true in env)
    - All 5 LLM calls run in parallel (no batching)
    - Suggested questions merged into executive summary call (saves 1 call)
    - Conflict detection consolidated to 1 call for ALL docs (saves N*(N-1)/2 - 1 calls)
    - Per-call timeout of 80s with graceful partial results
    - Token budgets tuned per call type

    Total LLM calls: 5 parallel (was 6+ sequential/batched, up to 34 with pairwise conflicts)
    SINGLE_CALL_MODE: 1 call total (emergency speed fallback)
    """

    def __init__(
        self,
        llm_service: LLMService,
        conflict_engine: ConflictEngine,
        session_manager: SessionManager,
    ):
        self.llm_service = llm_service
        self.conflict_engine = conflict_engine
        self.session_manager = session_manager
        self._single_call_mode = os.getenv("SINGLE_CALL_MODE", "false").lower() == "true"

    async def run_full_analysis(
        self,
        session_id: str,
        chunks: list[Chunk],
        doc_names: list[str],
    ) -> AnalysisResult:
        """
        Run the complete analysis pipeline.

        Normal mode: 5 parallel LLM calls (tiered models).
        SINGLE_CALL_MODE: 1 mega LLM call (extreme speed, lower quality).

        Target: <35s wall time for 2 documents in normal mode.
        """
        system_prompt = get_system_prompt(doc_names)

        if self._single_call_mode:
            logger.info(
                f"[SINGLE_CALL_MODE] Starting single-mega-call analysis for session {session_id} "
                f"({len(chunks)} chunks, {len(doc_names)} documents)"
            )
            return await self._run_single_call_analysis(session_id, system_prompt, chunks, doc_names)

        logger.info(
            f"Starting full analysis for session {session_id} "
            f"({len(chunks)} chunks, {len(doc_names)} documents) — 5 parallel LLM calls "
            f"[quality: deepseek-v4-flash, fast: gpt-oss-120b, timeout: {LLM_CALL_TIMEOUT}s]"
        )

        if chunks:
            logger.debug(f"First chunk: {chunks[0].source_document} ({len(chunks)} chunks)")
        else:
            logger.warning("No document chunks — extraction may have failed")

        (
            summary_and_questions_result,
            risks_result,
            matrix_result,
            recommendation_result,
            conflicts_result,
        ) = await asyncio.gather(
            self._with_timeout(
                self._generate_summary_and_questions(system_prompt, chunks),
                "summary+questions",
            ),
            self._with_timeout(
                self._generate_risks(system_prompt, chunks),
                "risks",
            ),
            self._with_timeout(
                self._generate_comparison_matrix(system_prompt, chunks, doc_names),
                "comparison_matrix",
            ),
            self._with_timeout(
                self._generate_recommendation(system_prompt, chunks),
                "recommendation",
            ),
            self._with_timeout(
                self.conflict_engine.detect(chunks, doc_names),
                "conflicts",
            ),
            return_exceptions=True,
        )

        # Unpack summary + questions
        if isinstance(summary_and_questions_result, Exception):
            raise LLMParseError(f"Summary generation failed: {summary_and_questions_result}") from summary_and_questions_result
        summary_result, suggested_questions = summary_and_questions_result

        if isinstance(risks_result, Exception):
            logger.warning(f"Risk analysis failed, using empty: {risks_result}")
            risks_result = []

        if isinstance(matrix_result, Exception):
            logger.warning(f"Comparison matrix failed, using empty: {matrix_result}")
            matrix_result = []

        if isinstance(recommendation_result, Exception):
            logger.warning(f"Recommendation failed, using fallback: {recommendation_result}")
            recommendation_result = Recommendation(
                title="Analysis Complete",
                summary="Please review the identified risks and document comparison for details.",
                nextSteps=["Review identified risks", "Compare document options", "Ask the AI Copilot"],
                confidence=0.6,
            )

        if isinstance(conflicts_result, Exception):
            logger.warning(f"Conflict detection failed, using empty: {conflicts_result}")
            conflicts_result = []

        analysis = AnalysisResult(
            analyzedAt=datetime.utcnow(),
            executiveSummary=summary_result,
            risks=risks_result,
            comparisonMatrix=matrix_result,
            conflicts=conflicts_result,
            recommendation=recommendation_result,
            suggestedQuestions=suggested_questions,
        )

        self.session_manager.store_analysis(session_id, analysis)
        logger.info(f"Analysis complete for session {session_id}")
        return analysis

    async def _run_single_call_analysis(
        self,
        session_id: str,
        system_prompt: str,
        chunks: list[Chunk],
        doc_names: list[str],
    ) -> AnalysisResult:
        """
        Emergency speed fallback: all analysis in ONE LLM call.
        Activated by SINGLE_CALL_MODE=true env var.
        """
        from prompts.executive_summary import _format_chunks
        context = _format_chunks(chunks)

        try:
            data = await asyncio.wait_for(
                self.llm_service.single_mega_call(system_prompt, context, doc_names),
                timeout=LLM_CALL_TIMEOUT,
            )
        except asyncio.TimeoutError:
            raise LLMParseError(f"Single mega-call timed out after {LLM_CALL_TIMEOUT}s")

        # Parse each field with graceful fallbacks
        summary = data.get("executiveSummary", "Analysis complete.")

        risks = []
        for i, item in enumerate(data.get("risks", [])):
            try:
                if isinstance(item, dict):
                    item = {
                        "id": item.get("id", f"r{i+1}"),
                        "level": item.get("level", "MEDIUM").upper(),
                        "description": item.get("description", ""),
                        "sourceDocument": item.get("sourceDocument", ""),
                        "category": item.get("category", "Operational"),
                    }
                risks.append(Risk(**item))
            except Exception as e:
                logger.warning(f"[single-call] Skipping malformed risk: {e}")

        matrix = []
        for item in data.get("comparisonMatrix", []):
            try:
                matrix.append(ComparisonRow(**item))
            except Exception as e:
                logger.warning(f"[single-call] Skipping malformed matrix row: {e}")

        recommendation = Recommendation(
            title="Analysis Complete",
            summary="Please review the risks and comparison matrix for details.",
            nextSteps=["Review identified risks", "Compare document options", "Ask the AI Copilot"],
            confidence=0.6,
        )
        rec_data = data.get("recommendation")
        if rec_data and isinstance(rec_data, dict):
            try:
                recommendation = Recommendation(**rec_data)
            except Exception as e:
                logger.warning(f"[single-call] Recommendation parse failed: {e}")

        questions = data.get("suggestedQuestions", [])
        if not isinstance(questions, list):
            questions = []
        questions = [q for q in questions if isinstance(q, str)][:6]

        # Conflict detection still separate (needs doc grouping logic)
        conflicts = []
        raw_conflicts = data.get("conflicts", [])
        if not raw_conflicts and len(doc_names) >= 2:
            # Run conflict detection as a separate fast call
            try:
                conflicts = await asyncio.wait_for(
                    self.conflict_engine.detect(chunks, doc_names),
                    timeout=LLM_CALL_TIMEOUT,
                )
            except Exception as e:
                logger.warning(f"[single-call] Conflict detection failed: {e}")

        analysis = AnalysisResult(
            analyzedAt=datetime.utcnow(),
            executiveSummary=summary,
            risks=risks,
            comparisonMatrix=matrix,
            conflicts=conflicts,
            recommendation=recommendation,
            suggestedQuestions=questions,
        )
        self.session_manager.store_analysis(session_id, analysis)
        logger.info(f"[SINGLE_CALL_MODE] Analysis complete for session {session_id}")
        return analysis

    async def _with_timeout(self, coro, label: str):
        """Wrap a coroutine with a timeout. Returns the exception on timeout."""
        try:
            return await asyncio.wait_for(coro, timeout=LLM_CALL_TIMEOUT)
        except asyncio.TimeoutError:
            logger.warning(
                f"LLM call '{label}' timed out after {LLM_CALL_TIMEOUT}s"
            )
            raise LLMParseError(
                f"LLM call '{label}' timed out after {LLM_CALL_TIMEOUT}s"
            )

    async def _generate_summary_and_questions(
        self,
        system_prompt: str,
        chunks: list[Chunk],
    ) -> tuple[str, list[str]]:
        """
        Generate executive summary AND suggested questions in a single LLM call.
        Uses the QUALITY model (deepseek-v4-flash) for deep reasoning.
        Merging these saves one full LLM round-trip (10-60s).
        """
        from prompts.executive_summary import _format_chunks
        context = _format_chunks(chunks)
        doc_names = list(dict.fromkeys(c.source_document for c in chunks))
        doc_list = ", ".join(doc_names) if doc_names else "the uploaded document"

        merged_prompt = f"""You are a senior analyst. Write an executive summary for a decision-maker based on these documents.

DOCUMENTS: {doc_list}

{context}

Lead with the single most important finding. Include specific figures. Flag urgency. End with a clear recommended action.

Also generate 5 short follow-up questions (max 10 words each) that a decision-maker would most likely want to ask. Make them SPECIFIC to the document content — not generic questions like "What are the key terms?" but rather "Is the $245K/year rate competitive for this scope?"

Return ONLY valid JSON (no preamble, no explanation, just the JSON object):
{{
  "executiveSummary": "<4-6 sentence executive briefing with specific figures, key insight, urgency, and recommended direction>",
  "suggestedQuestions": ["question1", "question2", "question3", "question4", "question5"]
}}"""

        # Quality model (deepseek-v4-flash) for nuanced summary; 1200 tokens is enough
        raw = await self.llm_service.complete(
            system_prompt, merged_prompt, max_tokens=1200, fast=False
        )
        raw = _strip_json_fences(raw)

        # Extra safety: if raw still starts with prose (not JSON), find the JSON block
        if raw and raw[0] not in ('{', '['):
            brace_idx = raw.find('{')
            if brace_idx != -1:
                raw = raw[brace_idx:raw.rfind('}') + 1]

        try:
            data = json.loads(raw)
            summary = data.get("executiveSummary", raw)
            questions = data.get("suggestedQuestions", [])
            if not isinstance(questions, list):
                questions = []
            questions = [q for q in questions if isinstance(q, str)][:6]
            return summary, questions
        except json.JSONDecodeError:
            # Fallback: treat the whole response as a summary, no questions
            return raw.strip(), []

    async def _generate_risks(
        self,
        system_prompt: str,
        chunks: list[Chunk],
    ) -> list[Risk]:
        """Generate risk analysis list using the QUALITY model (deepseek-v4-flash)."""
        user_prompt = build_risk_prompt(chunks)
        # Increased to 3000 tokens — deepseek-v4-flash is more verbose than gpt-oss-120b
        # and needs extra headroom to output 5-8 detailed risk items without truncation.
        raw = await self.llm_service.complete(
            system_prompt, user_prompt, max_tokens=3000, fast=False
        )
        logger.info(f"[risks] raw LLM response: {len(raw)} chars, first 500: {raw[:500]!r}")
        raw = _strip_json_fences(raw)
        logger.info(f"[risks] after strip, first 200: {raw[:200]!r}")

        import re as _re
        data = None

        # Strategy 1: direct parse
        try:
            data = json.loads(raw)
        except Exception:
            pass

        # Strategy 2: extract outermost { ... } block
        if data is None:
            brace_start = raw.find("{")
            brace_end = raw.rfind("}")
            if brace_start != -1 and brace_end > brace_start:
                try:
                    data = json.loads(raw[brace_start:brace_end + 1])
                except Exception:
                    pass

        # Strategy 3: fix trailing commas then retry
        if data is None:
            try:
                cleaned = _re.sub(r",\s*([}\]])", r"\1", raw)
                brace_start = cleaned.find("{")
                brace_end = cleaned.rfind("}")
                if brace_start != -1 and brace_end > brace_start:
                    data = json.loads(cleaned[brace_start:brace_end + 1])
            except Exception:
                pass

        # Strategy 4: extract just the risks array with regex
        if data is None:
            array_match = _re.search(r'"risks"\s*:\s*(\[.*?\])', raw, _re.DOTALL)
            if array_match:
                try:
                    risks_array = json.loads(array_match.group(1))
                    data = {"risks": risks_array}
                except Exception:
                    pass

        # Strategy 5: retry LLM with explicit JSON-only instruction
        if data is None:
            logger.warning(f"[risks] ALL parse strategies failed on first attempt — retrying with stricter prompt")
            retry_prompt = (
                user_prompt
                + "\n\nCRITICAL: Your previous response was not valid JSON. "
                "You MUST respond with ONLY a valid JSON object starting with { and ending with }. "
                "No preamble, no explanation, no markdown code fences. Start your response with { and end with }."
            )
            try:
                raw2 = await self.llm_service.complete(
                    system_prompt, retry_prompt, max_tokens=2000, fast=False
                )
                raw2 = _strip_json_fences(raw2)
                logger.info(f"[risks] retry response, first 200: {raw2[:200]!r}")
                try:
                    data = json.loads(raw2)
                except Exception:
                    brace_start = raw2.find("{")
                    brace_end = raw2.rfind("}")
                    if brace_start != -1 and brace_end > brace_start:
                        try:
                            cleaned2 = _re.sub(r",\s*([}\]])", r"\1", raw2[brace_start:brace_end + 1])
                            data = json.loads(cleaned2)
                        except Exception:
                            pass
            except Exception as retry_err:
                logger.warning(f"[risks] retry LLM call failed: {retry_err}")

        if data is None:
            logger.warning(f"[risks] ALL parse strategies failed including retry. Raw (500 chars): {raw[:500]!r}")
            return []

        risks_data = data.get("risks", []) if isinstance(data, dict) else []
        logger.info(f"[risks] parsed {len(risks_data)} risk items")
        risks = []
        for item in risks_data:
            try:
                # Normalize field names — Kimi/DeepSeek may use snake_case
                if isinstance(item, dict):
                    item = {
                        "id": item.get("id", f"r{len(risks)+1}"),
                        "level": item.get("level", item.get("severity", "MEDIUM")).upper(),
                        "description": item.get("description", item.get("content", "")),
                        "sourceDocument": item.get("sourceDocument", item.get("source_document", item.get("source", ""))),
                        "category": item.get("category", "Operational"),
                    }
                risks.append(Risk(**item))
            except Exception as e:
                logger.warning(f"Skipping malformed risk item: {e} — item keys: {list(item.keys()) if isinstance(item, dict) else type(item)}")
        return risks

    async def _generate_comparison_matrix(
        self,
        system_prompt: str,
        chunks: list[Chunk],
        doc_names: list[str],
    ) -> list[ComparisonRow]:
        """
        Generate comparison matrix rows.
        Uses FAST model (gpt-oss-120b) — structured JSON output, no deep reasoning needed.
        max_tokens=500 is sufficient for 5-8 matrix rows.
        """
        from prompts.executive_summary import _format_chunks

        context = _format_chunks(chunks)
        user_prompt = f"""You are analyzing the following procurement documents:

DOCUMENT CONTEXT:
{context}

{COMPARISON_MATRIX_PROMPT}"""

        # FAST model — structured output task; increased to 1500 tokens for deepseek-v4-flash
        # verbosity. 500 was too low and caused truncated/empty matrix responses.
        raw = await self.llm_service.complete(
            system_prompt, user_prompt, max_tokens=1500, fast=True
        )
        logger.info(f"[matrix] raw LLM response: {len(raw)} chars, first 300: {raw[:300]!r}")
        raw = _strip_json_fences(raw)

        # Robust JSON extraction — handle common LLM formatting issues
        data = None
        parse_attempts = [raw]
        brace_start = raw.find("{")
        brace_end = raw.rfind("}")
        if brace_start != -1 and brace_end > brace_start:
            parse_attempts.append(raw[brace_start: brace_end + 1])

        for attempt in parse_attempts:
            try:
                data = json.loads(attempt)
                break
            except (json.JSONDecodeError, ValueError):
                continue

        # Last resort: fix common malformed JSON from smaller models
        if data is None:
            import re

            cleaned = raw[brace_start: brace_end + 1] if brace_start != -1 else raw
            cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
            cleaned = cleaned.replace("'", '"')
            try:
                data = json.loads(cleaned)
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(
                    f"Comparison matrix parse failed after all attempts: {e}"
                )
                return []

        matrix_data = (
            data.get("comparisonMatrix", []) if isinstance(data, dict) else []
        )
        rows = []
        for item in matrix_data:
            try:
                rows.append(ComparisonRow(**item))
            except Exception as e:
                logger.warning(f"Skipping malformed matrix row: {e}")
        return rows

    async def _generate_recommendation(
        self,
        system_prompt: str,
        chunks: list[Chunk],
    ) -> Recommendation:
        """
        Generate procurement recommendation.
        Uses QUALITY model (deepseek-v4-flash) — requires strategic reasoning.
        max_tokens=800 is sufficient for a recommendation with 3-5 next steps.
        """
        user_prompt = build_recommendation_prompt(chunks)
        raw = await self.llm_service.complete(
            system_prompt, user_prompt, max_tokens=800, fast=False
        )
        raw = _strip_json_fences(raw)

        try:
            data = json.loads(raw)
            return Recommendation(**data)
        except Exception as e:
            logger.warning(f"Recommendation parse failed: {e}, using fallback")
            return Recommendation(
                title="Analysis Complete",
                summary="Please review the risks and comparison matrix for details.",
                nextSteps=["Review identified risks", "Compare supplier options"],
                confidence=0.5,
            )
