# Clausify AI ⚡

### AMD-Accelerated Enterprise Document Intelligence

> Upload contracts, quotations, and invoices.
> Ask anything in plain language.
> Get evidence-backed **decisions** — not summaries. Decisions.

**AMD Developer Hackathon: ACT III | lablab.ai | July 2026**

---

## 🚀 Quick Start (Para sa mga Teammates)

### Prerequisites

- **Node.js 20+** (for frontend)
- **Python 3.11+** (for backend)
- **Git** (obviously)
- **Fireworks AI API Key** — get one at https://app.fireworks.ai/settings/api-keys

### Step 1: Clone and Setup

```bash
git clone https://github.com/your-username/AmdHackthon-main.git
cd AmdHackthon-main
```

### Step 2: Backend Setup

```bash
cd backend
cp .env.example .env
# EDIT .env — paste your FIREWORKS_API_KEY (kuhanin kay Rhen)

# Create virtual environment (recommended)
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Mac/Linux

# Install dependencies
pip install -r requirements.txt

# Run the backend
uvicorn main:app --reload --port 8000
```

Backend runs at: **http://localhost:8000**
API Docs at: **http://localhost:8000/docs**

### Step 3: Frontend Setup (new terminal)

```bash
cd frontend
cp .env.example .env
# .env should have: VITE_API_URL=http://localhost:8000

# Install dependencies
npm install

# Run the frontend
npm run dev
```

Frontend runs at: **http://localhost:5173**

### Step 4: Test It

1. Open http://localhost:5173
2. Go to `/demo` — should show pre-loaded contracts with analysis
3. Try uploading a PDF on the landing page
4. Check `/chat` after analysis completes

### Alternative: Docker (one command, everything runs)

```bash
# From project root
cp backend/.env.example backend/.env
# Edit backend/.env — add FIREWORKS_API_KEY

docker compose up --build
```
- Frontend: http://localhost:3000
- Backend: http://localhost:8000
- Demo: http://localhost:3000/demo

---

## 📋 Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FIREWORKS_API_KEY` | **Yes** | — | Fireworks AI API key (runs on AMD MI300X) |
| `FIREWORKS_MODEL` | No | `accounts/fireworks/models/llama-4-maverick-instruct` | Model to use |
| `FIREWORKS_ENDPOINT` | No | `https://api.fireworks.ai/inference/v1` | API endpoint |
| `ALLOWED_ORIGINS` | No | `*` | CORS origins (comma-separated) |
| `PORT` | No | `8000` | Server port |

### Frontend (`frontend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:8000` | Backend API URL |

> ⚠️ **NEVER commit `.env` files.** They're in `.gitignore`. Use `.env.example` as reference.

---

## 🏗️ What is Clausify?

Clausify AI reads multiple business documents simultaneously, detects conflicts and contradictions across them, and provides evidence-cited answers — all powered by AMD MI300X hardware.

**The problem:** Procurement teams spend 4-6 hours cross-referencing contracts, invoices, and quotations. They miss overcharges, conflicting terms, and expired deadlines.

**Our solution:** Upload documents → AI detects the $3,300 overcharge, flags the expired deadline, recommends the best supplier — with exact source citations for every claim.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite 6 + Tailwind CSS 4 |
| Routing | React Router 7 |
| State | React Context + useReducer (persisted to localStorage) |
| Animations | Framer Motion |
| Icons | Lucide React |
| Toasts | Sonner |
| Charts | Recharts |
| Backend | Python 3.11 + FastAPI + Uvicorn |
| Vector DB | ChromaDB (persistent, per-session) |
| Embeddings | sentence-transformers (all-MiniLM-L6-v2, 384-dim) |
| LLM | Fireworks AI → **Llama 4 Maverick** on AMD MI300X |
| PDF Export | ReportLab |
| DOCX Export | python-docx |
| OCR | PyMuPDF + pytesseract + Pillow |
| Rate Limiting | slowapi |
| Deployment | Docker / Railway (backend) + Vercel (frontend) |

---

## 🔌 AMD Integration

