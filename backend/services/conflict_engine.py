import json
import logging
from itertools import combinations

from models.document import Chunk
from models.response import Conflict
from prompts.conflict_detection import build_conflict_prompt
from prompts.system_prompt import get_system_prompt
from services.llm_service import LLMService, _strip_json_fences

logger = logging.getLogger(__name__)


class ConflictEngine:
    """
    Detects factual contradictions between documents in a session.
    Performs pairwise LLM-based comparison of all document pairs.
    """

    def __init__(self, llm_service: LLMService):
        self.llm_service = llm_service

    async def detect(
        self,
        chunks: list[Chunk],
        document_names: list[str],
    ) -> list[Conflict]:
        """
        Compare all document pairs and identify factual contradictions.

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

        all_conflicts: list[Conflict] = []
        conflict_id_counter = 1

        # Cap pairwise comparisons to avoid excessive LLM calls
        # 8 docs = 28 pairs → too slow. Limit to 6 most relevant pairs.
        MAX_PAIRS = 6
        pairs = list(combinations(document_names, 2))
        if len(pairs) > MAX_PAIRS:
            logger.info(f"Limiting conflict detection from {len(pairs)} pairs to {MAX_PAIRS}")
            pairs = pairs[:MAX_PAIRS]

        # Compare document pairs sequentially with delay to respect rate limits
        for i, (doc_a_name, doc_b_name) in enumerate(pairs):
            doc_a_chunks = doc_chunks.get(doc_a_name, [])
            doc_b_chunks = doc_chunks.get(doc_b_name, [])

            if not doc_a_chunks or not doc_b_chunks:
                continue

            logger.debug(f"Checking conflicts between '{doc_a_name}' and '{doc_b_name}'")

            try:
                conflicts = await self._compare_pair(
                    doc_a_chunks,
                    doc_b_chunks,
                    doc_a_name,
                    doc_b_name,
                    start_id=conflict_id_counter,
                )
                all_conflicts.extend(conflicts)
                conflict_id_counter += len(conflicts)
            except Exception as e:
                logger.warning(
                    f"Conflict detection failed for {doc_a_name} vs {doc_b_name}: {e}"
                )
                continue

            # Small delay between pairs to avoid hitting TPM rate limits
            if i < len(pairs) - 1:
                import asyncio
                await asyncio.sleep(1.0)

        logger.info(f"Found {len(all_conflicts)} conflict(s) across {len(document_names)} documents")
        return all_conflicts

    async def _compare_pair(
        self,
        doc_a_chunks: list[Chunk],
        doc_b_chunks: list[Chunk],
        doc_a_name: str,
        doc_b_name: str,
        start_id: int = 1,
    ) -> list[Conflict]:
        """
        Compare a single pair of documents for conflicts.

        Returns:
            List of Conflict objects found between the two documents
        """
        system_prompt = get_system_prompt([doc_a_name, doc_b_name])
        user_prompt = build_conflict_prompt(
            doc_a_chunks, doc_b_chunks, doc_a_name, doc_b_name
        )

        raw = await self.llm_service.complete(system_prompt, user_prompt)
        raw = _strip_json_fences(raw)

        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse conflict JSON: {e}. Raw: {raw[:200]}")
            return []

        # Handle both formats:
        #   - {"conflicts": [...]}  (what build_conflict_prompt requests)
        #   - bare array [...]      (fallback if the LLM ignores the wrapper)
        if isinstance(data, dict):
            data = data.get("conflicts", [])

        if not isinstance(data, list):
            logger.warning(f"Conflict response is not a list or wrapped object: {type(data)}")
            return []

        conflicts = []
        for i, item in enumerate(data):
            try:
                # Ensure IDs are unique across the session
                item["id"] = f"c{start_id + i}"
                conflict = Conflict(**item)
                conflicts.append(conflict)
            except Exception as e:
                logger.warning(f"Skipping malformed conflict item {i}: {e}")
                continue

        return conflicts
