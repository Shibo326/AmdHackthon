import asyncio
import json
import logging
from datetime import datetime

from models.document import Chunk
from models.response import (
    AnalysisResult,
    ComparisonRow,
    Recommendation,
    Risk,
)
from prompts.executive_summary import build_summary_prompt
from prompts.recommendation import build_recommendation_prompt
from prompts.risk_analysis import build_risk_prompt
from prompts.system_prompt import get_system_prompt
from services.conflict_engine import ConflictEngine
from services.llm_service import LLMService, LLMParseError, _strip_json_fences
from services.session_manager import SessionManager

logger = logging.getLogger(__name__)

# Timeout for individual LLM calls (seconds)
LLM_CALL_TIMEOUT = 160

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
    - All 5 LLM calls run in parallel (no batching)
    - Suggested questions merged into executive summary call (saves 1 call)
    - Conflict detection consolidated to 1 call for ALL docs (saves N*(N-1)/2 - 1 calls)
    - Per-call timeout of 90s with graceful partial results
    - Reduced max_tokens where possible

    Total LLM calls: 5 (was 6+ sequential/batched, up to 34 with pairwise conflicts)
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

    async def run_full_analysis(
        self,
        session_id: str,
        chunks: list[Chunk],
        doc_names: list[str],
    ) -> AnalysisResult:
        """
        Run the complete analysis pipeline — all 5 calls in parallel.
        gpt-oss-120b is fast (2-5s) so parallel is safe and optimal.
        """
        system_prompt = get_system_prompt(doc_names)

        logger.info(
            f"Starting full analysis for session {session_id} "
            f"({len(chunks)} chunks, {len(doc_names)} documents) — 5 parallel LLM calls"
        )

        if chunks:
            logger.info(
                f"[DEBUG] First chunk (source={chunks[0].source_document}): "
                f"{chunks[0].text[:200]}"
            )
        else:
            logger.warning("[DEBUG] NO CHUNKS available for analysis!")

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
        Merging these saves one full LLM round-trip (10-60s).
        """
        base_prompt = build_summary_prompt(chunks)

        # Append the suggested questions instruction to the summary prompt
        merged_prompt = base_prompt.rstrip()
        # Replace the JSON return format to include questions
        merged_prompt = merged_prompt.replace(
            'Return ONLY valid JSON:\n{\n  "executiveSummary": "<4-6 sentence executive briefing. Lead with the key insight. Include specific figures. Add one expert context point. Flag any urgency. Close with the strategic implication or recommended direction.>"\n}',
            '''Also generate 5 short follow-up questions (max 10 words each) that a decision-maker would most likely want to ask about these documents. Make them SPECIFIC to the content — not generic questions like "What are the key terms?" but rather "Is the $245K/year rate competitive for this scope?"

Return ONLY valid JSON:
{
  "executiveSummary": "<4-6 sentence executive briefing. Lead with the key insight. Include specific figures. Add one expert context point. Flag any urgency. Close with the strategic implication or recommended direction.>",
  "suggestedQuestions": ["question1", "question2", "question3", "question4", "question5"]
}''',
        )

        raw = await self.llm_service.complete(system_prompt, merged_prompt)
        raw = _strip_json_fences(raw)

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
        """Generate risk analysis list."""
        user_prompt = build_risk_prompt(chunks)
        raw = await self.llm_service.complete(system_prompt, user_prompt)
        raw = _strip_json_fences(raw)

        # Robust extraction — try multiple parse strategies
        data = None
        for attempt in [raw, raw[raw.find("{"):raw.rfind("}")+1] if "{" in raw else raw]:
            try:
                data = json.loads(attempt)
                break
            except Exception:
                continue

        if data is None:
            # Last resort: fix trailing commas
            import re
            cleaned = re.sub(r",\s*([}\]])", r"\1", raw)
            try:
                data = json.loads(cleaned)
            except Exception as e:
                logger.warning(f"Risk parse failed after all attempts: {e}")
                return []

        risks_data = data.get("risks", []) if isinstance(data, dict) else []
        risks = []
        for item in risks_data:
            try:
                risks.append(Risk(**item))
            except Exception as e:
                logger.warning(f"Skipping malformed risk item: {e}")
        return risks

    async def _generate_comparison_matrix(
        self,
        system_prompt: str,
        chunks: list[Chunk],
        doc_names: list[str],
    ) -> list[ComparisonRow]:
        """Generate comparison matrix rows with reduced token budget."""
        # Build context from chunks
        from prompts.executive_summary import _format_chunks

        context = _format_chunks(chunks)
        user_prompt = f"""You are analyzing the following procurement documents:

DOCUMENT CONTEXT:
{context}

{COMPARISON_MATRIX_PROMPT}"""

        # Reduced max_tokens: 2048 instead of default 4096
        raw = await self.llm_service.complete(system_prompt, user_prompt, max_tokens=2048)
        raw = _strip_json_fences(raw)

        # Robust JSON extraction — handle common LLM formatting issues
        data = None
        parse_attempts = [
            raw,  # Try as-is first
        ]
        # Try extracting JSON object from surrounding text
        brace_start = raw.find("{")
        brace_end = raw.rfind("}")
        if brace_start != -1 and brace_end > brace_start:
            parse_attempts.append(raw[brace_start : brace_end + 1])

        for attempt in parse_attempts:
            try:
                data = json.loads(attempt)
                break
            except (json.JSONDecodeError, ValueError):
                continue

        # Last resort: fix common malformed JSON from smaller models
        if data is None:
            import re

            cleaned = raw[brace_start : brace_end + 1] if brace_start != -1 else raw
            # Remove trailing commas before } or ]
            cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
            # Replace single quotes with double quotes (careful with apostrophes)
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
        """Generate procurement recommendation."""
        user_prompt = build_recommendation_prompt(chunks)
        raw = await self.llm_service.complete(system_prompt, user_prompt)
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
