# Clausify AI — AMD Developer Hackathon: ACT II

> Document intelligence platform powered by AMD Instinct MI300X via Fireworks AI. Upload contracts, quotations, and invoices — get evidence-based decisions in under 90 seconds.

**Live Demo:** https://amd-hackthon-ll14.vercel.app  
**Backend API:** https://amdhackthon-production.up.railway.app  
**Track:** Unicorn Track 🦄

---

## What It Does

Clausify analyzes multiple business documents simultaneously and:
- Detects **billing discrepancies** and price conflicts between documents
- Identifies **legal and financial risks** with severity ratings
- Generates a **comparison matrix** between documents
- Provides **AI-powered Q&A** (chat copilot) grounded in your documents with citations
- Exports full analysis as **PDF or DOCX**

---

## Architecture

```
Frontend (React/Vite) → Vercel
Backend (FastAPI/Python) → Railway
LLM inference → Fireworks AI (AMD MI300X hardware)
Embeddings → sentence-transformers (local CPU)
Vector store → ChromaDB (in-memory)
```

### AI Pipeline (5 parallel LLM calls)
1. **Executive Summary + Suggested Questions** — `deepseek-v4-flash` (quality tier)
2. **Risk Analysis** — `deepseek-v4-flash` (quality tier)
3. **Comparison Matrix** — `gpt-oss-120b` (fast tier, AMD MI300X optimized)
4. **Recommendation** — `deepseek-v4-flash` (quality tier)
5. **Conflict Detection** — `gpt-oss-120b` (fast tier)

All 5 calls run in parallel via `asyncio.gather`. Semaphore(3) prevents rate-limit cascades.

---

## Quick Start (Local Development)

