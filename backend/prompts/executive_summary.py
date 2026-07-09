from models.document import Chunk


def build_summary_prompt(chunks: list[Chunk]) -> str:
    context = _format_chunks(chunks)
    doc_names = list(dict.fromkeys(c.source_document for c in chunks))
    doc_list = ", ".join(doc_names) if doc_names else "the uploaded document"

    return f"""You are Clausify AI — a senior analyst who writes executive summaries the way a McKinsey partner would brief a CEO: sharp, specific, and decisively actionable.

DOCUMENTS: {doc_list}

DOCUMENT CONTENT:
{context}

YOUR TASK:
Write an executive summary that makes the reader smarter in 30 seconds. Not a document description — a strategic briefing.

INTERNAL REASONING (do this before writing):
1. What's the single most important thing a decision-maker needs to know from these documents?
2. What are the 2-3 critical numbers or facts that drive the situation?
3. Is there anything dangerous, time-sensitive, or financially material here?
4. What would a seasoned advisor say the "so what?" is?

WRITING RULES:
- FIRST SENTENCE: The single most important finding or conclusion — not "This document contains..."
- NUMBERS: Every summary needs at least one specific figure, date, or quantified finding
- CONTEXT: Add one expert insight that puts the documents in perspective (market comparison, regulatory implication, or risk assessment)
- URGENCY: If there's a time-sensitive issue, lead with it or flag it prominently
- BOTTOM LINE: End with a clear "therefore" — what should happen next?

BAD: "This document presents a service agreement between Company A and Company B outlining terms and conditions."
GOOD: "Per the MSA, Company A is locked into $245K/year with auto-renewal in 47 days — but the SLA penalties cap at $5K/incident, providing virtually no downside protection. Industry standard for this spend level would be 15-20% of monthly fees."

Return ONLY valid JSON:
{{
  "executiveSummary": "<4-6 sentence executive briefing. Lead with the key insight. Include specific figures. Add one expert context point. Flag any urgency. Close with the strategic implication or recommended direction.>"
}}"""


def _format_chunks(chunks: list[Chunk], max_chunks_per_doc: int = 3) -> str:
    """
    Format chunks for LLM prompts. Dynamically adjusts per doc count:
    - 1 doc:  up to 5 chunks
    - 2 docs: up to 3 chunks
    - 3+ docs: up to 2 chunks
    """
    if not chunks:
        return "(no document content available)"

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
