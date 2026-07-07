# Clausify AI — Enterprise Document Intelligence

> **AMD Developer Hackathon: ACT II**  
> AI-powered document analysis and decision copilot for enterprise procurement — built on AMD Instinct MI300X

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Python](https://img.shields.io/badge/python-3.11-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green)
![React](https://img.shields.io/badge/React-19-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

---

## 📌 What is Clausify AI?

Clausify AI transforms enterprise document review from a 3-4 hour manual process into a **60-second AI-powered analysis**. Upload contracts, invoices, quotations, and supplier documents — get instant executive summaries, categorized risks, cross-document conflict detection, and evidence-backed recommendations.

**Core Capabilities:**
- **Executive Summarization** — Distill 100+ page documents into decision-ready summaries
- **Risk Identification** — Categorize risks by severity (Financial, Legal, Compliance, Operational)
- **Conflict Detection Engine** — Automated pairwise comparison surfaces contradictions across documents
- **RAG-Powered Chat Copilot** — Ask natural language questions, get answers with cited evidence
- **PDF Report Export** — One-click AMD-branded PDF reports for stakeholder review

---

## 🎯 Tech Stack

### Backend (Python 3.11)
- **FastAPI** — Modern async API framework
- **Groq** (default) / **Claude** / **AMD Developer Cloud** — Multi-provider LLM abstraction
- **ChromaDB** — Vector store for semantic document search
- **sentence-transformers** (all-MiniLM-L6-v2) — 384-dim embeddings
- **PyMuPDF + pytesseract** — PDF text extraction + OCR fallback
- **ReportLab** — PDF report generation

### Frontend (React 19 + TypeScript)
- **Vite** — Fast build tool and dev server
- **React Router v7** — Client-side routing
- **Tailwind CSS** — Utility-first styling
- **Lucide React** — Icon library
- **Sonner** — Toast notifications

### Infrastructure
- **ChromaDB (on-disk)** — Persistent vector storage
- **JSON file sessions** — Disk-persisted session state
- **Rate limiting** (SlowAPI) — 5 req/min for analysis, 10 req/min for questions

---

## 🚀 Quick Start

### Prerequisites
- **Python 3.11+** (with pip)
- **Node.js 18+** (with npm)
- **Groq API Key** (free tier: https://console.groq.com) OR Claude API key

### 1. Clone the Repository
```bash
git clone https://github.com/reymarkjpanes/AmdHackthon.git
cd AmdHackthon
```

### 2. Backend Setup

```bash
cd backend

# Install Python dependencies
pip install -r requirements.txt

# Create .env file from example
cp .env.example .env

# Edit .env — add your Groq API key:
# LLM_PROVIDER=GROQ
# GROQ_API_KEY=your_key_here

# Start the backend server
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

**First startup takes ~25 seconds** (downloads sentence-transformer model once).

Expected output:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     All services initialized — Clausify AI is ready!
```

### 3. Frontend Setup

Open a **new terminal**:

```bash
cd frontend

# Install Node dependencies
npm install

# Start the Vite dev server
npm run dev
```

Expected output:
```
VITE v6.0.0  ready in 500 ms
➜  Local:   http://localhost:5173/
```

### 4. Open the App

Navigate to **http://localhost:5173** in your browser.

**To test:**
1. Upload 1-3 PDF/PNG/JPEG/JFIF documents (contracts, invoices, quotations)
2. Click "Analyze X Document(s)" — analysis completes in ~30-60 seconds
3. View executive summary, risks, conflicts, comparison matrix, and recommendation
4. Click "Chat" to ask questions about your documents

---

## 🗂️ Project Structure

```
AmdHackthon/
├── backend/                  # FastAPI Python backend
│   ├── main.py              # App entry point, startup injection
│   ├── routers/             # API endpoints (upload, analyze, chat, report, demo)
│   ├── services/            # Business logic (LLM, embeddings, vector store, session manager)
│   ├── models/              # Pydantic models (request/response contracts)
│   ├── prompts/             # LLM prompt templates (system, chat, analysis)
│   ├── tests/               # Pytest suite + fixtures
│   ├── data/                # Persistent storage (ChromaDB, session JSON files)
│   ├── requirements.txt     # Python dependencies
│   └── .env                 # Environment variables (GROQ_API_KEY, etc.)
│
├── frontend/                # React 19 + Vite frontend
│   ├── src/
│   │   ├── app/            # Pages (Landing, Dashboard, Chat, Demo)
│   │   ├── lib/            # API client, store, types
│   │   └── styles/         # Global CSS
│   ├── vite.config.ts      # Vite config (includes proxy to backend)
│   ├── package.json        # Node dependencies
│   └── .env                # Frontend env vars (VITE_API_URL)
│
└── README.md               # This file
```

---

## 🔧 Configuration

### Backend Environment Variables (`.env` in `backend/`)

```bash
# LLM Provider (choose one)
LLM_PROVIDER=GROQ              # GROQ, CLAUDE, or AMD

# Groq API (free tier — 30 req/min)
GROQ_API_KEY=your_key_here
GROQ_MODEL=llama-3.3-70b-versatile

# Claude API (optional)
ANTHROPIC_API_KEY=your_key_here

# AMD Developer Cloud (optional — future integration)
AMD_CLOUD_API_KEY=your_key_here
AMD_CLOUD_ENDPOINT=https://api.amd-developer-cloud.com/v1

# CORS origins (comma-separated)
ALLOWED_ORIGINS=http://localhost:5173

# Server port
PORT=8000
```

**⚠️ Never commit `.env` files to git — they contain secrets.**

### Frontend Environment Variables (`.env` in `frontend/`)

```bash
# API base URL (leave blank for local dev — uses Vite proxy)
VITE_API_URL=

# For production deployment, set to your backend URL at build time:
# VITE_API_URL=https://api.yourapp.com
```

---

## 📡 API Endpoints

| Endpoint | Method | Description | Rate Limit |
|---|---|---|---|
| `/health` | GET | Health check | None |
| `/api/upload` | POST | Upload documents (multipart) | 60/min |
| `/api/analyze` | POST | Run full AI analysis | **5/min** |
| `/api/suggest-questions` | POST | Generate quick questions | 10/min |
| `/api/chat` | POST | Chat copilot (JSON response) | 60/min |
| `/api/chat/stream` | POST | Chat copilot (SSE stream) | 60/min |
| `/api/report` | POST | Export PDF report | 60/min |
| `/api/demo` | GET | Static demo data | None |
| `/api/session/:id/check` | GET | Validate session exists | None |

**Full API docs:** http://localhost:8000/docs (Swagger UI)

---

## 🧪 Testing

### Backend Tests

```bash
cd backend
pytest

# Run with coverage
pytest --cov=. --cov-report=html

# Run specific test file
pytest tests/test_upload.py -v
```

**Test structure:**
- `tests/conftest.py` — Fixtures and mocks
- `tests/test_*.py` — Unit and integration tests for each service/router

---

## 🎨 Frontend Development

### Available Scripts

```bash
npm run dev          # Start Vite dev server (port 5173)
npm run build        # Production build
npm run preview      # Preview production build
npm run lint         # Run ESLint
npm run type-check   # TypeScript type checking
```

### Vite Proxy Configuration

The Vite dev server proxies `/api/*` requests to `http://localhost:8000` automatically (configured in `vite.config.ts`). This eliminates CORS issues during development.

---

## 🐛 Troubleshooting

### Backend won't start

**Symptom:** `ModuleNotFoundError: No module named 'fastapi'`

**Fix:**
```bash
cd backend
pip install -r requirements.txt
```

---

### "Upload failed" in the browser

**Symptom:** Frontend shows "Cannot reach the server" error

**Fix:** Make sure the backend is running:
```bash
cd backend
python -m uvicorn main:app --port 8000
```

Verify at http://localhost:8000/health — should return `{"status":"ok"}`

---

### LLM API errors (429 rate limit)

**Symptom:** Analysis fails with "API quota exceeded"

**Cause:** Groq free tier is 30 requests/min. Analysis makes 6 parallel LLM calls.

**Fix:**
1. Wait 60 seconds and retry
2. Use a different API key
3. Switch to Claude (`LLM_PROVIDER=CLAUDE` in `.env`)

---

### ChromaDB warnings/errors

**Symptom:** `Failed to send telemetry event`

**Fix:** Ignore — this is a non-fatal warning. ChromaDB telemetry fails silently but doesn't affect functionality.

---

### Session expired errors

**Symptom:** "Session not found" after browser refresh

**Cause:** Sessions expire after 4 hours (configurable in `session_manager.py`)

**Fix:** Re-upload your documents to create a new session.

---

## 📊 Performance Notes

- **First startup:** ~25 seconds (downloads sentence-transformer model)
- **Subsequent startups:** ~5 seconds (loads model from disk)
- **Document upload:** ~2-5 seconds per document (depends on size, OCR needs)
- **Analysis:** ~30-60 seconds (6 parallel LLM calls + conflict detection)
- **Chat response:** ~2-5 seconds (single LLM call with RAG)

**Embedding model:** all-MiniLM-L6-v2 (384-dim, CPU inference)  
**On AMD Instinct MI300X:** 5.6× faster embedding generation (benchmark planned)

---

## 🔐 Security Notes

1. **No authentication** — This is a hackathon demo. In production, add JWT auth.
2. **API keys in `.env`** — Never commit `.env` to git. Use CI/CD secrets for deployment.
3. **CORS** — Configured for `localhost:5173`. Update `ALLOWED_ORIGINS` for production.
4. **Rate limiting** — Protects Groq free tier. Increase limits if using paid tiers.
5. **Session cleanup** — Runs on every upload. Old sessions (4+ hours) are auto-deleted.

---

## 🚢 Deployment

### Backend (Python)

**Recommended:** Deploy to Railway, Render, or Fly.io

**Environment variables to set:**
- `GROQ_API_KEY` (or `ANTHROPIC_API_KEY`)
- `LLM_PROVIDER=GROQ`
- `ALLOWED_ORIGINS=https://your-frontend-domain.com`
- `PORT=8000`

**Procfile** (for Heroku/Railway):
```
web: uvicorn main:app --host 0.0.0.0 --port $PORT
```

---

### Frontend (React + Vite)

**Recommended:** Deploy to Vercel or Netlify

**Build command:**
```bash
npm run build
```

**Output directory:** `dist/`

**Environment variables to set at build time:**
```bash
VITE_API_URL=https://your-backend.railway.app
```

---

## 🏆 AMD Hackathon Notes

This project was built for the **AMD Developer Hackathon: ACT II** (July 2026).

**AMD Integration:**
- Embedding generation optimized for AMD Instinct MI300X (ROCm-powered)
- LLM inference routing supports AMD Developer Cloud (Llama 3.2 Vision 11B)
- PDF reports branded with AMD MI300X badge

**Benchmarks (planned):**
- CPU vs. MI300X embedding throughput comparison
- Publish actual speedup numbers before final submission

---

## 📝 License

MIT License — see LICENSE file for details.

---

## 🙌 Acknowledgments

- **AMD Instinct MI300X** — Accelerated AI inference platform
- **Groq** — Fast LLM inference (Llama 3.3 70B)
- **Anthropic Claude** — Alternative LLM provider
- **ChromaDB** — Open-source vector database
- **sentence-transformers** — State-of-the-art embeddings

---

## 📬 Contact

**Developer:** Reymark Panes  
**Repository:** https://github.com/reymarkjpanes/AmdHackthon  
**Hackathon:** AMD Developer Hackathon: ACT II

---

**Built with ❤️ for enterprise document intelligence.**