| Layer | Technology | Hardware |
|-------|-----------|----------|
| Embeddings | sentence-transformers (all-MiniLM-L6-v2) | AMD Instinct MI300X via ROCm |
| LLM Inference | **Llama 4 Maverick (400B MoE, 17B active)** | Fireworks AI on AMD Instinct MI300X |

All LLM inference runs on AMD Instinct MI300X hardware via Fireworks AI.
The system auto-detects AMD ROCm for local embedding GPU acceleration.

---

## ✨ Features

- 📄 Multi-document upload (PDF, PNG, JPG, JPEG) — up to 10 files, 10MB each
- 🔍 OCR for scanned invoices and images (pytesseract + PyMuPDF)
- ⚡ Cross-document **Conflict Detection Engine** — flags contradictions automatically
- 📊 Executive summary, risk analysis, supplier comparison matrix, recommendation
- 💬 Decision Copilot chat with SSE streaming responses
- 📎 Evidence-cited structured answers (Answer → Evidence → Risk → Recommendation)
- 📥 PDF & DOCX report export with analytics dashboard
- 🎯 Pre-loaded demo mode (zero upload needed)
- 🐳 Fully containerized (Docker + Docker Compose)
- 📱 Mobile responsive (all 4 pages)

---

## 📁 Project Structure

```
AmdHackthon-main/
├── docker-compose.yml           # One command to run everything
├── railway.toml                 # Railway deployment config
│
├── backend/
│   ├── Dockerfile               # Backend container
│   ├── main.py                  # FastAPI entry point + service wiring
│   ├── requirements.txt         # Python dependencies
│   ├── .env.example             # Env var template (copy to .env)
│   ├── routers/                 # API route handlers
│   │   ├── upload.py            # POST /api/upload
│   │   ├── analyze.py           # POST /api/analyze + /api/benchmark
│   │   ├── chat.py              # POST /api/chat + /api/chat/stream
│   │   ├── report.py            # POST /api/report (PDF/DOCX)
│   │   └── demo.py              # GET /api/demo (pre-loaded data)
│   ├── services/                # Business logic
│   │   ├── llm_service.py       # Fireworks AI / AMD abstraction
│   │   ├── analysis_service.py  # 5-parallel-call analysis pipeline
│   │   ├── conflict_engine.py   # Cross-document contradiction detection
│   │   ├── embedding_service.py # Text chunking + vector generation
│   │   ├── vector_store.py      # ChromaDB wrapper
│   │   ├── session_manager.py   # Session persistence (JSON on disk)
│   │   ├── document_parser.py   # PDF/image text extraction
│   │   ├── pdf_generator.py     # ReportLab PDF export
│   │   └── docx_generator.py    # python-docx DOCX export
│   ├── models/                  # Pydantic data models
│   │   ├── document.py          # Chunk, UploadedDocument
│   │   └── response.py          # All request/response schemas
│   ├── prompts/                 # LLM prompt templates
│   │   ├── system_prompt.py     # Master system prompt
│   │   ├── executive_summary.py # Summary generation
│   │   ├── risk_analysis.py     # Risk identification
│   │   ├── recommendation.py    # Action recommendation
│   │   ├── conflict_detection.py# Pairwise conflict prompt
│   │   └── chat_copilot.py      # RAG chat prompt
│   ├── tests/                   # pytest test suite
│   └── data/                    # Persisted sessions + ChromaDB
│
├── frontend/
│   ├── Dockerfile               # Frontend container (nginx)
│   ├── vercel.json              # Vercel deployment config
│   ├── package.json             # Node dependencies
│   ├── vite.config.ts           # Vite build config
│   ├── .env.example             # Frontend env template
│   └── src/
│       ├── main.tsx             # Entry: ErrorBoundary → AppProvider → App
│       ├── styles/
│       │   ├── theme.css        # Design system tokens (CSS variables)
│       │   └── index.css        # Global styles + animations
│       ├── app/
│       │   ├── App.tsx          # SessionGuard + Router + Toaster
│       │   ├── routes.tsx       # Lazy-loaded route definitions
│       │   ├── pages/
│       │   │   ├── Landing.tsx  # Upload + hero page (route: /)
│       │   │   ├── Dashboard.tsx# Analysis results (route: /dashboard)
│       │   │   ├── Chat.tsx     # Decision Copilot (route: /chat)
│       │   │   └── Demo.tsx     # Pre-loaded demo (route: /demo)
│       │   └── components/
│       │       ├── NavigationBar.tsx
│       │       ├── Badges.tsx   # RiskBadge, EvidenceTag, EvidenceBox
│       │       ├── Buttons.tsx  # PrimaryButton, GhostButton
│       │       ├── Card.tsx
│       │       ├── DocumentStack.tsx # Framer Motion file cards
│       │       └── ErrorBoundary.tsx
│       └── lib/
│           ├── api.ts           # All API calls (fetch-based)
│           ├── store.tsx        # Context + useReducer global state
│           ├── types.ts         # TypeScript interfaces (SOURCE OF TRUTH)
│           └── sanitize.ts      # Text sanitization utility
│
├── sample_documents/            # Demo documents for testing
│   ├── Demo_Contract_TechCorp.txt
│   ├── Demo_Invoice_TechCorp.txt
│   └── Demo_Quotation_TechCorp.txt
│
└── .kiro/
    ├── agents/                  # Kiro sub-agents for AI-assisted dev
    └── specs/                   # UI redesign specification
```

