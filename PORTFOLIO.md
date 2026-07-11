# Clausify AI — Portfolio

> **AMD Developer Hackathon: ACT II | lablab.ai | July 2026**
> Full-Stack AI Document Intelligence Platform — Built by Rhenmart Dela Cruz

**Live Demo:** https://amd-hackthon-ll14.vercel.app
**Backend API:** https://amdhackthon-production.up.railway.app/docs
**GitHub:** https://github.com/rhenmartion/AmdHackthon
**Track:** Unicorn Track 🦄

---

## Who Built This

I'm **Rhenmart Dela Cruz**, an AWS Cloud Club Lead at STI Global City, Taguig, Philippines. I built Clausify AI as the **sole full-stack developer** for the AMD Developer Hackathon: ACT II on lablab.ai (July 2026).

I was responsible for the **entire codebase** — from the FastAPI backend and RAG pipeline architecture, to the React frontend, prompt engineering, deployment configuration, and performance optimization. My teammates Julie Ann Tiron, Mica Pauline Calingo, and Reymark Panes contributed to the project concept and testing, but all engineering decisions and implementation were mine.

This project represents roughly **2–3 weeks of solo engineering** across a full AI stack: LLM orchestration, vector search, real-time streaming, document parsing, PDF/DOCX export, and a production-grade design system — shipped to live URLs before the hackathon deadline.

---

## What I Built

**Clausify AI** is a document intelligence platform that lets you upload contracts, quotations, and invoices, then instantly get:

- A cross-document conflict report (e.g. "Unit price in the invoice is $107 but the contract says $100 — $3,300 overcharge on 470 units")
- A risk analysis with severity ratings and source citations
- A side-by-side comparison matrix with a winner recommendation
- An AI chat copilot grounded in your documents with streaming responses
- A downloadable PDF or DOCX report of the full analysis

The core problem I was solving: procurement teams manually spend 4–6 hours cross-referencing documents and still miss things. Clausify does it in under 90 seconds, powered by AMD Instinct MI300X hardware via Fireworks AI.

---

## My Role — What I Actually Did

### Backend Architecture (FastAPI / Python)

I designed and built the entire backend from scratch:

- **`main.py`** — FastAPI app with CORS, request ID middleware (UUID per request, `X-Request-ID` header), global exception handler, rate limiting via `slowapi` (60/min global, 5/min analyze), and graceful startup/shutdown with service injection into routers
- **`services/llm_service.py`** — The core LLM client. I implemented tiered model routing (quality model `deepseek-v4-flash` for reasoning tasks, fast model `gpt-oss-120b` for structured extraction), `asyncio.Semaphore(3)` to prevent rate-limit cascades, a persistent `httpx.AsyncClient` with connection pooling (20 keepalive connections), automatic retry with backoff on 429s, and a 5-strategy JSON parsing pipeline to handle every malformed output pattern from LLMs
- **`services/analysis_service.py`** — Orchestrates 5 parallel LLM calls via `asyncio.gather` with per-call timeouts. I engineered the optimization of merging the executive summary and suggested questions into a single call (saving 10–15s), and built a SINGLE_CALL_MODE emergency fallback that combines all analysis into one mega-prompt
- **`services/conflict_engine.py`** — The cross-document conflict detector. Previous architecture required N*(N-1)/2 pairwise calls (10 calls for 5 documents). I redesigned it to send all document excerpts in a single consolidated prompt, making it O(1) regardless of document count
- **`services/embedding_service.py`** — Local `all-MiniLM-L6-v2` sentence transformer (384-dim, normalized vectors), pre-warmed on startup to eliminate first-query cold lag
- **`services/vector_store.py`** — ChromaDB session-isolated collections. Each user gets their own collection so documents never bleed between sessions
- **`services/document_parser.py`** — PyMuPDF text extraction with pytesseract OCR fallback for scanned pages
- **`services/session_manager.py`** — Disk-persistent JSON sessions that survive server restarts
- **`services/pdf_generator.py` + `docx_generator.py`** — Full report export with ReportLab (PDF) and python-docx (DOCX)
- **All 5 routers** — `/api/upload`, `/api/analyze`, `/api/chat`, `/api/chat/stream` (SSE), `/api/report`, `/api/demo`, `/api/benchmark`, `/api/warmup`, `/api/session/*`

### Prompt Engineering

I wrote all 6 prompts from scratch, each following a structured chain-of-thought cognitive architecture:

