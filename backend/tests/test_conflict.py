"""
Tests for ConflictEngine pairwise document conflict detection.
"""

import json
import os
import sys
import uuid
from datetime import datetime
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.document import Chunk


def make_chunk(
    text: str,
    source: str,
    idx: int = 0,
    embedding: list[float] | None = None,
) -> Chunk:
    return Chunk(
        id=str(uuid.uuid4()),
        text=text,
        embedding=embedding or [0.0] * 384,
        source_document=source,
        document_type="pdf",
        chunk_index=idx,
    )


CONTRADICTING_CONFLICT_JSON = json.dumps([
    {
        "id": "c1",
        "type": "Price Discrepancy",
        "severity": "HIGH",
        "documentA": {"name": "invoice.pdf", "excerpt": "Total: $48,500"},
        "documentB": {"name": "contract.pdf", "excerpt": "Agreed price: $45,200"},
        "explanation": "Invoice exceeds the contracted amount by $3,300.",
        "recommendedAction": "Request itemized breakdown from vendor.",
    }
])

NO_CONFLICT_JSON = json.dumps([])


@pytest.mark.asyncio
async def test_conflict_detection_finds_contradictions():
    """
    Two contradicting document excerpts should produce at least one Conflict object.
    """
    from services.conflict_engine import ConflictEngine
    from services.llm_service import LLMService

    # Create mock LLM that returns a conflict
    mock_llm = AsyncMock(spec=LLMService)
    mock_llm.complete = AsyncMock(return_value=CONTRADICTING_CONFLICT_JSON)

    engine = ConflictEngine(mock_llm)

    invoice_chunks = [
        make_chunk("Total amount due: $48,500.00 (including expedite fee)", "invoice.pdf")
    ]
    contract_chunks = [
        make_chunk("Agreed unit price: $45,200.00 per standard order", "contract.pdf")
    ]
    all_chunks = invoice_chunks + contract_chunks

    conflicts = await engine.detect(all_chunks, ["invoice.pdf", "contract.pdf"])

    assert len(conflicts) >= 1
    assert conflicts[0].severity == "HIGH"
    assert conflicts[0].type == "Price Discrepancy"


@pytest.mark.asyncio
async def test_conflict_detection_identical_documents_produces_no_conflicts():
    """
    Identical document excerpts should produce zero conflicts.
    """
    from services.conflict_engine import ConflictEngine
    from services.llm_service import LLMService

    mock_llm = AsyncMock(spec=LLMService)
    mock_llm.complete = AsyncMock(return_value=NO_CONFLICT_JSON)

    engine = ConflictEngine(mock_llm)

    same_text = "Agreed price: $45,200. Payment terms: Net 30."
    chunks_a = [make_chunk(same_text, "doc_a.pdf")]
    chunks_b = [make_chunk(same_text, "doc_b.pdf")]
    all_chunks = chunks_a + chunks_b

    conflicts = await engine.detect(all_chunks, ["doc_a.pdf", "doc_b.pdf"])
    assert len(conflicts) == 0


@pytest.mark.asyncio
async def test_conflict_detection_skips_with_one_document():
    """Fewer than 2 documents means no pairs to compare — returns empty list."""
    from services.conflict_engine import ConflictEngine
    from services.llm_service import LLMService

    mock_llm = AsyncMock(spec=LLMService)
    engine = ConflictEngine(mock_llm)

    chunks = [make_chunk("Some text", "single_doc.pdf")]
    conflicts = await engine.detect(chunks, ["single_doc.pdf"])

    assert conflicts == []
    mock_llm.complete.assert_not_called()


@pytest.mark.asyncio
async def test_conflict_consolidated_single_call_three_docs():
    """
    Three documents should result in exactly 1 consolidated LLM call
    (not 3 pairwise calls). This tests the performance optimization.
    """
    from services.conflict_engine import ConflictEngine
    from services.llm_service import LLMService

    call_count = 0

    async def counting_complete(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        return NO_CONFLICT_JSON

    mock_llm = AsyncMock(spec=LLMService)
    mock_llm.complete = counting_complete

    engine = ConflictEngine(mock_llm)

    doc_names = ["doc_a.pdf", "doc_b.pdf", "doc_c.pdf"]
    all_chunks = [
        make_chunk("Content A", "doc_a.pdf"),
        make_chunk("Content B", "doc_b.pdf"),
        make_chunk("Content C", "doc_c.pdf"),
    ]

    conflicts = await engine.detect(all_chunks, doc_names)
    # Consolidated: 1 call for ALL documents (was 3 pairwise calls)
    assert call_count == 1


@pytest.mark.asyncio
async def test_conflict_handles_malformed_llm_response():
    """Malformed JSON from LLM should not crash — returns empty conflicts."""
    from services.conflict_engine import ConflictEngine
    from services.llm_service import LLMService

    mock_llm = AsyncMock(spec=LLMService)
    mock_llm.complete = AsyncMock(return_value="This is not valid JSON {{{")

    engine = ConflictEngine(mock_llm)
    chunks = [
        make_chunk("Text A", "doc_a.pdf"),
        make_chunk("Text B", "doc_b.pdf"),
    ]
    conflicts = await engine.detect(chunks, ["doc_a.pdf", "doc_b.pdf"])
    assert isinstance(conflicts, list)
    assert len(conflicts) == 0


def test_conflict_model_validation():
    """Conflict model should validate severity field strictly."""
    from models.response import Conflict
    import pydantic

    valid = Conflict(
        id="c1",
        type="Price Discrepancy",
        severity="HIGH",
        documentA={"name": "a.pdf", "excerpt": "text"},
        documentB={"name": "b.pdf", "excerpt": "text"},
        explanation="Explanation",
        recommendedAction="Action",
    )
    assert valid.severity == "HIGH"

    with pytest.raises((pydantic.ValidationError, ValueError)):
        Conflict(
            id="c1",
            type="Test",
            severity="CRITICAL",  # Invalid
            documentA={"name": "a.pdf", "excerpt": "text"},
            documentB={"name": "b.pdf", "excerpt": "text"},
            explanation="test",
            recommendedAction="test",
        )
