from models.document import Chunk


def build_conflict_prompt(
    doc_a_chunks: list[Chunk],
    doc_b_chunks: list[Chunk],
    doc_a_name: str,
    doc_b_name: str,
) -> str:
    def fmt(chunks: list[Chunk]) -> str:
        return "\n".join(c.text[:600] for c in chunks[:6])

    content_a = fmt(doc_a_chunks)
    content_b = fmt(doc_b_chunks)

    return f"""You are Clausify AI, a senior document intelligence analyst specializing in cross-document discrepancy detection. Compare these two documents and identify factual conflicts.

=== DOCUMENT A: {doc_a_name} ===
{content_a}

=== DOCUMENT B: {doc_b_name} ===
{content_b}

CONFLICT DETECTION RULES:
- Identify ONLY factual contradictions where the two documents make incompatible claims about the same subject
- Valid conflict types: price/value discrepancies, conflicting dates or deadlines, contradictory terms or conditions, mismatched quantities or specifications, incompatible obligations, inconsistent party names or roles
- Do NOT flag: stylistic differences, different levels of detail on different subjects, information present in one document but absent in another (that is a gap, not a conflict)
- Each conflict must include verbatim quotes from BOTH documents that directly contradict each other
- The explanation must state clearly WHY the two statements are incompatible and what the business implication is
- The recommended action must be specific: who should resolve it, how, and with what evidence

SEVERITY CALIBRATION:
- HIGH: Direct financial impact, legal liability, or contract breach (e.g., invoice overcharge, conflicting payment obligations)
- MEDIUM: Significant operational or compliance inconsistency requiring resolution before proceeding
- LOW: Minor discrepancy with limited immediate impact but worth flagging

If no genuine factual conflicts exist between these two documents, return an empty conflicts array — do not invent conflicts.

Return ONLY valid JSON:
{{
  "conflicts": [
    {{
      "id": "c1",
      "type": "<descriptive conflict type, e.g. 'Price Discrepancy', 'Payment Terms Conflict', 'Delivery Date Mismatch'>",
      "severity": "HIGH",
      "documentA": {{
        "name": "{doc_a_name}",
        "excerpt": "<verbatim quote from Document A showing the conflicting claim, max 150 chars>"
      }},
      "documentB": {{
        "name": "{doc_b_name}",
        "excerpt": "<verbatim quote from Document B showing the contradicting claim, max 150 chars>"
      }},
      "explanation": "<precise explanation of the conflict with business impact: what the discrepancy means in practical terms>",
      "recommendedAction": "<specific resolution action with clear ownership and timeframe>"
    }}
  ]
}}"""
