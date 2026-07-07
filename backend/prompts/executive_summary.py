from models.document import Chunk


def build_summary_prompt(chunks: list[Chunk]) -> str:
    context = _format_chunks(chunks)
    doc_names = list(dict.fromkeys(c.source_document for c in chunks))
    doc_list = ", ".join(doc_names) if doc_names else "the uploaded document"

    return f"""You are Clausify AI — a senior analyst combining document precision with deep domain expertise.

DOCUMENTS: {doc_list}

DOCUMENT CONTENT:
{context}

SUMMARY TASK:
Write a concise executive summary that gives a decision-maker the full picture — not just what the documents say, but what it means.

STRUCTURE YOUR SUMMARY:
1. Opening sentence: What are these documents and what key situation or decision do they relate to?
2. Key findings: 2-3 most important facts, figures, or findings — with exact numbers from the documents
3. Expert context: Where relevant, add 1 sentence of industry context (e.g., "This price is above the typical market rate for this category" or "This contract structure is standard for enterprise SaaS agreements")
4. Critical flag: Any single most urgent issue requiring immediate attention (if present)
5. Bottom line: The overall implication or recommended direction

LABELING: Prefix document facts with "Per the documents:" and expert context with "Industry context:" or "Typically:"

Do NOT open with "This document presents..." or other filler phrases. Lead with the most important finding.

Return ONLY valid JSON:
{{
  "executiveSummary": "<4-6 sentence professional summary combining document findings with expert context. Specific figures, clear implications, actionable closing.>"
}}"""


def _format_chunks(chunks: list[Chunk]) -> str:
    if not chunks:
        return "(no document content available)"
    sections = []
    current_doc = None
    for chunk in chunks:
        if chunk.source_document != current_doc:
            current_doc = chunk.source_document
            sections.append(f"\n=== {current_doc} ===")
        sections.append(chunk.text[:800])
    return "\n".join(sections)
