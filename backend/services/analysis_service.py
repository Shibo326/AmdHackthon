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

# Prompt for comparison matrix — adapts to any document type
COMPARISON_MATRIX_PROMPT = """Based on the document content above, create a comparison matrix.

Adapt to the document type:
- If multiple suppliers/vendors: compare across price, terms, features
- If academic content: compare concepts, theories, approaches, or topics
- If multiple sections/chapters: compare key points, difficulty, coverage
- If a single document: compare different aspects, requirements, or criteria

Return ONLY valid JSON in this exact format:
{{
  "comparisonMatrix": [
    {{
      "field": "<what is being compared, e.g. 'Total Price', 'Key Concept', 'Difficulty Level'>",
      "values": {{
        "<Option/Section/Entity Name>": "<value for this field>"
      }},
      "winner": "<name of the best/recommended option for this field, or null if not applicable>"
    }}
  ]
}}

Include 3-7 comparison fields based on what actually makes sense for this document type.
Base ALL values on the actual document content. Do not include any text outside the JSON object."""


class AnalysisService:
    """
    Orchestrates the full multi-document AI analysis pipeline.
    Runs LLM calls in parallel where possible for performance.
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
        Run the complete analysis pipeline for a session.

        Steps run in parallel:
        - Executive summary
        - Risk analysis
        - Comparison matrix
        - Recommendation
        - Conflict detection

        Args:
            session_id: Session identifier
            chunks: All document chunks for this session
            doc_names: List of document filenames

        Returns:
            Complete AnalysisResult

        Raises:
            LLMParseError: If LLM calls fail after retry
        """
        system_prompt = get_system_prompt(doc_names)

        logger.info(
            f"Starting full analysis for session {session_id} "
            f"({len(chunks)} chunks, {len(doc_names)} documents)"
        )

        # DEBUG: Log first chunk content to verify document was extracted
        if chunks:
            logger.info(f"[DEBUG] First chunk (source={chunks[0].source_document}): {chunks[0].text[:200]}")
        else:
            logger.warning("[DEBUG] NO CHUNKS available for analysis!")

        # Run LLM calls sequentially to respect Groq free-tier rate limits
        # (12,000 tokens/minute). Sequential calls with small delays prevent 429s.
        # Conflict detection runs first as it's independent and caches results.

        # Step 1 — Conflict detection (uses its own sequential loop internally)
        try:
            conflicts = await self.conflict_engine.detect(chunks, doc_names)
        except Exception as e:
            logger.warning(f"Conflict detection failed, using empty: {e}")
            conflicts = []

        await asyncio.sleep(1.0)

        # Step 2 — Executive summary
        try:
            summary_result = await self._generate_summary(system_prompt, chunks)
        except Exception as e:
            raise LLMParseError(f"Summary generation failed: {e}") from e

        await asyncio.sleep(1.5)

        # Step 3 — Risk analysis
        try:
            risks_result = await self._generate_risks(system_prompt, chunks)
        except Exception as e:
            raise LLMParseError(f"Risk analysis failed: {e}") from e

        await asyncio.sleep(1.5)

        # Step 4 — Comparison matrix (non-fatal — soft fail)
        try:
            matrix_result = await self._generate_comparison_matrix(system_prompt, chunks, doc_names)
        except Exception as e:
            logger.warning(f"Comparison matrix failed, using empty: {e}")
            matrix_result = []

        await asyncio.sleep(1.5)

        # Step 5 — Recommendation
        try:
            recommendation_result = await self._generate_recommendation(system_prompt, chunks)
        except Exception as e:
            raise LLMParseError(f"Recommendation failed: {e}") from e

        await asyncio.sleep(1.0)

        # Step 6 — Suggested questions (non-fatal — soft fail)
        try:
            suggested_questions = await self._generate_suggested_questions(chunks)
        except Exception as e:
            logger.warning(f"Suggested questions failed, using empty: {e}")
            suggested_questions = []

        analysis = AnalysisResult(
            analyzedAt=datetime.utcnow(),
            executiveSummary=summary_result,
            risks=risks_result,
            comparisonMatrix=matrix_result,
            conflicts=conflicts,
            recommendation=recommendation_result,
            suggestedQuestions=suggested_questions,
        )

        # Store the completed analysis in the session
        self.session_manager.store_analysis(session_id, analysis)

        logger.info(f"Analysis complete for session {session_id}")
        return analysis

    async def _generate_summary(
        self,
        system_prompt: str,
        chunks: list[Chunk],
    ) -> str:
        """Generate executive summary string."""
        user_prompt = build_summary_prompt(chunks)
        raw = await self.llm_service.complete(system_prompt, user_prompt)
        raw = _strip_json_fences(raw)

        try:
            data = json.loads(raw)
            return data.get("executiveSummary", raw)
        except Exception:
            # If JSON parse fails, return raw text as summary
            return raw.strip()

    async def _generate_risks(
        self,
        system_prompt: str,
        chunks: list[Chunk],
    ) -> list[Risk]:
        """Generate risk analysis list."""
        user_prompt = build_risk_prompt(chunks)
        raw = await self.llm_service.complete(system_prompt, user_prompt)
        raw = _strip_json_fences(raw)

        try:
            data = json.loads(raw)
            risks_data = data.get("risks", [])
            risks = []
            for item in risks_data:
                try:
                    risks.append(Risk(**item))
                except Exception as e:
                    logger.warning(f"Skipping malformed risk item: {e}")
            return risks
        except Exception as e:
            logger.warning(f"Risk parse failed: {e}")
            return []

    async def _generate_comparison_matrix(
        self,
        system_prompt: str,
        chunks: list[Chunk],
        doc_names: list[str],
    ) -> list[ComparisonRow]:
        """Generate comparison matrix rows."""
        # Build context from chunks
        from prompts.executive_summary import _format_chunks
        context = _format_chunks(chunks)
        user_prompt = f"""You are analyzing the following procurement documents:

DOCUMENT CONTEXT:
{context}

{COMPARISON_MATRIX_PROMPT}"""

        raw = await self.llm_service.complete(system_prompt, user_prompt)
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
            parse_attempts.append(raw[brace_start:brace_end + 1])

        for attempt in parse_attempts:
            try:
                data = json.loads(attempt)
                break
            except (json.JSONDecodeError, ValueError):
                continue

        # Last resort: fix common malformed JSON from smaller models
        if data is None:
            import re
            cleaned = raw[brace_start:brace_end + 1] if brace_start != -1 else raw
            # Remove trailing commas before } or ]
            cleaned = re.sub(r',\s*([}\]])', r'\1', cleaned)
            # Replace single quotes with double quotes (careful with apostrophes)
            cleaned = cleaned.replace("'", '"')
            try:
                data = json.loads(cleaned)
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(f"Comparison matrix parse failed after all attempts: {e}")
                return []

        matrix_data = data.get("comparisonMatrix", []) if isinstance(data, dict) else []
        rows = []
        for item in matrix_data:
            try:
                rows.append(ComparisonRow(**item))
            except Exception as e:
                logger.warning(f"Skipping malformed matrix row: {e}")
        return rows

    async def _generate_suggested_questions(
        self,
        chunks: list[Chunk],
    ) -> list[str]:
        """Generate 6 contextually-relevant quick questions based on document content."""
        # Build a compact content sample from the first chunks
        content_sample = ""
        for chunk in chunks[:5]:
            content_sample += chunk.text[:200] + "\n"
        content_sample = content_sample[:1000]

        prompt = f"""Based on the following document content, generate exactly 6 short questions (max 6 words each) that a user would most likely want to ask about this specific document. Adapt to the document type:

- If it's an invoice: ask about costs, payment, line items
- If it's a contract: ask about terms, obligations, deadlines
- If it's a resume/CV: ask about skills, experience, qualifications
- If it's academic: ask about methodology, findings, limitations
- If it's a report: ask about key findings, recommendations, data
- If it's a portfolio: ask about projects, technologies, achievements

DOCUMENT CONTENT:
{content_sample}

Return ONLY valid JSON:
{{"questions": ["question1", "question2", "question3", "question4", "question5", "question6"]}}"""

        try:
            raw = await self.llm_service.complete(
                "You are a helpful assistant that generates relevant questions about documents.",
                prompt,
                max_tokens=256,
            )
            raw = _strip_json_fences(raw)
            data = json.loads(raw)
            questions = data.get("questions", [])
            # Ensure we have exactly 6 short questions
            return [q for q in questions if isinstance(q, str)][:6]
        except Exception as e:
            logger.warning(f"Suggested questions generation failed: {e}")
            return []

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