---

## 🔄 How It Works (Architecture)

```
User uploads files (PDF/PNG/JPG)
    ↓
DocumentParser extracts text (PyMuPDF + OCR for images)
    ↓
EmbeddingService chunks text (600 tokens, 80 overlap) + generates 384-dim vectors
    ↓
VectorStore saves chunks in ChromaDB (isolated per-session collection)
    ↓
AnalysisService runs 5 PARALLEL LLM calls:
  ① Executive Summary + Suggested Questions (merged, saves 1 call)
  ② Risk Analysis
  ③ Comparison Matrix
  ④ Conflict Detection (1 consolidated call for ALL docs)
  ⑤ Recommendation
    ↓
Dashboard displays results (cards, charts, conflict banner)
    ↓
Chat uses RAG: embed question → top-12 vector search → LLM with context
    → structured response (Answer / Evidence / Risk / Recommendation)
    ↓
Export: PDF or DOCX report with analytics dashboard
```

---

## 🔗 API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/upload` | Upload documents (multipart/form-data) |
| `GET` | `/api/session/{id}/check` | Check if session is still valid |
| `POST` | `/api/analyze` | Run full AI analysis on session |
| `POST` | `/api/suggest-questions` | Generate contextual quick questions |
| `GET` | `/api/benchmark` | **Live LLM speed benchmark** — judges can verify tok/s |
| `POST` | `/api/chat` | RAG Q&A (JSON response) |
| `POST` | `/api/chat/stream` | RAG Q&A (SSE streaming) |
| `POST` | `/api/report` | Generate PDF/DOCX report |
| `GET` | `/api/provider-info` | Current LLM provider config |
| `GET` | `/api/demo` | Pre-loaded demo data |
| `GET` | `/health` | Health check |

Full interactive API docs: http://localhost:8000/docs

---

## 👨‍💻 For Teammates / AI Agents

> **READ THIS SECTION FIRST** if you're working on the codebase or if an AI agent
> is helping you. This is the source of truth for how the system is structured.

### 🚫 Rules (Do NOT break these)

1. **Never break existing API contracts** — `frontend/src/lib/types.ts` defines exact shapes
2. **Never modify** `api.ts`, `store.tsx`, or `types.ts` without team discussion
3. **Use `FIREWORKS_API_KEY` for all testing** — same provider for dev and production
4. **State management is Context + useReducer** (NOT Redux, NOT Zustand)
5. **Routing is React Router 7** (NOT Next.js, NOT react-router-dom)
6. **Icons are Lucide React** (NOT Material Symbols, NOT Heroicons)
7. **Animation library is `framer-motion`** (also exported as `motion` package)
8. **Toast notifications use `sonner`** (NOT react-toastify)
9. **CSS is Tailwind 4** with custom CSS variables in `theme.css`

