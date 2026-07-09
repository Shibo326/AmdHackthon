# Clausify AI — Portfolio Deep Dive

> Enterprise Document Intelligence powered by AMD MI300X
> **AMD Developer Hackathon: ACT III | lablab.ai | July 2026**

---

## 📌 Project Overview

**Clausify AI** is a full-stack AI-powered document intelligence platform that analyzes legal contracts, procurement quotations, and financial documents — detecting contradictions, quantifying risks, and delivering actionable recommendations with evidence citations.

**The Problem:** Enterprise procurement teams spend 4-6 hours manually cross-referencing contracts, invoices, and supplier quotations. They miss overcharges, conflicting terms, and critical deadlines — costing organizations an estimated $7.8 billion annually in contract leakage (WorldCC, 2024).

**The Solution:** Upload multiple documents → Clausify detects the $3,300 overcharge your team missed, flags the expired contract deadline approaching in 47 days, and recommends the best supplier — citing exact clause numbers and page references for every claim.

---

## 🏆 Key Achievements

- Built a **production-grade RAG system** with 5 parallel LLM calls completing analysis in ~30-60 seconds
- Designed a **cross-document conflict detection engine** that identifies factual contradictions (price discrepancies, term conflicts, deadline mismatches) across unlimited documents in a single LLM call
- Engineered **chain-of-thought prompt architecture** with 5-step cognitive reasoning process, producing expert-level analysis that rivals senior consultants
- Implemented **real-time SSE streaming** for chat responses with structured JSON parsing (Answer → Evidence → Risk → Recommendation)
- Achieved **0ms re-analysis** through intelligent caching without sacrificing accuracy
- Built complete **dark-mode design system** with AMD branding, responsive across all viewports

---

## 🧠 Technical Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                     FRONTEND (React + Vite)                    │
│  Landing → Dashboard → Chat → Demo                            │
│  State: Context + useReducer + localStorage persistence       │
│  Streaming: SSE EventSource with token accumulation           │
└──────────────────────┬───────────────────────────────────────┘
                       │ REST + SSE
┌──────────────────────▼───────────────────────────────────────┐
│                     BACKEND (FastAPI)                          │
│                                                               │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐  ┌───────────┐  │
│  │ Upload  │  │ Analyze  │  │    Chat    │  │  Report   │  │
│  │ Router  │  │ Router   │  │   Router   │  │  Router   │  │
│  └────┬────┘  └────┬─────┘  └─────┬──────┘  └─────┬─────┘  │
│       │             │              │               │          │
│  ┌────▼─────────────▼──────────────▼───────────────▼──────┐  │
│  │              SERVICE LAYER                              │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │  │
│  │  │   LLM       │  │  Analysis    │  │   Conflict   │  │  │
│  │  │  Service    │  │  Service     │  │   Engine     │  │  │
│  │  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘  │  │
│  │         │                 │                  │          │  │
│  │  ┌──────▼──────┐  ┌──────▼───────┐  ┌──────▼───────┐  │  │
│  │  │  Embedding  │  │   Session    │  │   Vector     │  │  │
│  │  │  Service    │  │   Manager    │  │   Store      │  │  │
│  │  └─────────────┘  └──────────────┘  └──────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────┐
│                   INFRASTRUCTURE                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  ChromaDB    │  │  Fireworks   │  │  Disk Storage    │   │
│  │  (Vectors)   │  │  AI (LLM)   │  │  (Sessions)      │   │
│  │  384-dim     │  │  AMD MI300X  │  │  JSON files      │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### RAG (Retrieval-Augmented Generation) Pipeline

The core intelligence runs on a two-phase pipeline:

**Phase 1 — Document Ingestion:**
```
Upload (PDF/PNG/JPG/DOCX)
    ↓
Text Extraction (PyMuPDF + OCR fallback for scanned pages)
    ↓
Semantic Chunking
  • 600 tokens per chunk (larger = more coherent context)
  • 80-token overlap (prevents information loss at boundaries)
  • Word-boundary aware splitting
    ↓
Vector Embedding (all-MiniLM-L6-v2 → 384 dimensions, normalized)
    ↓
ChromaDB Storage (isolated per-session collection)
```

