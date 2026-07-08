import json
import logging
import time
import uuid

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse
import asyncio

from models.response import (
    ChatRequest,
    ChatResponse,
    Evidence,
    StructuredAIResponse,
)
from prompts.chat_copilot import build_chat_prompt
from prompts.system_prompt import get_system_prompt
from services.embedding_service import EmbeddingService
from services.llm_service import LLMService, _strip_json_fences
from services.session_manager import SessionManager, SessionNotFoundError
from services.vector_store import VectorStore

logger = logging.getLogger(__name__)

router = APIRouter()

# Service instances (set from main.py at startup)
_embedding_service: EmbeddingService | None = None
_vector_store: VectorStore | None = None
_session_manager: SessionManager | None = None
_llm_service: LLMService | None = None


def _err(status: int, message: str, code: str, suggestion: str = ""):
    return JSONResponse(
        status_code=status,
        content={"error": message, "code": code, "suggestion": suggestion or None},
    )


@router.post("/chat")
async def chat(request: ChatRequest):
    """
    Answer a natural language question about the uploaded documents using hybrid RAG.

    Embeds the question, retrieves top-8 relevant chunks, supplements with full context
    if needed, then uses both document evidence and expert LLM knowledge to produce
    a structured, professional response with citations and recommendations.
    """
    embedding_service = _embedding_service
    vector_store = _vector_store
    session_manager = _session_manager
    llm_service = _llm_service

    session_id = request.sessionId
    question = request.question

    start_time = time.time()

    # --- Validate question ---
    if not question or not question.strip():
        return _err(400, "Question is required.", "EMPTY_MESSAGE", "Please type a question about your documents.")

    # --- Validate session ---
    try:
        session = session_manager.get_session(session_id)
    except SessionNotFoundError:
        return _err(404, "Session not found.", "SESSION_NOT_FOUND", "Please upload documents first to create a session.")

    # --- Embed question ---
    question_embedding = embedding_service.embed(question)

    # --- Retrieve top-12 relevant chunks for richer context ---
    chunks = vector_store.query_top_k(session_id, question_embedding, k=12)

    # --- If very few chunks retrieved, supplement with all session chunks ---
    # This ensures the LLM has enough context for questions spanning the whole document
    if len(chunks) < 4:
        all_chunks = vector_store.get_all_chunks(session_id)
        # Merge: keep top-k first, add remaining up to 16 total
        seen_ids = {c.id for c in chunks}
        for chunk in all_chunks:
            if chunk.id not in seen_ids and len(chunks) < 16:
                chunks.append(chunk)
                seen_ids.add(chunk.id)

    # --- Build and call LLM ---
    doc_names = [doc.filename for doc in session.documents]
    system_prompt = get_system_prompt(doc_names)
    # Convert history models to plain dicts for the prompt builder
    history_dicts = [{"role": m.role, "content": m.content} for m in request.history]
    user_prompt = build_chat_prompt(question, chunks, history=history_dicts)

    try:
        raw = await llm_service.complete(system_prompt, user_prompt, max_tokens=6144)
        raw = _strip_json_fences(raw)

        # Sanitize control characters that break JSON parsing
        import re
        raw = raw.replace('\r\n', '\\n').replace('\r', '\\n')
        # Remove control chars (except \n and \t which we'll escape)
        raw = raw.replace('\t', '\\t')
        # Remove other control characters (0x00-0x1F except already-escaped ones)
        raw = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', raw)

        # Try to parse JSON, with fallback extraction
        data = None
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            # Try extracting JSON from surrounding text
            brace_start = raw.find("{")
            brace_end = raw.rfind("}")
            if brace_start != -1 and brace_end > brace_start:
                try:
                    data = json.loads(raw[brace_start:brace_end + 1])
                except json.JSONDecodeError:
                    # Last resort: clean up and try again
                    cleaned = re.sub(r',\s*([}\]])', r'\1', raw[brace_start:brace_end + 1])
                    try:
                        data = json.loads(cleaned)
                    except json.JSONDecodeError:
                        pass

        # If JSON parsing totally failed, return the raw text as the answer
        if data is None:
            structured_response = StructuredAIResponse(
                answer=raw.strip(),
                evidence=[],
                risks="",
                recommendation="",
            )
        else:
            # Parse structured response from JSON
            evidence_list = []
            for ev in data.get("evidence", []):
                # Truncate quote to 200 chars max
                quote = ev.get("quote", "")[:200]
                evidence_list.append(
                    Evidence(
                        quote=quote,
                        sourceDocument=ev.get("sourceDocument", ""),
                        documentType=ev.get("documentType", "pdf"),
                    )
                )

            # Coerce risks to string — LLM sometimes returns a list or dict
            raw_risks = data.get("risks", "")
            if isinstance(raw_risks, list):
                risks_str = " ".join(
                    item if isinstance(item, str) else item.get("description", str(item))
                    for item in raw_risks
                )
            elif isinstance(raw_risks, dict):
                risks_str = raw_risks.get("description", str(raw_risks))
            else:
                risks_str = str(raw_risks) if raw_risks else ""

            # Coerce recommendation to string — same issue possible
            raw_rec = data.get("recommendation", "")
            if isinstance(raw_rec, dict):
                rec_str = raw_rec.get("summary", raw_rec.get("title", str(raw_rec)))
            elif isinstance(raw_rec, list):
                rec_str = " ".join(str(r) for r in raw_rec)
            else:
                rec_str = str(raw_rec) if raw_rec else ""

            structured_response = StructuredAIResponse(
                answer=data.get("answer", ""),
                evidence=evidence_list,
                risks=risks_str,
                recommendation=rec_str,
            )

    except Exception as e:
        logger.error(f"Chat LLM error for session {session_id}: {e}", exc_info=True)
        return _err(502, f"Chat service error: {type(e).__name__}: {str(e)[:120]}", "STREAM_FAILED", "The AI service encountered an error. Please try again.")

    elapsed_ms = int((time.time() - start_time) * 1000)

    response = ChatResponse(
        messageId=str(uuid.uuid4()),
        role="assistant",
        structuredResponse=structured_response,
        processingTimeMs=elapsed_ms,
    )
    return JSONResponse(
        content=response.model_dump(mode="json"),
        headers={"X-Processing-Time-Ms": str(elapsed_ms)},
    )


