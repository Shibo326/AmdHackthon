import json
import logging

from models.document import Chunk
from models.response import Conflict
from prompts.system_prompt import get_system_prompt
from services.llm_service import LLMService, _strip_json_fences

logger = logging.getLogger(__name__)


class ConflictEngine:
    """
    Detects factual contradictions between documents in a session.
    Uses a single consolidated LLM call to analyze ALL documents at once,
    instead of expensive pairwise comparisons (N*(N-1)/2 calls → 1 call).
    """

    def __init__(self, llm_service: LLMService):
        self.llm_service = llm_service

    async def detect(
        self,
        chunks: list[Chunk],
        document_names: list[str],
    ) -> list[Conflict]:
        """
        Analyze ALL documents in a single LLM call for conflicts.

        Args:
            chunks: All chunks in the session
            document_names: List of document filenames to compare

        Returns:
            List of detected Conflict objects
        """
        if len(document_names) < 2:
            logger.debug("Fewer than 2 documents — skipping conflict detection")
            return []

        # Group chunks by source document
        doc_chunks: dict[str, list[Chunk]] = {}
        for chunk in chunks:
            doc = chunk.source_document
            if doc not in doc_chunks:
                doc_chunks[doc] = []
            doc_chunks[doc].append(chunk)

        # Build a single prompt with ALL document excerpts
        prompt = self._build_consolidated_prompt(doc_chunks, document_names)
        system_prompt = get_system_prompt(document_names)

        logger.info(
            f"Running consolidated conflict detection across {len(document_names)} documents (1 LLM call)"
        )

        try:
            raw = await self.llm_service.complete(
                system_prompt, prompt, max_tokens=2048
            )
            raw = _strip_json_fences(raw)
            conflicts = self._parse_conflicts(raw)
            logger.info(
                f"Found {len(conflicts)} conflict(s) across {len(document_names)} documents"
            )
            return conflicts
        except Exception as e:
            logger.warning(f"Consolidated conflict detection failed: {e}")
            return []

    def _build_consolidated_prompt(
        self,
        doc_chunks: dict[str, list[Chunk]],
        document_names: list[str],
    ) -> str:
        """Build a single prompt containing all document excerpts for conflict analysis."""
        sections = []
        for i, doc_name in enumerate(document_names, 1):
            chunks = doc_chunks.get(doc_name, [])
            if not chunks:
                continue
            # Take up to 8 chunks, 1000 chars each — more coverage for tables & pricing data
            content = "\n".join(c.text[:1000] for c in chunks[:8])
            sections.append(f"=== DOCUMENT {i}: {doc_name} ===\n{content}")

        all_docs_content = "\n\n".join(sections)
        doc_list = ", ".join(document_names)

        return f"""You are Clausify AI — a forensic document analyst with the precision of an auditor and the strategic awareness of a deal advisor. Analyze ALL of the following documents and identify factual conflicts BETWEEN them that could create legal, financial, or operational exposure.

DOCUMENTS TO COMPARE: {doc_list}

{all_docs_content}

YOUR ANALYTICAL PROCESS:
1. ALIGN: For each pair of documents, identify subjects, terms, dates, figures, and obligations discussed in BOTH
2. COMPARE: Check if statements about the SAME subject are compatible or contradictory
3. VERIFY: Confirm contradictions are genuine (not just different levels of detail about different topics)
4. QUANTIFY: For each real conflict, estimate the financial or legal exposure
5. PRIORITIZE: Rank by impact — which conflicts need immediate resolution?

WHAT COUNTS AS A CONFLICT:
✓ Price/value discrepancies (e.g., contract says $100/unit, invoice charges $107)
✓ Conflicting dates or deadlines (delivery by March 15 in one, April 1 in another)
✓ Contradictory terms (Net 30 vs. Net 60 for the same relationship)
✓ Mismatched quantities or specifications
✓ Incompatible obligations (Party A must do X in one document, opposite in another)
✓ Inconsistent party identification or role definitions

NOT A CONFLICT:
✗ Different levels of detail about DIFFERENT subjects
✗ Information in one document simply absent from another (that's a gap, not a conflict)
✗ Stylistic or formatting differences
✗ Complementary information that doesn't contradict

FOR EACH CONFLICT — THINK DEEPER:
- What's the financial exposure if the wrong version is followed?
- Which document would likely prevail in a legal dispute? (consider: specificity, recency, hierarchy of documents)
- Is this an innocent discrepancy or a red flag suggesting systematic issues?

SEVERITY:
- HIGH: Direct financial impact (active overcharging), legal liability, or approaching deadline. Resolution within days.
- MEDIUM: Material inconsistency that will cause problems if not resolved before next milestone. Resolution within 2 weeks.
- LOW: Minor discrepancy — worth documenting but limited immediate impact.

If no genuine conflicts exist, return an empty array. Do NOT invent conflicts to appear thorough.

Return ONLY valid JSON:
{{
  "conflicts": [
    {{
      "id": "c1",
      "type": "<specific conflict type: 'Unit Price Discrepancy ($7/unit delta)', 'Payment Terms Contradiction (Net 30 vs Net 60)', etc.>",
      "severity": "HIGH",
      "documentA": {{
        "name": "<document name>",
        "excerpt": "<exact verbatim quote showing the conflicting claim — max 150 chars>"
      }},
      "documentB": {{
        "name": "<other document name>",
        "excerpt": "<exact verbatim quote showing the contradicting claim — max 150 chars>"
      }},
      "explanation": "<WHY incompatible + financial/legal impact + which version is likely authoritative + what happens if unresolved>",
      "recommendedAction": "<specific resolution: who does what, using which document as truth, by when, and how to prevent recurrence>"
    }}
  ]
}}"""

    def _parse_conflicts(self, raw: str) -> list[Conflict]:
        """Parse the LLM response into Conflict objects."""
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse conflict JSON: {e}. Raw: {raw[:200]}")
            return []

        # Handle both formats: {"conflicts": [...]} or bare array [...]
        if isinstance(data, dict):
            data = data.get("conflicts", [])

        if not isinstance(data, list):
            logger.warning(
                f"Conflict response is not a list or wrapped object: {type(data)}"
            )
            return []

        conflicts = []
        for i, item in enumerate(data):
            try:
                item["id"] = f"c{i + 1}"
                conflict = Conflict(**item)
                conflicts.append(conflict)
            except Exception as e:
                logger.warning(f"Skipping malformed conflict item {i}: {e}")
                continue

        return conflicts
