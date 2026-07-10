import re
from models.document import Chunk


def build_risk_prompt(chunks: list[Chunk]) -> str:
    context = _format_chunks_for_risk(chunks)

    return f"""You are a senior risk analyst. Analyze the documents below and identify ALL material risks.

DOCUMENTS:
{context}

For each risk identify: financial exposure, legal liability, compliance gaps, operational issues, strategic concerns.

Return ONLY valid JSON (start your response with the opening brace, no preamble):
{{
  "risks": [
    {{
      "id": "r1",
      "level": "HIGH",
      "description": "<specific risk with document evidence, quantified impact, and what happens if ignored>",
      "sourceDocument": "<exact filename>",
      "category": "<Financial | Legal | Compliance | Operational | Strategic | Procurement>"
    }}
  ]
}}

Severity: HIGH=material financial/legal exposure requiring immediate action. MEDIUM=significant gap needing resolution within 30 days. LOW=minor issue for regular review.
Include all material risks. Return ONLY the JSON object, starting with {{."""


# Regex patterns that signal risk-relevant content
_RISK_SIGNALS = re.compile(
    r'\$[\d,]+|%|\bshall\b|\bmust\b|\brequired\b|\bliability\b|\bindemnif|\bterminat|\bpenalt'
    r'|\bexpir|\brenew|\bwarrant|\bIP\b|\bintellectual property\b|\bconfidential\b'
    r'|\bcovenant\b|\bnon.compet|\bassign|\bpayment\b|\bdue\b|\bdeadline\b'
    r'|\bvoid\b|\bbreach\b|\bdispute\b|\bgovernin\b|\bjurisdiction\b',
    re.IGNORECASE,
)


def _format_chunks_for_risk(chunks: list[Chunk], max_chunks_per_doc: int = 8) -> str:
    """
    Format chunks for risk analysis. Dynamically adjusts chunks-per-doc based on
    total document count to balance speed vs coverage:
    - 1 doc:  up to 12 chunks at 1200 chars — full coverage
    - 2 docs: up to 8 chunks at 1000 chars — balanced
    - 3 docs: up to 6 chunks at 900 chars — split evenly
    - 4+ docs: up to 4 chunks at 800 chars — prioritize high-signal chunks
    """
    if not chunks:
        return "(no document content available)"

    from collections import defaultdict
    doc_chunks: dict[str, list[Chunk]] = defaultdict(list)
    for chunk in chunks:
        doc_chunks[chunk.source_document].append(chunk)

    num_docs = len(doc_chunks)

    # Dynamic allocation: more docs = fewer chunks per doc, shorter per chunk
    if num_docs == 1:
        max_per_doc = 8
        max_chars = 1000
    elif num_docs == 2:
        max_per_doc = 5
        max_chars = 900
    elif num_docs == 3:
        max_per_doc = 4
        max_chars = 800
    else:
        # 4+ docs: tighter budget but always prioritize high-risk-signal chunks
        max_per_doc = max(2, 8 // num_docs)
        max_chars = 700

    sections = []
    for doc_name, doc_chunk_list in doc_chunks.items():
        # Score each chunk by risk-signal density
        scored = sorted(
            doc_chunk_list,
            key=lambda c: len(_RISK_SIGNALS.findall(c.text)),
            reverse=True,
        )
        selected = scored[:max_per_doc]
        # Re-sort by original position for readability
        selected.sort(key=lambda c: doc_chunk_list.index(c))

        sections.append(f"\n=== {doc_name} ===")
        for chunk in selected:
            sections.append(chunk.text[:max_chars])

    return "\n".join(sections)


def _format_chunks(chunks: list[Chunk], max_chunks_per_doc: int = 3) -> str:
    """
    Format chunks for LLM prompts. Dynamically adjusts per doc count:
    - 1 doc:  up to 5 chunks — more context for single-doc analysis
    - 2 docs: up to 3 chunks — balanced
    - 3+ docs: up to 2 chunks — keep input tight
    """
    if not chunks:
        return "(no document content available)"

    # Count unique docs
    unique_docs = list(dict.fromkeys(c.source_document for c in chunks))
    num_docs = len(unique_docs)
    if num_docs == 1:
        effective_max = 5
    elif num_docs == 2:
        effective_max = 3
    else:
        effective_max = 2

    sections = []
    current_doc = None
    doc_chunk_count: dict[str, int] = {}
    for chunk in chunks:
        doc = chunk.source_document
        count = doc_chunk_count.get(doc, 0)
        if count >= effective_max:
            continue
        doc_chunk_count[doc] = count + 1
        if doc != current_doc:
            current_doc = doc
            sections.append(f"\n=== {current_doc} ===")
        sections.append(chunk.text[:900])
    return "\n".join(sections)