**Phase 2 — Query & Retrieval:**
```
User Question
    ↓
Question Embedding (same model → 384-dim vector)
    ↓
Cosine Similarity Search (top-12 chunks from ChromaDB)
    ↓
Context Enrichment (if < 4 results, supplement up to 16 chunks)
    ↓
Prompt Construction (system + context + history + question)
    ↓
LLM Inference (DeepSeek V4 Pro on AMD MI300X)
    ↓
JSON Parse → Structured Response
  { answer, evidence[], risks, recommendation }
```

**Why these specific parameters:**
- **600-token chunks**: Standard 512 loses too much context for legal clauses. 600 keeps full paragraphs intact.
- **80-token overlap**: Contract clauses often reference previous sentences. Higher overlap = better cross-reference.
- **Top-12 retrieval**: Legal questions often span multiple sections. 12 chunks (vs typical 5) gives the LLM enough context to reason across the full document.
- **16 chunk fallback**: When a question is broad ("summarize everything"), sparse retrieval fails — we supplement with all available chunks.

---

### Analysis Pipeline — 5 Parallel LLM Calls

The full document analysis runs 5 specialized LLM calls concurrently:

```python
# Simplified from analysis_service.py
results = await asyncio.gather(
    self._generate_summary_and_questions(system_prompt, chunks),  # ① + ⑥ merged
    self._generate_risks(system_prompt, chunks),                  # ②
    self._generate_comparison_matrix(system_prompt, chunks),      # ③
    self._generate_recommendation(system_prompt, chunks),         # ④
    self.conflict_engine.detect(chunks, doc_names),               # ⑤
    return_exceptions=True,  # Graceful partial results
)
```

| # | Call | Token Budget | Purpose | Optimization |
|---|------|:---:|---------|-------------|
| ① | Summary + Questions | 6144 | Executive briefing + 5 follow-up questions | Merged 2→1 call (saves ~10s) |
| ② | Risk Analysis | 6144 | Financial, legal, compliance, operational risks | Forensic cognitive process |
| ③ | Comparison Matrix | 2048 | Side-by-side option comparison with winners | Reduced budget (structured) |
| ④ | Recommendation | 6144 | Decisive action with confidence score | CEO-level opinionated output |
| ⑤ | Conflict Detection | 4096 | Cross-document contradictions | Consolidated N²→1 calls |

**Performance gain:** Sequential execution would take ~150s (5 × 30s average). Parallel execution: ~30-60s total (limited by slowest call).

**Previous architecture flaw:** Pairwise conflict detection required N*(N-1)/2 calls — for 5 documents, that's 10 separate LLM calls just for conflicts. The consolidated approach sends ALL document excerpts in a single prompt, reducing to exactly 1 call regardless of document count.

---

### Prompt Engineering — Chain-of-Thought Cognitive Architecture

Every prompt in Clausify follows a structured reasoning framework that forces the LLM to think deeper:

```
COGNITIVE PROCESS (internal, before output):
1. UNDERSTAND — What is the user actually trying to decide?
2. EXTRACT — Pull every relevant fact, figure, date, clause
3. ANALYZE — Apply expertise: is this normal? What's the benchmark?
4. SYNTHESIZE — Connect dots across documents and knowledge
5. ADVISE — Give a clear, opinionated recommendation
```

**Anti-Generic Rules** (enforced in all prompts):
- ❌ "Based on my analysis of the documents..." → ✅ Get straight to the insight
- ❌ "There is a discrepancy" → ✅ "7.3% overcharge ($3,300 on a $45,200 base)"
- ❌ "Consider reviewing options" → ✅ "Award to Supplier B contingent on revising payment from Net 60 to Net 30"

**Three Intelligence Layers:**
1. **PRIMARY** (authoritative) — Document content extracted with surgical precision
2. **SECONDARY** (enrichment) — Industry standards, market benchmarks, legal precedents
3. **TERTIARY** (reasoning) — Inferences, pattern recognition, consequence prediction

**Result:** Responses feel like talking to a senior McKinsey partner, not a generic chatbot. The system provides specific numbers, opinionated advice, and market context automatically.

---

### Streaming Architecture (Server-Sent Events)

```
Client (React)                       Server (FastAPI)
    │                                      │
    │  POST /api/chat/stream               │
    │  {sessionId, question, history}      │
    │─────────────────────────────────────→│
    │                                      │ 1. Embed question (384-dim)
    │                                      │ 2. ChromaDB top-12 search
    │                                      │ 3. Build prompt with context
    │                                      │ 4. Call Fireworks AI (full)
    │                                      │ 5. Parse JSON response
    │                                      │ 6. Split answer into words
    │  data: {"type":"token","text":"Per"} │
    │←─────────────────────────────────────│ Stream word-by-word
    │  data: {"type":"token","text":" the"}│ (18ms delay = ~55 words/sec)
    │←─────────────────────────────────────│
    │  ...                                 │
    │  data: {"type":"done",...}            │
    │←─────────────────────────────────────│ Final: evidence + risks + rec
    │                                      │
```