```
1. UNDERSTAND — What is the user actually trying to decide?
2. EXTRACT    — Pull every relevant fact, figure, date, clause
3. ANALYZE    — Apply expertise: is this normal? What's the benchmark?
4. SYNTHESIZE — Connect dots across documents and knowledge base
5. ADVISE     — Give a clear, opinionated recommendation
```

Every prompt has explicit anti-generic rules — the system is instructed to never say "Based on my analysis..." and to always give specific numbers (e.g., "7.3% overcharge — $3,300 on a $45,200 base" not "there is a discrepancy"). I also specifically engineered around `deepseek-v4-pro`'s `<think>` block issue (it outputs reasoning tags before JSON, breaking parse), which is why I chose `deepseek-v4-flash` as the quality tier.

### RAG Pipeline Design

I designed the full retrieval-augmented generation pipeline:

- **Chunking**: 600-token chunks with 80-token overlap and word-boundary-aware splitting. I specifically chose 600 over the standard 512 because legal clauses often exceed 512 tokens and splitting mid-clause destroys context
- **Retrieval**: Top-12 chunks per query (vs. typical 5) because legal questions often span multiple sections. Added a fallback to 16 chunks when retrieval is sparse (broad questions)
- **Context enrichment**: When fewer than 4 chunks match, the system supplements with additional chunks to prevent empty context windows
- **Embedding**: Normalized 384-dim vectors stored per-session in ChromaDB

### Frontend (React / TypeScript)

I built all 4 pages and the full component system:

- **Landing page** — Drag-and-drop upload zone with live benchmark display, animated loading stages, auto-retry on timeout/network drops, Escape key file clear, warmup ping on mount
- **Dashboard** — Executive summary, risk cards with severity badges, comparison matrix table, conflict cards (AMD red for HIGH severity), recommendation panel, PDF/DOCX export
- **Chat** — Real-time SSE streaming with token accumulation and blinking cursor, conversation history, suggested question chips, evidence cards with source modals
- **Demo** — Pre-loaded demo data page showing the full analysis experience without requiring uploads

State management is React Context + `useReducer` with localStorage persistence so analysis survives page navigation. I made the decision to not use Redux — the state shape (session, documents, analysis) is simple enough that Context + `useReducer` is more appropriate and avoids unnecessary dependency.

I also engineered the bundle splitting strategy in `vite.config.ts` — splitting into 6 manual chunks (react core, router, motion, radix primitives, MUI, recharts) to reduce First Contentful Paint by ~35%.

### Design System

I built a complete dark-mode design system from scratch using CSS custom properties:

- Custom color palette: `--ink` (deep navy background), `--volt` (AMD blue interactive), `--amd-signal` (AMD red for conflicts), `--cleared` (green for recommendations), `--caution` (amber for warnings)
- Typography: Inter (body), DM Sans (headings), JetBrains Mono (metrics/code)
- Consistent component patterns: cards, buttons, risk badges, evidence tags, streaming cursor animation
- Full mobile responsiveness across all 4 pages

### Performance Engineering

Every optimization I made was intentional and measured:

| What I Changed | Before | After |
|---|---|---|
| Sequential → parallel LLM calls | ~150s | ~30–60s |
| N² pairwise conflicts → 1 consolidated call | 10 calls (5 docs) | 1 call |
| 2 separate calls → merged summary+questions | 2 calls | 1 call |
| Re-analysis | 60s full re-run | 0ms (cached) |
| Cold embedding → pre-warm on startup | Lag on first query | Instant |
| Single bundle → 6 split chunks | 2.8MB monolith | ~35% faster FCP |
| `deepseek-v4-pro` → `deepseek-v4-flash` | Parse failures + 140s | Clean JSON + ~30s |
| New HTTP client per request → persistent pool | TCP overhead per call | Pooled connections |

### Infrastructure & DevOps

- Deployed backend to **Railway** (nixpacks builder, auto-deploy on push to `main`)
- Deployed frontend to **Vercel** (edge CDN, auto-deploy on push)
- Wrote `Procfile`, `railway.toml`, and `frontend/Dockerfile`
- Set up GitHub Actions workflow (`keep-alive.yml`) to prevent Railway cold starts
- Configured full environment variable architecture with tiered model support and SINGLE_CALL_MODE emergency fallback

### Testing

I wrote the full test suite in `backend/tests/`:

- Upload validation (valid/invalid MIME types, size limits, extension checks)
- Session lifecycle (create, retrieve, check validity, expired session handling)
- Full analysis pipeline (single doc, multi-doc, conflict detection)
- Chat (basic Q&A, conversation history, streaming, empty input rejection)
- PDF/DOCX export (valid bytes, content verification)
- Benchmark endpoint (timing accuracy, chunk counts)
- Demo endpoint (pre-loaded data integrity)
- Error format compliance (all errors return `{error, code, suggestion}` schema)

---

## Technical Architecture

```
Frontend (React 19 + Vite 6)     →  Vercel (Edge CDN)
Backend  (FastAPI + Python 3.11) →  Railway (Container)
LLM Inference                    →  Fireworks AI (AMD Instinct MI300X)
Embeddings                       →  sentence-transformers (local CPU)
Vector Store                     →  ChromaDB (in-memory, session-isolated)
```

### AI Pipeline — 5 Parallel LLM Calls

```python
results = await asyncio.gather(
    _generate_summary_and_questions(system_prompt, chunks),  # deepseek-v4-flash
    _generate_risks(system_prompt, chunks),                  # deepseek-v4-flash
    _generate_comparison_matrix(system_prompt, chunks),      # gpt-oss-120b (AMD MI300X)
    _generate_recommendation(system_prompt, chunks),         # deepseek-v4-flash
    conflict_engine.detect(chunks, doc_names),               # gpt-oss-120b (AMD MI300X)
    return_exceptions=True,
)
```

All 5 run concurrently. The semaphore caps at 3 concurrent API calls to prevent rate-limit cascades. Each call has an 80s timeout with graceful partial results — if one fails, the other 4 still return.

### RAG Pipeline

```
Upload (PDF/PNG/JPG/DOCX)
    → Text Extraction (PyMuPDF + OCR fallback)
    → Chunking (600 tokens, 80-token overlap, word-boundary aware)
    → Embedding (all-MiniLM-L6-v2 → 384-dim normalized vectors)
    → ChromaDB (isolated per-session collection)

Query
    → Embed question (384-dim)
    → Cosine similarity search (top-12 chunks)
    → Context enrichment (fallback to 16 if sparse)
    → Prompt construction (system + context + history + question)
    → LLM inference (DeepSeek V4 Flash on AMD MI300X)
    → 5-strategy JSON parse → structured response
```

### Streaming Architecture (SSE)

```
POST /api/chat/stream
    → Embed question → ChromaDB top-12 → build prompt
    → Full LLM call → parse JSON → split answer into words
    → Stream word-by-word (data: {"type":"token","text":"..."})
    → Final event: {"type":"done", structuredResponse: {...}}
```

Frontend accumulates tokens in React state with a blinking cursor. On `done`, renders full structured message: evidence cards, risk badge, recommendation panel.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript 5, Vite 6, Tailwind CSS 4, Framer Motion 11 |
| State | React Context + useReducer + localStorage persistence |
| Backend | FastAPI, Python 3.11, Uvicorn, Pydantic v2 |
| AI Inference | Fireworks AI → AMD Instinct MI300X (192GB HBM3) |
| LLM Models | deepseek-v4-flash (quality), gpt-oss-120b (fast/structured) |
| Embeddings | sentence-transformers all-MiniLM-L6-v2 (384-dim) |
| Vector DB | ChromaDB (in-memory, session-isolated) |
| PDF parsing | PyMuPDF, pytesseract (OCR) |
| Export | ReportLab (PDF), python-docx (DOCX) |
| Rate limiting | slowapi (60/min global, 5/min analyze) |
| HTTP client | httpx.AsyncClient (persistent connection pool) |
| Hosting | Railway (backend), Vercel (frontend) |
| CI/CD | GitHub Actions (keep-alive cron) |

---

## Key Engineering Decisions I Made

**Why tiered models?**
Running all 5 calls on a single large model hit rate limits and took 150s+. I split into a quality tier (`deepseek-v4-flash`) for tasks needing deep reasoning (summary, risks, recommendation) and a fast tier (`gpt-oss-120b` on AMD MI300X) for structured extraction (comparison matrix, conflicts). This got analysis down to 30–60s.

**Why `asyncio.Semaphore(3)` instead of letting all 5 run freely?**
Unrestricted concurrency caused 429 rate-limit errors that triggered automatic retries — each retry added 6–12s and made the overall time worse. The semaphore queues calls so at most 3 hit the API simultaneously, preventing cascade failures.

**Why 600-token chunks instead of the standard 512?**
Contract clauses are dense. At 512 tokens, I was splitting mid-clause and losing the logical unit that makes a clause meaningful. 600 tokens keeps most clauses intact, and the 80-token overlap ensures cross-clause references aren't lost at boundaries.

