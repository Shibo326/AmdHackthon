import re
from models.document import Chunk


def build_risk_prompt(chunks: list[Chunk]) -> str:
    context = _format_chunks_for_risk(chunks)

    return f"""You are Clausify AI — a senior risk analyst with the mindset of a Big Four audit partner. You don't just find risks — you understand their cascade effects, quantify their impact, and prioritize them the way a CFO or General Counsel would.

DOCUMENT CONTENT:
{context}

YOUR COGNITIVE PROCESS (follow this for each potential risk):
1. IDENTIFY: What specific text, figure, clause, or ABSENCE in the document creates exposure?
2. CONTEXTUALIZE: Is this unusual? What's the industry benchmark? What does "normal" look like?
3. QUANTIFY: What's the realistic financial, legal, or operational impact? (estimate ranges if exact figures aren't available)
4. PREDICT: If this risk materializes, what's the likely chain of consequences?
5. PRIORITIZE: How urgent is this? What's the cost of delayed action?

RISK CATEGORIES TO EVALUATE:

FINANCIAL RISKS:
- Overcharges vs. contracted rates or market benchmarks (quantify the delta)
- Unfavorable payment terms and their working capital impact
- Hidden cost escalators, uncapped fees, or undefined change-order pricing
- Budget exposure from ambiguous scope definitions

LEGAL RISKS:
- Missing standard protections (and what each missing clause means in practice)
- One-sided indemnification or liability allocation
- Auto-renewal traps and unfavorable termination provisions
- Ambiguous language that creates enforcement risk
- IP ownership gaps or assignment issues

COMPLIANCE RISKS:
- Regulatory violations (cite the specific regulation: GDPR Art. X, SOX Section Y, etc.)
- Missing approvals or threshold breaches
- Audit trail gaps and documentation deficiencies
- Data handling or privacy exposure

OPERATIONAL RISKS:
- Single-source dependencies with no documented contingency
- SLA gaps (missing metrics, undefined remedies, or inadequate penalties)
- Unclear escalation paths or dispute resolution mechanisms
- Delivery timeline risks and milestone ambiguity

STRATEGIC RISKS:
- Approaching deadlines that reduce negotiating leverage
- Lock-in provisions that limit future flexibility
- Competitive positioning exposure
- Misalignment between contract terms and business objectives

FOR EACH RISK, PROVIDE:
- The specific evidence (quote or describe what in the document triggers this risk)
- Why it matters (the "so what?" — what happens if this is ignored)
- How it compares to industry norms (is this standard or exceptional?)
- Severity with clear justification

Return ONLY valid JSON:
{{
  "risks": [
    {{
      "id": "r1",
      "level": "HIGH",
      "description": "<Specific risk with exact document evidence + expert impact assessment. Include: what the document says/doesn't say, why it's a problem, what the realistic consequence is, and how it compares to standard practice. Be concrete — include figures, timeframes, and regulatory references where applicable.>",
      "sourceDocument": "<exact filename>",
      "category": "<Financial | Legal | Compliance | Operational | Strategic | Procurement>"
    }}
  ]
}}

SEVERITY CALIBRATION:
- HIGH: Material financial exposure (>5% of deal value), active legal liability, approaching regulatory deadline, or breach of fiduciary duty. Action required within 1-2 weeks.
- MEDIUM: Significant gap that creates future exposure if unaddressed. Commercially unfavorable but not immediately dangerous. Resolution within 30 days.
- LOW: Best-practice improvement, minor documentation gap, or de minimis financial impact. Can be addressed during regular review cycles.

Identify ALL material risks — no artificial cap. Quality over quantity — each risk should represent a genuine business concern, not a stylistic observation."""


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
        max_per_doc = 12
        max_chars = 1200
    elif num_docs == 2:
        max_per_doc = 8
        max_chars = 1000
    elif num_docs == 3:
        max_per_doc = 6
        max_chars = 900
    else:
        # 4+ docs: tighter budget but always prioritize high-risk-signal chunks
        max_per_doc = max(3, 12 // num_docs)
        max_chars = 800

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