### 📖 Key Files to Read First

**Backend (understand the wiring):**
1. `backend/main.py` — how services are initialized and injected into routers
2. `backend/services/llm_service.py` — LLM provider abstraction (Fireworks/AMD)
3. `backend/services/analysis_service.py` — the 5-parallel-call analysis pipeline
4. `backend/models/response.py` — all Pydantic schemas (must match frontend types)

**Frontend (understand the data flow):**
1. `frontend/src/lib/types.ts` — TypeScript interfaces (**source of truth**)
2. `frontend/src/lib/api.ts` — all API calls (fetch-based, no axios)
3. `frontend/src/lib/store.tsx` — global state shape + actions
4. `frontend/src/app/App.tsx` — SessionGuard + routing + toast setup

### 🧪 Running Tests

```bash
cd backend
pip install -r requirements.txt   # if not done yet
pytest tests/ -v
```

### 🏃 Running Backend Only

```bash
cd backend
uvicorn main:app --reload --port 8000
```

### 🏃 Running Frontend Only

```bash
cd frontend
npm install    # first time only
npm run dev
```

### 🔧 Frontend Build (production)

```bash
cd frontend
npm run build    # outputs to frontend/dist/
```

---

## 🚢 Deployment

### Backend → Railway

1. Connect GitHub repo to Railway
2. Set environment variables in Railway dashboard:
   - `FIREWORKS_API_KEY` (required)
   - `FIREWORKS_MODEL` (optional, has default)
   - `FIREWORKS_ENDPOINT` (optional, has default)
   - `ALLOWED_ORIGINS` = your Vercel frontend URL
3. Railway auto-deploys from `railway.toml` config

### Frontend → Vercel

1. Connect GitHub repo to Vercel
2. Set root directory to `frontend`
3. Set environment variable: `VITE_API_URL` = your Railway backend URL
4. Vercel auto-deploys from `frontend/vercel.json` config

### Docker (local or self-hosted)

```bash
cp backend/.env.example backend/.env
# Edit .env with your FIREWORKS_API_KEY
docker compose up --build
```

---

## 🎮 Demo for Judges / Presentation

1. **Zero-upload demo:** Visit `/demo` — 5 pre-loaded procurement docs, full analysis, pre-seeded chat
2. **Upload flow:** Drop PDFs on `/` → analysis in ~60s → dashboard with conflicts highlighted
3. **Chat:** Ask "Which supplier is safest?" → streaming response with evidence citations
4. **Export:** Click export dropdown → choose PDF or DOCX → download professional report

### Demo Script (3.5 minutes)

| Step | Time | Action |
|------|------|--------|
| 1. Hook | 30s | Open `/demo`, show conflict banner + pre-loaded analysis |
| 2. Upload | 45s | Go to `/`, drag-drop PDFs, click Analyze, show AMD processing |
| 3. Dashboard | 60s | Show executive summary, risks, comparison matrix, export PDF |
| 4. Chat | 60s | Ask questions, show streaming + evidence citations |
| 5. AMD | 15s | Point to AMD badge, mention MI300X hardware, say thank you |

---

## 🔀 Git Workflow (Para sa Team)

```bash
# Always pull latest before working
git checkout dev-1
git pull origin dev-1

# Create your feature branch
git checkout -b feature/your-feature-name

# Work on your changes...
# When done:
git add .
git commit -m "feat: describe what you did"
git push -u origin feature/your-feature-name

# Then create a Pull Request to dev-1 on GitHub
```

### Branch Strategy
- `main` — production ready, deployed
- `dev-1` — development integration branch (merge PRs here)
- `feature/*` — individual feature branches

---

## 🤖 AI Agent Instructions

> This section is for AI coding assistants (Kiro, Cursor, Copilot, etc.)
> reading this repo for the first time.

### How to Run the Full System

1. **Backend**: `cd backend && pip install -r requirements.txt && uvicorn main:app --reload --port 8000`
2. **Frontend**: `cd frontend && npm install && npm run dev`
3. **Both need**: `backend/.env` with valid `FIREWORKS_API_KEY`

