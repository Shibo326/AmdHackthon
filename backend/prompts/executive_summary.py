from models.document import Chunk


def build_summary_prompt(chunks: list[Chunk]) -> str:
    context = _format_chunks(chunks)
    doc_names = list(dict.fromkeys(c.source_document for c in chunks))
    doc_list = ", ".join(doc_names) if doc_names else "the uploaded document"

    return f"""You are a senior analyst. Write an executive summary for a decision-maker based on these documents.

DOCUMENTS: {doc_list}

{context}

Lead with the single most important finding. Include specific figures. Flag urgency. End with a clear recommended action.

Return ONLY valid JSON:
{{
  "executiveSummary": "<4-6 sentence executive briefing with specific figures, key insight, urgency, and recommended direction>"
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
