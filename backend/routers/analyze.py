import logging
import os
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from models.response import AnalyzeRequest, AnalyzeResponse
from services.analysis_service import AnalysisService
from services.embedding_service import EmbeddingService
from services.llm_service import LLMParseError, LLMRateLimitError
from services.session_manager import SessionManager, SessionNotFoundError
from services.vector_store import VectorStore
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

logger = logging.getLogger(__name__)

router = APIRouter()

# Service instances (set from main.py at startup)
_analysis_service: AnalysisService | None = None
_session_manager: SessionManager | None = None
_vector_store: VectorStore | None = None
_embedding_service: EmbeddingService | None = None


def _err(status: int, message: str, code: str, suggestion: str = ""):
    return JSONResponse(
        status_code=status,
        content={"error": message, "code": code, "suggestion": suggestion or None},
    )


@router.post("/suggest-questions")
@limiter.limit("10/minute")
async def suggest_questions(request: Request, body: AnalyzeRequest):
    """
    Generate contextually-relevant quick questions based on the uploaded documents.
    Returns 6 short questions adapted to the document type and content.
    """
    session_manager = _session_manager
    vector_store = _vector_store
    analysis_service = _analysis_service

    session_id = body.sessionId

    # --- Validate session ---
    try:
        session = session_manager.get_session(session_id)
    except SessionNotFoundError:
        return _err(404, "Session not found.", "SESSION_NOT_FOUND", "Please upload documents first to create a session.")

    # --- Cache check: return cached questions if analysis already completed ---
    if session.analysis is not None and session.analysis.suggestedQuestions:
        logger.info(f"Returning cached questions for session {session_id}")
        return JSONResponse(content={"questions": session.analysis.suggestedQuestions})

    # --- Retrieve chunks ---
    chunks = vector_store.get_all_chunks(session_id)

    if not chunks:
        return JSONResponse(content={"questions": []})

    # --- Generate questions (uses the merged summary+questions call internally) ---
    try:
        from prompts.system_prompt import get_system_prompt
        doc_names = [c.source_document for c in chunks]
        doc_names = list(dict.fromkeys(doc_names))  # dedupe preserving order
        system_prompt = get_system_prompt(doc_names)
        _, questions = await analysis_service._generate_summary_and_questions(
            system_prompt, chunks
        )
    except Exception as e:
        logger.error(f"Question generation failed for session {session_id}: {e}")
        return JSONResponse(content={"questions": []})

    return JSONResponse(content={"questions": questions})


@router.post("/analyze")
@limiter.limit("5/minute")
async def analyze_documents(request: Request, body: AnalyzeRequest):
    """
    Run full AI analysis on all documents in a session.
    Rate limited: 5 per IP per minute to protect Groq quota.

    Returns executive summary, risks, comparison matrix, conflicts, and recommendation.
    """
    analysis_service = _analysis_service
    session_manager = _session_manager
    vector_store = _vector_store

    session_id = body.sessionId

    # --- Validate session ---
    try:
        session = session_manager.get_session(session_id)
    except SessionNotFoundError:
        return _err(404, "Session not found.", "SESSION_NOT_FOUND", "Please upload documents first to create a session.")

    # --- Cache check: return existing analysis instantly if available ---
    if session.analysis is not None:
        logger.info(f"Returning cached analysis for session {session_id} (0ms)")
        response = AnalyzeResponse(
            sessionId=session_id,
            status="completed",
            analysis=session.analysis,
        )
        return JSONResponse(content=response.model_dump(mode="json"))

    # --- Retrieve chunks ---
    chunks = vector_store.get_all_chunks(session_id)
    doc_names = [doc.filename for doc in session.documents]

    # --- Run analysis ---
    try:
        analysis = await analysis_service.run_full_analysis(
            session_id=session_id,
            chunks=chunks,
            doc_names=doc_names,
        )
    except LLMRateLimitError as e:
        logger.error(f"LLM rate limit hit for session {session_id}: {e}")
        return _err(429, "Analysis failed. API quota exceeded — please try again later or use a different API key.", "RATE_LIMIT_EXCEEDED", "Wait a minute and try again, or use a different API key.")
    except LLMParseError as e:
        logger.error(f"LLM parse error for session {session_id}: {e}")
        return _err(502, "Analysis failed. LLM service unavailable.", "ANALYSIS_FAILED", "The AI service is temporarily unavailable. Please try again shortly.")
    except Exception as e:
        # Also catch rate limit errors that may have been wrapped
        err_str = str(e).lower()
        if "rate_limit_exceeded" in err_str or "rate limit" in err_str or "429" in err_str:
            logger.error(f"LLM rate limit (wrapped) for session {session_id}: {e}")
            return _err(429, "Analysis failed. API quota exceeded — please try again later or use a different API key.", "RATE_LIMIT_EXCEEDED", "Wait a minute and try again, or use a different API key.")
        logger.error(f"Analysis failed for session {session_id}: {e}")
        return _err(502, "Analysis failed. LLM service unavailable.", "ANALYSIS_FAILED", "The AI service is temporarily unavailable. Please try again shortly.")

    response = AnalyzeResponse(
        sessionId=session_id,
        status="completed",
        analysis=analysis,
    )
    return JSONResponse(content=response.model_dump(mode="json"))


@router.post("/benchmark")
async def benchmark_embeddings():
    """Benchmarks embedding performance with 50 test chunks."""
    embedding_service = _embedding_service

    if embedding_service is None:
        return _err(503, "Embedding service not initialized.", "BENCHMARK_FAILED")

    test_chunks = [
        f"This is test clause number {i} for benchmarking embedding performance in the Clausify system."
        for i in range(50)
    ]

    start_time = time.time()
    try:
        embeddings = embedding_service.embed_batch(test_chunks)
        elapsed = time.time() - start_time
        return {
            "status": "success",
            "chunks_processed": len(test_chunks),
            "total_time_seconds": round(elapsed, 3),
            "avg_time_per_chunk_ms": round((elapsed / len(test_chunks)) * 1000, 2),
            "chunks_per_second": round(len(test_chunks) / elapsed, 1),
            "provider": "fireworks",
            "embedding_model": "all-MiniLM-L6-v2",
        }
    except Exception as e:
        elapsed = time.time() - start_time
        return _err(500, f"Benchmark failed: {str(e)[:120]}", "BENCHMARK_FAILED")