### Architecture Summary

- **Monorepo**: `/backend` (Python/FastAPI) + `/frontend` (React/Vite)
- **State**: Frontend uses React Context + useReducer, persisted to localStorage
- **API**: REST + SSE streaming. All types defined in `frontend/src/lib/types.ts`
- **LLM**: All calls go through `backend/services/llm_service.py` → Fireworks AI
- **Vector Search**: ChromaDB with per-session collections, 384-dim embeddings
- **Sessions**: JSON files on disk (`backend/data/sessions/`), loaded on startup

### Key Constraints

- TypeScript types in `frontend/src/lib/types.ts` are the contract between frontend and backend
- Backend response models in `backend/models/response.py` MUST match those types exactly
- Services are injected into routers at startup (see `main.py` `startup_event()`)
- The frontend uses `fetch()` directly — no axios, no tanstack-query
- Rate limiting: 60/min global, 5/min for `/api/analyze`, 10/min for `/api/suggest-questions`

### Available Kiro Agents (.kiro/agents/)

7 specialized agents for automated development tasks:
1. `clausify-ui-redesign` — Design system token application
2. `clausify-frontend-integration` — API wiring + toast notifications
3. `clausify-backend-hardening` — Production improvements
4. `clausify-testing` — Full test suite
5. `clausify-performance` — Speed optimization
6. `clausify-deployment` — Railway + Vercel configs
7. `clausify-demo-validator` — Final pre-submission validation

---

## 🧠 Deep Technical Architecture

### RAG (Retrieval-Augmented Generation) Pipeline