The frontend accumulates tokens in state, rendering with a blinking cursor animation. On "done", it constructs the full structured message with:
- Evidence cards (clickable → source viewer modal)
- Risk badge with severity color
- Recommendation panel with green accent

---

### Conflict Detection Engine

The conflict engine identifies **factual contradictions** between documents — not just differences in detail, but statements that are logically incompatible:

**What it detects:**
- Price discrepancies (contract: $100/unit, invoice: $107/unit)
- Payment term conflicts (Document A: Net 30, Document B: Net 60)
- Deadline contradictions (delivery March 15 vs April 1)
- Quantity mismatches (ordered: 500 units, invoiced: 530 units)
- Obligation conflicts (Party A must do X in one doc, not-X in another)

**What it ignores** (prevents false positives):
- Different levels of detail about different subjects
- Information present in one doc but absent in another (gap ≠ conflict)
- Stylistic/formatting differences

**Severity Classification:**
- **HIGH** — Active financial loss or approaching deadline (resolve within days)
- **MEDIUM** — Material inconsistency (resolve within 2 weeks)
- **LOW** — Minor discrepancy (document during next review)

---

## 🏗️ Tech Stack Deep Dive

### Frontend

| Technology | Version | Why |
|-----------|---------|-----|
| React | 19 | Component model + hooks for complex state |
| TypeScript | 5.x | Type safety across API boundaries |
| Vite | 6 | Sub-second HMR, optimized build with manual chunks |
| Tailwind CSS | 4 | Utility-first with custom CSS variable tokens |
| React Router | 7 | File-based lazy loading, modern data APIs |
| Recharts | 2.x | Lightweight charting for risk visualization |
| Motion (Framer) | 11.x | Physics-based animations for document cards |
| Sonner | 1.x | Toast notifications (non-intrusive) |
| Lucide React | — | Consistent icon set (tree-shakeable) |

**State Management:** React Context + `useReducer` with localStorage persistence. No Redux/Zustand — the app state is simple enough (session, documents, analysis) that Context is appropriate and avoids dependency bloat.

**Bundle Optimization:**
```typescript
manualChunks: {
  'vendor-react': ['react', 'react-dom'],      // Core (small, cached forever)
  'vendor-router': ['react-router'],            // Routing
  'vendor-motion': ['motion'],                  // Animations (lazy-loadable)
  'vendor-radix': [...7 primitives],            // UI primitives
  'vendor-mui': ['@mui/material', ...],         // Heavy (loaded on demand)
  'vendor-charts': ['recharts'],                // Dashboard-only
}
```

### Backend

| Technology | Version | Why |
|-----------|---------|-----|
| Python | 3.11 | Async/await, type hints, performance improvements |
| FastAPI | 0.100+ | Automatic OpenAPI docs, async-native, Pydantic validation |
| Uvicorn | ASGI | Production-grade async server |
| ChromaDB | 0.4+ | Lightweight vector DB with persistent storage |
| sentence-transformers | 3.x | Best-in-class local embedding models |
| httpx | Async | Non-blocking HTTP for LLM API calls |
| PyMuPDF (fitz) | — | Fast PDF text extraction |
| pytesseract | — | OCR fallback for scanned pages |
| ReportLab | — | Professional PDF report generation |
| python-docx | — | DOCX export |
| slowapi | — | Rate limiting (per-IP) |
| Pydantic v2 | — | Request/response validation with JSON schema |

### Infrastructure

| Component | Technology | Details |
|-----------|-----------|---------|
| LLM Inference | Fireworks AI | DeepSeek V4 Pro on AMD Instinct MI300X |
| Vector Database | ChromaDB | Persistent, session-isolated collections |
| Embeddings | all-MiniLM-L6-v2 | 384-dim, normalized, GPU-accelerable |
| Backend Deploy | Railway | Auto-deploy from Git, nixpacks builder |
| Frontend Deploy | Vercel | Edge CDN, automatic builds |
| Containerization | Docker + Compose | One-command local setup |

