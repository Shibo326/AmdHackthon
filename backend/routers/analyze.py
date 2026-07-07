import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from models.response import AnalyzeRequest, AnalyzeResponse
from services.analysis_service import AnalysisService
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


def _err(status: int, message: str, code: str):
    return JSONResponse(
        status_code=status,
        content={"error": message, "code": code, "details": None},
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

    # Guard against uninitialised services (startup failure)
    if not session_manager or not vector_store or not analysis_service:
        return _err(503, "Service unavailable — backend is still starting up.", "SERVICE_UNAVAILABLE")

    session_id = body.sessionId

    # --- Validate session ---
    try:
        session_manager.get_session(session_id)
    except SessionNotFoundError:
        return _err(404, "Session not found.", "SESSION_NOT_FOUND")

    # --- Retrieve chunks ---
    chunks = vector_store.get_all_chunks(session_id)

    if not chunks:
        return JSONResponse(content={"questions": []})

    # --- Generate questions ---
    try:
        questions = await analysis_service._generate_suggested_questions(chunks)
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

    # Guard against uninitialised services (startup failure)
    if not analysis_service or not session_manager or not vector_store:
        return _err(503, "Service unavailable — backend is still starting up.", "SERVICE_UNAVAILABLE")

    session_id = body.sessionId

    # --- Validate session ---
    try:
        session = session_manager.get_session(session_id)
    except SessionNotFoundError:
        return _err(404, "Session not found.", "SESSION_NOT_FOUND")

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
        return _err(429, "Analysis failed. API quota exceeded — please try again later or use a different API key.", "RATE_LIMIT_EXCEEDED")
    except LLMParseError as e:
        logger.error(f"LLM parse error for session {session_id}: {e}")
        return _err(502, "Analysis failed. LLM service unavailable.", "ANALYSIS_FAILED")
    except Exception as e:
        # Also catch rate limit errors that may have been wrapped
        err_str = str(e).lower()
        if "rate_limit_exceeded" in err_str or "rate limit" in err_str or "429" in err_str:
            logger.error(f"LLM rate limit (wrapped) for session {session_id}: {e}")
            return _err(429, "Analysis failed. API quota exceeded — please try again later or use a different API key.", "RATE_LIMIT_EXCEEDED")
        logger.error(f"Analysis failed for session {session_id}: {e}")
        return _err(502, "Analysis failed. LLM service unavailable.", "ANALYSIS_FAILED")

    response = AnalyzeResponse(
        sessionId=session_id,
        status="completed",
        analysis=analysis,
    )
    return JSONResponse(content=response.model_dump(mode="json"))
