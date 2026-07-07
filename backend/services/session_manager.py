import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from models.document import UploadedDocument
from models.response import AnalysisResult

logger = logging.getLogger(__name__)

# Directory where sessions are persisted between restarts
_PERSIST_DIR = os.getenv("SESSION_PERSIST_DIR", os.path.join(os.path.dirname(__file__), "..", "data", "sessions"))


class SessionNotFoundError(Exception):
    """Raised when a requested session does not exist."""
    pass


@dataclass
class SessionData:
    session_id: str
    documents: list[UploadedDocument]
    analysis: Optional[AnalysisResult]
    created_at: datetime = field(default_factory=datetime.utcnow)


class SessionManager:
    """
    Persistent session store backed by JSON files on disk.
    Sessions survive process restarts — files are written on create/update
    and loaded at startup from the persist directory.
    """

    def __init__(self):
        self.sessions: dict[str, SessionData] = {}
        os.makedirs(_PERSIST_DIR, exist_ok=True)
        self._load_from_disk()
        logger.info(f"SessionManager initialized — {len(self.sessions)} session(s) loaded from disk")

    # ── Disk persistence ────────────────────────────────────────────────────

    def _session_path(self, session_id: str) -> str:
        return os.path.join(_PERSIST_DIR, f"{session_id}.json")

    def _save_to_disk(self, session: SessionData) -> None:
        """Serialize a single session to JSON on disk."""
        try:
            data = {
                "session_id": session.session_id,
                "created_at": session.created_at.isoformat(),
                "documents": [
                    {
                        "id": doc.id,
                        "filename": doc.filename,
                        "fileType": doc.fileType,
                        "fileSize": doc.fileSize,
                        "uploadedAt": doc.uploadedAt.isoformat() if isinstance(doc.uploadedAt, datetime) else doc.uploadedAt,
                        "processingStatus": doc.processingStatus,
                    }
                    for doc in session.documents
                ],
                "analysis": session.analysis.model_dump() if session.analysis else None,
            }
            with open(self._session_path(session.session_id), "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, default=str)
            logger.debug(f"Session {session.session_id} persisted to disk")
        except Exception as e:
            logger.warning(f"Could not persist session {session.session_id} to disk: {e}")

    def _load_from_disk(self) -> None:
        """Load all sessions from disk at startup."""
        loaded = 0
        for fname in os.listdir(_PERSIST_DIR):
            if not fname.endswith(".json"):
                continue
            path = os.path.join(_PERSIST_DIR, fname)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)

                docs = [
                    UploadedDocument(
                        id=d["id"],
                        filename=d["filename"],
                        fileType=d.get("fileType", "pdf"),
                        fileSize=d.get("fileSize", 0),
                        uploadedAt=d.get("uploadedAt", datetime.utcnow().isoformat()),
                        processingStatus=d.get("processingStatus", "completed"),
                    )
                    for d in data.get("documents", [])
                ]

                analysis = None
                if data.get("analysis"):
                    try:
                        analysis = AnalysisResult.model_validate(data["analysis"])
                    except Exception as ae:
                        logger.warning(f"Could not restore analysis for {data['session_id']}: {ae}")

                session = SessionData(
                    session_id=data["session_id"],
                    documents=docs,
                    analysis=analysis,
                    created_at=datetime.fromisoformat(data.get("created_at", datetime.utcnow().isoformat())),
                )
                self.sessions[session.session_id] = session
                loaded += 1
            except Exception as e:
                logger.warning(f"Could not load session from {fname}: {e}")

        logger.info(f"Loaded {loaded} persisted session(s) from {_PERSIST_DIR}")

    # ── Public API ──────────────────────────────────────────────────────────

    def create_session(
        self,
        session_id: str,
        documents: list[UploadedDocument],
    ) -> SessionData:
        """
        Create a new session with the given documents.
        Persists to disk immediately.
        """
        session = SessionData(
            session_id=session_id,
            documents=documents,
            analysis=None,
            created_at=datetime.utcnow(),
        )
        self.sessions[session_id] = session
        self._save_to_disk(session)
        logger.info(f"Session {session_id} created with {len(documents)} document(s)")
        return session

    def get_session(self, session_id: str) -> SessionData:
        """
        Retrieve an existing session.

        Raises:
            SessionNotFoundError: If the session does not exist
        """
        session = self.sessions.get(session_id)
        if session is None:
            raise SessionNotFoundError(f"Session '{session_id}' not found")
        return session

    def store_analysis(
        self,
        session_id: str,
        analysis: AnalysisResult,
    ) -> None:
        """
        Attach a completed analysis result to an existing session.
        Persists to disk immediately.

        Raises:
            SessionNotFoundError: If the session does not exist
        """
        session = self.get_session(session_id)
        session.analysis = analysis
        self._save_to_disk(session)
        logger.info(f"Analysis stored for session {session_id}")

    def session_exists(self, session_id: str) -> bool:
        """Check whether a session with the given ID exists."""
        return session_id in self.sessions

    def cleanup_old_sessions(self, max_age_hours: int = 4) -> int:
        """Remove sessions older than max_age_hours. Returns count removed."""
        from datetime import timedelta
        now = datetime.utcnow()
        expired_ids = [
            sid for sid, session in self.sessions.items()
            if (now - session.created_at).total_seconds() > max_age_hours * 3600
        ]
        for sid in expired_ids:
            del self.sessions[sid]
            # Remove persisted JSON file
            persist_path = self._session_path(sid)
            if os.path.exists(persist_path):
                try:
                    os.unlink(persist_path)
                except Exception:
                    pass
            # Remove orphaned ChromaDB collection
            try:
                import chromadb
                from services.vector_store import _get_client
                chroma_client = _get_client()
                collection_name = f"session_{sid.replace('-', '_')}"
                chroma_client.delete_collection(name=collection_name)
                logger.info(f"[SESSION] Deleted ChromaDB collection for session {sid}")
            except Exception:
                pass  # Collection may not exist — non-fatal
            logger.info(f"[SESSION] Expired and removed session {sid}")
        if expired_ids:
            logger.info(f"[SESSION] Cleaned up {len(expired_ids)} expired session(s)")
        return len(expired_ids)