@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """
    Stream chat response as Server-Sent Events.
    Streams the answer token by token, then sends a final JSON event with
    evidence, risks, recommendation, and processingTimeMs.
    """
    embedding_service = _embedding_service
    vector_store = _vector_store
    session_manager = _session_manager
    llm_service = _llm_service

    session_id = request.sessionId
    question = request.question
    start_time = time.time()

    # --- Validate ---
    if not question or not question.strip():
        async def err_gen():
            yield f"data: {json.dumps({'type': 'error', 'code': 'EMPTY_MESSAGE', 'error': 'Question is required.', 'suggestion': 'Please type a question about your documents.'})}\n\n"
        return StreamingResponse(err_gen(), media_type="text/event-stream")

    try:
        session = session_manager.get_session(session_id)
    except SessionNotFoundError:
        async def err_gen():
            yield f"data: {json.dumps({'type': 'error', 'code': 'SESSION_NOT_FOUND', 'error': 'Session not found.', 'suggestion': 'Please upload documents first to create a session.'})}\n\n"
        return StreamingResponse(err_gen(), media_type="text/event-stream")

    # --- Retrieve chunks ---
    question_embedding = embedding_service.embed(question)
    chunks = vector_store.query_top_k(session_id, question_embedding, k=12)
    if len(chunks) < 4:
        all_chunks = vector_store.get_all_chunks(session_id)
        seen_ids = {c.id for c in chunks}
        for chunk in all_chunks:
            if chunk.id not in seen_ids and len(chunks) < 16:
                chunks.append(chunk)
                seen_ids.add(chunk.id)

    doc_names = [doc.filename for doc in session.documents]
    system_prompt = get_system_prompt(doc_names)
    history_dicts = [{"role": m.role, "content": m.content} for m in request.history]
    user_prompt = build_chat_prompt(question, chunks, history=history_dicts)

    async def generate():
        try:
            # Get full LLM response
            raw = await llm_service.complete(system_prompt, user_prompt, max_tokens=6144)
            raw = _strip_json_fences(raw)
            data = json.loads(raw)

            answer = data.get("answer", "")

            # Stream answer word by word
            words = answer.split(" ")
            for i, word in enumerate(words):
                chunk_text = word + (" " if i < len(words) - 1 else "")
                yield f"data: {json.dumps({'type': 'token', 'text': chunk_text})}\n\n"
                await asyncio.sleep(0.018)  # ~55 words/sec — feels natural

            # Build evidence list
            evidence_list = []
            for ev in data.get("evidence", []):
                quote = ev.get("quote", "")[:200]
                evidence_list.append({
                    "quote": quote,
                    "sourceDocument": ev.get("sourceDocument", ""),
                    "documentType": ev.get("documentType", "pdf"),
                })

            # Coerce risks
            raw_risks = data.get("risks", "")
            if isinstance(raw_risks, list):
                risks_str = " ".join(item if isinstance(item, str) else item.get("description", str(item)) for item in raw_risks)
            elif isinstance(raw_risks, dict):
                risks_str = raw_risks.get("description", str(raw_risks))
            else:
                risks_str = str(raw_risks) if raw_risks else ""

            # Coerce recommendation
            raw_rec = data.get("recommendation", "")
            if isinstance(raw_rec, dict):
                rec_str = raw_rec.get("summary", raw_rec.get("title", str(raw_rec)))
            elif isinstance(raw_rec, list):
                rec_str = " ".join(str(r) for r in raw_rec)
            else:
                rec_str = str(raw_rec) if raw_rec else ""

            elapsed_ms = int((time.time() - start_time) * 1000)
            message_id = str(uuid.uuid4())

            # Final event with full structured data
            final = {
                "type": "done",
                "messageId": message_id,
                "role": "assistant",
                "structuredResponse": {
                    "answer": answer,
                    "evidence": evidence_list,
                    "risks": risks_str,
                    "recommendation": rec_str,
                },
                "processingTimeMs": elapsed_ms,
            }
            yield f"data: {json.dumps(final)}\n\n"

        except Exception as e:
            logger.error(f"Stream error for session {session_id}: {e}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'code': 'STREAM_FAILED', 'error': str(e)[:120], 'suggestion': 'The AI service encountered an error. Please try again.'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