**Why `deepseek-v4-flash` over `deepseek-v4-pro`?**
`deepseek-v4-pro` is a reasoning model that outputs `<think>...</think>` blocks before the actual JSON. My 5-strategy parser can strip these, but the reasoning adds 60–100 extra seconds per call. `deepseek-v4-flash` outputs clean JSON directly and produces equivalent quality for document analysis tasks.

**Why ChromaDB over Pinecone/Weaviate?**
Zero external infrastructure — it runs in-process, persists to disk, and is completely free. For a hackathon with one backend server, this is the right call. The tradeoff is it doesn't scale horizontally, which is acceptable for this scope.

**Why disk persistence for sessions instead of Redis?**
No external dependencies. Sessions survive Railway restarts. The tradeoff is it doesn't work across multiple instances — again, acceptable for a single-server deployment.

---

## Production-Grade Features I Implemented

- **Request ID middleware** — every request gets a UUID, returned in `X-Request-ID` header for traceability
- **Global exception handler** — catches all unhandled exceptions, logs the full traceback server-side, returns only a safe `{error, code, suggestion}` JSON to the client (never leaks stack traces)
- **Rate limiting** — `slowapi` per-IP limits: 60/min global, 5/min for `/analyze`, 10/min for `/chat`
- **File validation** — MIME type check + extension check + 10MB size limit on every upload
- **Session isolation** — every user gets their own ChromaDB collection; documents never bleed between sessions
- **Unicode sanitization** — strips zero-width spaces, soft hyphens, BOM characters, and converts smart quotes that render as boxes in web fonts
- **5-strategy JSON parsing** — handles every malformed LLM output pattern I encountered: direct parse → brace extraction → trailing comma cleanup → regex array extraction → LLM retry with explicit JSON-only instruction
- **ErrorBoundary** — React component that catches render crashes and shows a recovery UI
- **SessionGuard** — checks session validity on app mount, dispatches RESET if session expired on the backend
- **Auto-retry on network drop** — frontend automatically retries analysis once on timeout/network errors, reusing the already-uploaded session so files don't have to be re-uploaded
- **Warmup ping** — fires `GET /api/warmup` on Landing page mount to wake Railway from cold start before the user clicks Analyze

---

## Live Benchmark Results

From the demo validation run:

```
Model:    gpt-oss-120b on AMD Instinct MI300X
Latency:  2,266ms
Speed:    ~56 tokens/second
Test:     structured_analysis (full JSON output)
```

`GET /api/benchmark` endpoint is live — judges (and recruiters) can verify the speed directly.

---

## What I Learned Building This

**Prompt engineering is system design.** The difference between a generic AI tool and something that feels like a senior consultant is entirely in how you structure the cognitive process in your prompts. Anti-generic rules, chain-of-thought frameworks, and specific output schemas matter more than which model you pick.

**Parallel execution changes everything.** Going from sequential to `asyncio.gather` was a 3–5× speedup with zero code quality loss. The bottleneck in AI applications is almost always I/O — embrace async.

**RAG quality is a chunking problem first.** Chunk size, overlap, and retrieval depth affect answer quality more than the model itself. I got better results by tuning chunking parameters than by switching to a larger model.

**Production AI needs sanitization layers.** LLMs output unpredictable Unicode, control characters, malformed JSON, and reasoning preamble. Multiple parse fallbacks aren't defensive coding — they're required engineering.

**Caching is the best optimization.** The biggest performance win in the whole project wasn't faster models or better prompts — it was simply not calling the model at all when the analysis was already cached. 0ms beats 30s every time.

---

## About Me

**Rhenmart Dela Cruz**
AWS Cloud Club Lead · STI Global City · Taguig, Philippines

I'm a full-stack developer focused on AI/ML integration, cloud architecture, and system design. I built Clausify end-to-end — every line of backend Python, every React component, every prompt, every deployment config.

- Frontend: React, TypeScript, Vite, Tailwind CSS, Framer Motion
- Backend: Python, FastAPI, asyncio, Pydantic, httpx
- AI/ML: LLM orchestration, RAG pipelines, vector search, prompt engineering, sentence-transformers
- Infrastructure: AWS, Railway, Vercel, Docker, GitHub Actions
- Databases: ChromaDB, PostgreSQL, DynamoDB

**Team:** Julie Ann Tiron · Mica Pauline Calingo · Reymark Panes (concept and testing support)

---

*Clausify AI — AMD Developer Hackathon: ACT II | lablab.ai | July 2026*
*Built solo by Rhenmart Dela Cruz*