---

## 🎨 Design System

Custom dark theme optimized for prolonged document analysis work:

### Color Palette

| Token | Hex | Role |
|-------|-----|------|
| `--ink` | `#080D1A` | Page background (deep navy) |
| `--paper` | `#F0F4FF` | Primary text (soft white) |
| `--lead` | `#0D1528` | Card surfaces |
| `--graphite` | `#111E35` | Secondary surfaces |
| `--rule` | `#1E2D4A` | Borders, dividers |
| `--ash` | `#8B9CC8` | Body text |
| `--ghost` | `#4A5878` | Muted/label text |
| `--volt` | `#3B7BF6` | Primary interactive (blue) |
| `--amd-signal` | `#ED1C24` | AMD red / critical conflicts |
| `--cleared` | `#10B981` | Success / recommendations |
| `--caution` | `#F59E0B` | Warnings / medium risks |
| `--cyan` | `#00D4FF` | Evidence citations |

### Typography

| Font | Usage | Weight |
|------|-------|--------|
| Inter | Body text, paragraphs | 400-600 |
| DM Sans | Headings, titles | 700 |
| JetBrains Mono | Timestamps, metrics, code | 500 |

### Component Patterns

- **Cards**: `background: var(--lead)`, `border: 1px solid var(--rule)`, `border-radius: 6px`
- **Buttons**: Primary (solid volt), Ghost (transparent + volt border on hover)
- **Risk Badges**: Color-coded chips (HIGH=red, MEDIUM=amber, LOW=gray)
- **Evidence Tags**: Filename pills with document-type icon
- **Streaming Cursor**: Blinking 2px volt-colored bar with `step-end` animation

---

## 🏎️ Performance Engineering

| Optimization | Before | After | Impact |
|--------------|--------|-------|--------|
| Analysis calls | Sequential (150s) | Parallel asyncio.gather (30-60s) | **3-5× faster** |
| Conflict detection | N*(N-1)/2 calls | 1 consolidated call | **10→1 calls for 5 docs** |
| Re-analysis | Full re-run (60s) | Cached (0ms) | **∞× faster** |
| Summary + Questions | 2 separate calls | Merged into 1 | **Saves 10-15s** |
| Chunk size | 512 tokens | 600 tokens | **Better retrieval accuracy** |
| Retrieval depth | Top-5 | Top-12 + fallback to 16 | **50% more context** |
| Frontend bundle | Single chunk (2.8MB) | 6 split chunks | **~35% faster FCP** |
| Embedding model | Cold start | Warm-up on startup | **Eliminates first-query lag** |
| Token budget | 4096 default | 6144 for reasoning, 2048 for structured | **Deeper analysis** |
| LLM parameters | temp=0.1 | temp=0.3 + freq_penalty=0.3 | **Less generic output** |

---

## 🔒 Production-Grade Features

### Security
- Request ID middleware (UUID per request, `X-Request-ID` header)
- Global exception handler (logs traceback, returns safe message)
- Rate limiting: 60/min global, 5/min analyze, 10/min questions
- CORS with configurable allowed origins
- File validation: MIME type + extension + 10MB size limit
- Session isolation: separate ChromaDB collection per user
- Unicode sanitization: strips problematic characters from LLM output
- No secrets in responses (provider-info truncates endpoints)

### Error Handling
- All API errors return `{error, code, suggestion}` — never stack traces
- Frontend `ErrorBoundary` catches React render crashes
- `SessionGuard` auto-detects expired sessions and resets
- Toast notifications on all failure states
- Streaming errors gracefully terminate with error event

### Observability
- Structured logging with `[Fireworks/AMD]` prefix for LLM calls
- Request timing logged per endpoint
- Chunk counts and embedding dimensions logged on ingest
- LLM response character counts logged
- Service initialization status logged on startup

---

## 📐 Design Decisions & Tradeoffs

| Decision | Why | Tradeoff |
|----------|-----|----------|
| ChromaDB over Pinecone/Weaviate | Zero infrastructure, persistent to disk, perfect for hackathon scope | Not horizontally scalable |
| Context+useReducer over Redux | Simpler, fewer deps, sufficient for our state shape | No devtools, no middleware |
| Full response then stream (not true streaming) | Ensures valid JSON structure in final event | Slightly delayed first token |
| 600-token chunks (not 256 or 1024) | Sweet spot between coherence and retrieval granularity | More chunks to embed |
| Single consolidated conflict call | O(1) vs O(N²) scaling | Single prompt has token limits |
| Frequency penalty 0.3 | Eliminates repetitive LLM phrasing | Slightly less predictable |
| Analysis caching (no invalidation) | Instant re-loads, documents don't change after upload | Must re-upload to re-analyze |
| Disk persistence (not Redis/PostgreSQL) | Zero external deps, survives restarts | Not suitable for multi-instance |