Clausify implements a production-grade RAG system that combines semantic vector search with expert-tuned LLM prompting:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INGESTION PIPELINE                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  PDF/Image Upload                                                   │
│       ↓                                                             │
│  DocumentParser (PyMuPDF + pytesseract OCR)                        │
│       ↓                                                             │
│  Raw Text (per document)                                            │
│       ↓                                                             │
│  EmbeddingService.chunk_text()                                      │
│  ┌──────────────────────────────────────────────┐                  │
│  │ Semantic chunking: 600 tokens per chunk       │                  │
│  │ 80-token overlap (preserves cross-boundary    │                  │
│  │ context for clause references)                │                  │
│  │ Word-boundary aware splitting                 │                  │
│  └──────────────────────────────────────────────┘                  │
│       ↓                                                             │
│  SentenceTransformer.encode() → 384-dim normalized vectors         │
│       ↓                                                             │
│  ChromaDB (persistent, session-isolated collection)                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        RETRIEVAL PIPELINE                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  User Question                                                      │
│       ↓                                                             │
│  EmbeddingService.embed(question) → 384-dim query vector           │
│       ↓                                                             │
│  ChromaDB cosine similarity search (top-12 chunks)                  │
│       ↓                                                             │
│  Context Enrichment:                                                │
│  ┌──────────────────────────────────────────────┐                  │
│  │ If < 4 chunks retrieved:                      │                  │
│  │   Supplement with ALL session chunks          │                  │
│  │   up to 16 total (ensures full-doc questions  │                  │
│  │   aren't left without context)                │                  │
│  └──────────────────────────────────────────────┘                  │
│       ↓                                                             │
│  build_chat_prompt(question, chunks, history)                       │
│  ┌──────────────────────────────────────────────┐                  │
│  │ System: Expert analyst persona (world-class)  │                  │
│  │ Context: Top-12 chunks (1200 chars each)      │                  │
│  │ History: Last 5 conversation turns            │                  │
│  │ Question: User's actual query                 │                  │
│  │ Format: Enforced JSON structure               │                  │
│  └──────────────────────────────────────────────┘                  │
│       ↓                                                             │
│  Fireworks AI (DeepSeek V4 Pro on AMD MI300X)                      │
│  Parameters: temp=0.3, top_p=0.9, freq_penalty=0.3                │
│  Max tokens: 6144 (allows deep reasoning)                          │
│       ↓                                                             │
│  Structured Response:                                               │
│  { answer, evidence[], risks, recommendation }                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Analysis Pipeline (5 Parallel LLM Calls)

The full analysis runs 5 specialized LLM calls **concurrently** using `asyncio.gather()`, reducing total time from ~150s (sequential) to ~30-60s (parallel):

| Call | Purpose | Token Budget | Optimization |
|------|---------|:------------:|--------------|
| ① Summary + Questions | Executive briefing + 5 suggested questions | 6144 | Merged into 1 call (saves 10s) |
| ② Risk Analysis | Identify financial, legal, compliance risks | 6144 | Forensic reasoning process |
| ③ Comparison Matrix | Side-by-side supplier/option comparison | 2048 | Reduced budget (structured output) |
| ④ Recommendation | Decisive action with next steps | 6144 | CEO-level opinionated advice |
| ⑤ Conflict Detection | Cross-document contradictions | 4096 | Consolidated (1 call for ALL docs) |

**Previous architecture** used pairwise conflict detection: N*(N-1)/2 calls for N documents (up to 10 calls for 5 docs). The consolidated approach reduces this to exactly **1 call** regardless of document count.

### Prompt Engineering Philosophy

Every prompt follows a 5-step cognitive architecture:

1. **UNDERSTAND** — Infer user intent beyond the literal question
2. **EXTRACT** — Pull exact figures, dates, clauses from documents
3. **ANALYZE** — Apply domain expertise (benchmarks, norms, precedents)
4. **SYNTHESIZE** — Connect dots across documents and knowledge
5. **ADVISE** — Give opinionated, actionable recommendations

Anti-generic rules enforced in all prompts:
- "Never use filler phrases like 'Based on my analysis...'"
- "Be SPECIFIC: '7.3% overcharge ($3,300 on $45,200 base)' not 'there is a discrepancy'"
- "Every finding includes who should do what by when"
- Good/bad output examples in each prompt

### Session & Persistence Architecture

```
SessionManager
├── In-memory dict (fast access)
├── JSON persistence (survives restarts)
│   └── backend/data/sessions/{session_id}.json
├── Analysis caching (avoids re-running LLM)
└── ChromaDB collections (one per session)
    └── backend/data/chroma/
```

Sessions are created on upload and persist to disk immediately. On startup, all sessions are loaded from disk. Analysis results are cached — subsequent `/api/analyze` calls return instantly if analysis is already complete.

### Streaming Architecture (SSE)

The chat endpoint supports real-time streaming via Server-Sent Events:

```
Client                          Server
  │                               │
  │  POST /api/chat/stream        │
  │  {sessionId, question, hist}  │
  │──────────────────────────────→│
  │                               │ embed question
  │                               │ retrieve top-12 chunks
  │                               │ call LLM (full response)
  │                               │ parse JSON
  │  data: {type:"token", text}   │
  │←──────────────────────────────│ stream answer word-by-word
  │  data: {type:"token", text}   │ (~55 words/sec, 18ms delay)
  │←──────────────────────────────│
  │  ...                          │
  │  data: {type:"done", ...}     │
  │←──────────────────────────────│ final: evidence + risks + rec
  │                               │
```

The frontend accumulates tokens in a `streamingAnswer` state variable, rendering with a blinking cursor. On "done", it constructs the full structured message with evidence cards, risk badges, and recommendation panel.

---

## 🏎️ Performance Optimizations

**Target: Analysis completes in under 10 seconds**

| Optimization | Impact | How |
|--------------|--------|-----|
| **Llama 4 Maverick** | 2-3× faster inference | 200-300 tok/s (vs 150 tok/s on gpt-oss-120b) |
| **Persistent HTTP client** | Eliminates TCP overhead | Connection pooling across all LLM calls |
| **Fireworks 'fast' tier** | 2-3× higher throughput | Enabled on all inference requests |
| **Lower temperature (0.1)** | Faster token selection | Deterministic mode for structured JSON |
| Parallel LLM calls | 3-5× faster analysis | `asyncio.gather()` for all 5 calls |
| Tighter token budgets | 15% fewer tokens | 900-1200 per call (was 1000-1500) |
| Analysis caching | 0ms on re-analysis | Check `session.analysis` before re-running |
| Suggested questions cache | 0ms on repeat | Reuses from completed analysis |
| Consolidated conflicts | N²→1 calls | Single prompt for all documents |
| Vite bundle splitting | ~35% faster FCP | 6 manual chunks (react, router, radix, mui, charts, motion) |
| Embedding warm-up | Eliminates cold start | Model encoded "warmup" string on startup |
| Chunk size tuning | Better retrieval | 600 tokens + 80 overlap (vs 512/50 default) |
| Top-12 retrieval | Richer context | 12 chunks (vs typical 5) + fallback to 16 |
| Frequency penalty 0.3 | Less repetition | LLM avoids repeating generic phrases |

**Benchmark endpoint**: Hit `/api/benchmark` to see live tok/s and latency numbers.

**See also**: [`PERFORMANCE_OPTIMIZATIONS.md`](./PERFORMANCE_OPTIMIZATIONS.md) for full technical details.

---

## 🔒 Security & Error Handling

- **Request ID Middleware**: UUID attached to every request (`X-Request-ID` header)
- **Global exception handler**: Catches all unhandled errors, logs full traceback server-side, returns safe message to client
- **Rate limiting**: slowapi with per-IP limits (60/min global, 5/min analyze)
- **Structured error responses**: All errors return `{error, code, suggestion}` — never raw stack traces
- **CORS configured**: Configurable allowed origins via environment variable
- **File validation**: MIME type + extension + size checks on upload
- **Session isolation**: Each user's documents stored in separate ChromaDB collection
- **Unicode sanitization**: LLM outputs cleaned of problematic characters that render as black boxes
- **Frontend ErrorBoundary**: Catches React render crashes with reload button
- **SessionGuard**: Auto-detects expired sessions and resets state gracefully

---

## 📊 Design System

The frontend uses a custom dark theme with AMD branding:

| Token | Value | Usage |
|-------|-------|-------|
| `--ink` | `#080D1A` | Page background |
| `--paper` | `#F0F4FF` | Primary text |
| `--lead` | `#0D1528` | Card backgrounds |
| `--graphite` | `#111E35` | Secondary surfaces |
| `--rule` | `#1E2D4A` | Borders, dividers |
| `--ash` | `#8B9CC8` | Secondary text |
| `--ghost` | `#4A5878` | Muted text |
| `--volt` | `#3B7BF6` | Primary accent (blue) |
| `--amd-signal` | `#ED1C24` | AMD red / conflicts |
| `--cleared` | `#10B981` | Success / recommendations |
| `--caution` | `#F59E0B` | Warnings / risks |
| `--cyan` | `#00D4FF` | Evidence citations |

Typography: Inter (body), DM Sans (headings), JetBrains Mono (timestamps/code)

---

## 🧪 Testing Strategy

```bash
cd backend
pytest tests/ -v --tb=short
```

Test suite covers:
- Upload validation (valid PDF, invalid types, size limits)
- Session lifecycle (create, check valid/invalid)
- Full analysis pipeline (single doc, multi-doc with conflicts)
- Chat (basic question, history context, streaming, empty question rejection)
- Conflict detection (single doc = no conflicts, two docs = detects discrepancies)
- PDF/DOCX export (valid file bytes, invalid session handling)
- Benchmark endpoint (timing + chunk count)
- Demo endpoint (pre-loaded data integrity)

---

## 👥 Team — Clausify AI 🇵🇭

Built by **Rhenmart Dela Cruz** and team
AWS Cloud Club Lead · STI Global City · Taguig, Philippines

**Teammates:** Julie Ann Tiron · Mica Pauline Calingo · Reymark Panes

**AI Orchestration Stack:**
- Claude (planning & architecture)
- Kiro (implementation & code generation)
- Groq (dev/testing LLM — saves AMD credits)
- AMD Developer Cloud (production inference)

---

## 📄 License

MIT

---

*Clausify AI — AMD Developer Hackathon: ACT III*
*lablab.ai | July 2026*
