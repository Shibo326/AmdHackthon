from models.document import Chunk


def build_recommendation_prompt(chunks: list[Chunk]) -> str:
    context = _format_chunks(chunks)

    return f"""You are Clausify AI — a senior analyst combining document analysis with expert advisory judgment.

DOCUMENT CONTENT:
{context}

RECOMMENDATION TASK:
Provide a clear, decisive recommendation that a decision-maker can act on immediately. Combine what the documents tell you with what your expertise tells you is the right course of action.

RECOMMENDATION STRUCTURE:
1. Title: The specific action to take — direct and unambiguous (e.g., "Award contract to Supplier B after resolving two blocking conditions" — not "Consider options")
2. Summary: 2-3 sentences explaining:
   - What the documents show (key evidence for the recommendation)
   - What expert judgment adds (industry context, risk assessment, best practice)
   - What specific conditions or caveats apply
3. Next Steps: Ordered, concrete actions with:
   - The specific action to take
   - Who owns it (role or team)
   - A timeframe grounded in document deadlines or industry practice

EXPERT JUDGMENT TO APPLY:
- Is the recommended option genuinely the best choice given market standards and industry norms?
- Are the conditions realistic and achievable in the implied timeframe?
- What is the cost of inaction or delay? (use expert knowledge if the documents don't state it)
- What risks remain even after following the recommendation?

LABELING: When citing document evidence, use "Per [filename]:" — when adding expert context, use "Industry practice:" or "Typically:"

Return ONLY valid JSON:
{{
  "title": "<decisive, specific action title — not generic>",
  "summary": "<2-3 sentences combining document evidence + expert judgment. Clear rationale, specific figures, key conditions.>",
  "nextSteps": [
    "<Step 1: specific action | owner | timeframe>",
    "<Step 2: specific action | owner | timeframe>",
    "<Step 3: specific action | owner | timeframe>",
    "<Step 4: specific action | owner | timeframe>"
  ],
  "confidence": 0.85
}}

Confidence calibration:
- 0.90–1.0: Strong document evidence + clear best practice alignment
- 0.75–0.89: Good evidence but some gaps or conditions required
- 0.60–0.74: Partial information, recommendation requires validation
- Below 0.60: Significant uncertainty, flag explicitly in summary"""


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
