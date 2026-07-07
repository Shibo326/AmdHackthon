from models.document import Chunk


def build_risk_prompt(chunks: list[Chunk]) -> str:
    context = _format_chunks(chunks)

    return f"""You are Clausify AI — a senior risk analyst combining document review with domain expertise.

DOCUMENT CONTENT:
{context}

RISK IDENTIFICATION TASK:
Identify ALL material risks in these documents. Use both what the documents explicitly state AND your expert knowledge of what the risks imply in practice.

FOR EACH RISK:
- Root cause: What specific text, figure, clause, or gap in the document creates this risk?
- Business impact: What could realistically happen if this risk is not addressed? (use expert knowledge to quantify or describe consequences)
- Source label: Prefix with "Document confirms:" if found directly in the text, or "Expert inference:" if derived from a gap or implied condition

RISK TYPES TO LOOK FOR:
- Financial: overcharges, unfavorable rates vs. market norms, missing cost controls, budget exposure
- Legal: ambiguous obligations, missing standard clauses (indemnity, limitation of liability, IP ownership, termination for cause), auto-renewal traps
- Compliance: policy violations, missing required approvals, regulatory thresholds, audit exposure
- Operational: single-source dependencies, unclear SLAs, missing escalation paths, supply chain gaps
- Strategic: deadline misses, missed negotiation windows, competitive positioning weaknesses
- Academic/Technical: methodological gaps, version incompatibilities, missing prerequisites, safety issues

EXPERT CONTEXT TO APPLY:
- If a payment term is unusual, note the market standard
- If a contract clause is missing, note what protection it would have provided
- If a deadline has passed, calculate the urgency and consequences
- If a compliance requirement is violated, name the standard or regulation

Return ONLY valid JSON:
{{
  "risks": [
    {{
      "id": "r1",
      "level": "HIGH",
      "description": "<specific risk with document evidence + expert impact assessment. Include exact figures, dates, or clause references where available.>",
      "sourceDocument": "<exact filename>",
      "category": "<Financial | Legal | Compliance | Operational | Strategic | Academic | Technical | Procurement>"
    }}
  ]
}}

Identify ALL material risks — no artificial cap. Use ONLY "HIGH", "MEDIUM", or "LOW" for level.
- HIGH: Immediate financial loss, legal liability, or critical deadline — action required within days
- MEDIUM: Significant issue that will escalate if unaddressed — resolution needed within weeks
- LOW: Minor gap or improvement opportunity with limited immediate impact"""


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