### Prerequisites
- Python 3.11+
- Node.js 18+
- Fireworks AI API key (get one at https://app.fireworks.ai)

### Backend Setup

```bash
cd backend
cp .env.example .env
# Edit .env with your API key (see Environment Variables section below)
pip install -r requirements.txt
py main.py
# Backend runs on http://localhost:8000
```

### Frontend Setup

```bash
cd frontend
cp .env.example .env
# Edit .env — set VITE_API_URL=http://localhost:8000 for local dev
npm install
npm run dev
# Frontend runs on http://localhost:5173 or 5174
```

---

## Environment Variables

### Backend (`backend/.env`)

```env
# ── REQUIRED ──────────────────────────────────────────────────────────────────

# Fireworks AI API key — get yours at https://app.fireworks.ai/settings/api-keys
FIREWORKS_API_KEY=fw_your_key_here

# Fireworks AI endpoint (do not change)
FIREWORKS_ENDPOINT=https://api.fireworks.ai/inference/v1

# ── MODEL CONFIGURATION (tiered architecture) ─────────────────────────────────

# Quality model: used for Summary, Risks, Recommendation (complex reasoning)
FIREWORKS_MODEL_QUALITY=accounts/fireworks/models/deepseek-v4-flash

# Fast model: used for Comparison Matrix, Conflict Detection (structured extraction)
# gpt-oss-120b runs on AMD MI300X at 646 tokens/sec
FIREWORKS_MODEL_FAST=accounts/fireworks/models/gpt-oss-120b

# Legacy single-model fallback (used if QUALITY/FAST not set)
# FIREWORKS_MODEL=accounts/fireworks/models/gpt-oss-120b

# ── OPTIONAL ──────────────────────────────────────────────────────────────────

# CORS origins (comma-separated). Leave empty to allow all.
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,https://your-vercel-app.vercel.app

# Server port
PORT=8000

# Emergency fallback: combine ALL analysis into 1 LLM call (extreme speed, lower quality)
# Only use if analysis keeps timing out
SINGLE_CALL_MODE=false
```

### Frontend (`frontend/.env`)

```env
# Backend API URL
# For local dev:
VITE_API_URL=http://localhost:8000

# For production (point to your Railway deployment):
# VITE_API_URL=https://your-backend.up.railway.app
```

---

## Deployment

### Backend → Railway

1. Connect your GitHub repo to Railway
2. Select the `backend/` directory as root (or use root with `Dockerfile`)
3. Set these environment variables in Railway dashboard:

| Variable | Value |
|----------|-------|
| `FIREWORKS_API_KEY` | `fw_your_key_here` |
| `FIREWORKS_ENDPOINT` | `https://api.fireworks.ai/inference/v1` |
| `FIREWORKS_MODEL_QUALITY` | `accounts/fireworks/models/deepseek-v4-flash` |
| `FIREWORKS_MODEL_FAST` | `accounts/fireworks/models/gpt-oss-120b` |
| `FIREWORKS_MODEL` | `accounts/fireworks/models/deepseek-v4-flash` |
| `ALLOWED_ORIGINS` | `https://your-app.vercel.app,http://localhost:5173` |
| `SINGLE_CALL_MODE` | `false` |
| `PORT` | `8000` |

4. Railway auto-deploys on every push to `main`

### Frontend → Vercel

1. Connect your GitHub repo to Vercel
2. Set **Root Directory** to `frontend`
3. Set environment variable:
   - `VITE_API_URL` = `https://your-backend.up.railway.app`
4. Vercel auto-deploys on every push to `main`

> **Important:** After setting env vars in Vercel, always click **Redeploy** for changes to take effect. Vercel bakes `VITE_*` vars at build time.

---

## Key Technical Decisions

### Why Tiered Models?
Running 5 LLM calls simultaneously on a single large model caused rate-limit cascades (151s). Splitting into quality (`deepseek-v4-flash`) for reasoning tasks and fast (`gpt-oss-120b`) for structured extraction reduced analysis time to ~60s.

### Why `asyncio.Semaphore(3)`?
Limits concurrent Fireworks API calls to 3 at a time, preventing the 429 rate-limit errors that caused automatic retries (+6-12s each).

### Why `deepseek-v4-flash` over `deepseek-v4-pro`?
`deepseek-v4-pro` is a reasoning model that outputs `<think>` blocks before JSON, which caused JSON parse failures. `deepseek-v4-flash` outputs clean JSON directly, is ~5x faster, and produces equivalent quality for document analysis.

### JSON Parsing Robustness
All LLM outputs go through 5-strategy parsing:
1. Direct `json.loads`
2. Brace extraction (handles prose preamble before `{`)
3. Trailing comma cleanup
4. Regex array extraction
5. LLM retry with explicit JSON-only instruction

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/upload` | Upload documents (PDF/PNG/JPEG/DOCX) |
| `POST` | `/api/analyze` | Run full AI analysis |
| `POST` | `/api/chat` | Ask questions about documents |
| `POST` | `/api/chat/stream` | Streaming chat (SSE) |
| `POST` | `/api/report` | Export analysis as PDF or DOCX |
| `GET` | `/api/warmup` | Wake Railway from cold start |
| `GET` | `/api/session/{id}/check` | Check if session exists |
| `POST` | `/api/session/new` | Create empty session |
| `POST` | `/api/benchmark` | AMD MI300X embedding benchmark |
| `GET` | `/health` | Health check with model info |

---

## Sample Documents

The `sample_documents/` folder contains demo files with intentional conflicts:
- `Demo_PurchaseOrder_GlobalDynamics.pdf` — Client PO at agreed pricing
- `Demo_VendorConfirmation_TechCorp.pdf` — Vendor confirmation with inflated prices

Known conflicts: $13,144.95 billing discrepancy, Net30 vs Net60 payment terms, volume discount removal, delivery location mismatch.

---

## Troubleshooting

**"Analysis failed" immediately**
→ Wrong model ID in Railway. Check `FIREWORKS_MODEL` has no spaces or `=` sign in the value.

**"Connection error" on frontend**
→ `VITE_API_URL` not set correctly in Vercel. Must be exactly `https://your-backend.up.railway.app` (no trailing slash). Redeploy after changing.

**0 risks / empty comparison matrix**
→ `max_tokens` too low or model truncating output. Current values: risks=3000, matrix=1500.

**Analysis taking 140s+**
→ Model is a reasoning model outputting `<think>` blocks. Switch to `deepseek-v4-flash` instead of `deepseek-v4-pro`.

**Chat showing raw JSON**
→ JSON parse issue. Check Railway logs for `[chat] JSON parse failed` messages.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Framer Motion |
| Backend | FastAPI, Python 3.11, uvicorn |
| AI inference | Fireworks AI (AMD Instinct MI300X) |
| LLM models | deepseek-v4-flash (quality), gpt-oss-120b (fast) |
| Embeddings | sentence-transformers all-MiniLM-L6-v2 |
| Vector DB | ChromaDB (in-memory) |
| PDF parsing | PyMuPDF, pytesseract |
| PDF export | reportlab |
| DOCX export | python-docx |
| Hosting | Railway (backend), Vercel (frontend) |