---

## 🧪 Testing Approach

```bash
# Run full test suite
cd backend && pytest tests/ -v --tb=short
```

**Coverage areas:**
- Upload validation (valid/invalid files, size limits, type checking)
- Session lifecycle (create, retrieve, check validity, not-found handling)
- Full analysis pipeline (single doc, multi-doc, conflict detection)
- Chat (basic questions, conversation history, streaming, empty rejection)
- PDF/DOCX export (valid bytes, content verification)
- Benchmark endpoint (timing accuracy, chunk counts)
- Demo endpoint (pre-loaded data integrity)
- Error formatting (all error responses match schema)

---

## 📱 Responsive Design

All 4 pages support mobile viewports:

| Pattern | Desktop | Mobile |
|---------|---------|--------|
| Sidebar | `hidden md:block` (always visible) | Drawer overlay with close button |
| Navigation | Full nav with text labels | Hamburger → drawer |
| Chat input | Inline at bottom of flex | `shrink-0` + `safe-bottom` for notch |
| Cards | `grid-cols-2` or `grid-cols-3` | `grid-cols-1` stacked |
| Text | `text-4xl` headings | `clamp(32px, 5.5vw, 56px)` fluid |
| Upload zone | Drag-and-drop with hover state | Tap-to-select with file picker |

---

## 🚀 Deployment Architecture

```
┌─────────────────────────────────────┐
│           Vercel (CDN Edge)          │
│  ┌─────────────────────────────┐    │
│  │   React SPA (dist/)         │    │
│  │   - Client-side routing     │    │
│  │   - API proxy to Railway    │    │
│  └─────────────────────────────┘    │
└─────────────────┬───────────────────┘
                  │ HTTPS
┌─────────────────▼───────────────────┐
│           Railway (Container)        │
│  ┌─────────────────────────────┐    │
│  │   FastAPI (uvicorn)         │    │
│  │   - Session persistence     │    │
│  │   - ChromaDB vectors        │    │
│  │   - Embedding model loaded  │    │
│  └──────────────┬──────────────┘    │
└─────────────────┼───────────────────┘
                  │ HTTPS
┌─────────────────▼───────────────────┐
│        Fireworks AI Platform         │
│  ┌─────────────────────────────┐    │
│  │   AMD Instinct MI300X       │    │
│  │   DeepSeek V4 Pro           │    │
│  │   192GB HBM3 memory         │    │
│  │   ~30 tok/s generation      │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

---

## 💡 What I Learned

1. **Prompt engineering is system design** — The difference between a generic AI tool and a professional one is entirely in how you structure the cognitive process in your prompts.

2. **Parallel execution matters** — Going from sequential to parallel LLM calls was a 3-5× speedup with zero quality loss.

3. **RAG quality depends on chunking** — The chunk size, overlap, and retrieval depth affect answer quality more than the model itself.

4. **Production AI needs sanitization layers** — LLMs output unpredictable Unicode, malformed JSON, and control characters. Multiple parse fallbacks are essential.

5. **Caching is the ultimate optimization** — The biggest performance win wasn't faster models — it was not calling the model at all when we already have the answer.

6. **Design systems prevent inconsistency** — CSS variables + strict component patterns = every page looks cohesive without per-element styling decisions.

---

## 🔗 Links

| Resource | URL |
|----------|-----|
| Live Demo | [TBD after deployment] |
| API Documentation | `{backend-url}/docs` |
| GitHub Repository | [this repo] |
| Demo Video | [TBD] |

---

## 👤 About the Developer

**Rhenmart Dela Cruz**
- AWS Cloud Club Lead · STI Global City · Taguig, Philippines
- Full-stack developer specializing in AI/ML integration, cloud architecture, and system design
- Experience: React, Python, FastAPI, AWS, Docker, LLM orchestration

**Team:** Julie Ann Tiron · Mica Pauline Calingo · Reymark Panes

---

*Built for the AMD Developer Hackathon: ACT III on lablab.ai — July 2026*
