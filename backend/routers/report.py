import io
import logging
from datetime import datetime

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse

from models.response import ReportRequest
from services.pdf_generator import PDFGenerator
from services.session_manager import SessionManager, SessionNotFoundError

logger = logging.getLogger(__name__)

router = APIRouter()

# Service instances (set from main.py at startup)
_pdf_generator: PDFGenerator | None = None
_session_manager: SessionManager | None = None


def _err(status: int, message: str, code: str):
    return JSONResponse(
        status_code=status,
        content={"error": message, "code": code, "details": None},
    )


@router.post("/report")
async def generate_report(request: ReportRequest):
    """
    Generate and return a PDF report for a completed analysis session.

    Returns binary PDF with Content-Type: application/pdf and
    Content-Disposition: attachment; filename="clausify-report-YYYY-MM-DD.pdf".
    """
    pdf_generator = _pdf_generator
    session_manager = _session_manager

    # Guard against uninitialised services (startup failure)
    if not pdf_generator or not session_manager:
        return _err(503, "Service unavailable — backend is still starting up.", "SERVICE_UNAVAILABLE")

    session_id = request.sessionId

    # --- Validate session with completed analysis ---
    try:
        session = session_manager.get_session(session_id)
    except SessionNotFoundError:
        return _err(404, "Session not found.", "SESSION_NOT_FOUND")

    if session.analysis is None:
        return _err(404, "Session not found.", "SESSION_NOT_FOUND")

    # --- Generate PDF ---
    try:
        pdf_bytes = pdf_generator.generate_report(
            analysis=session.analysis,
            session_id=session_id,
        )
    except Exception as e:
        logger.error(f"PDF generation failed for session {session_id}: {e}")
        return _err(500, "Report generation failed.", "REPORT_FAILED")

    # --- Build response ---
    today = datetime.utcnow().strftime("%Y-%m-%d")
    filename = f"clausify-report-{today}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )
