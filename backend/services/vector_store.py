import logging
import os

from models.document import Chunk

logger = logging.getLogger(__name__)

# Fixed persistent directory for ChromaDB — survives process restarts
_DEFAULT_CHROMA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "chroma")
_CHROMA_DIR = os.getenv("CHROMA_PERSIST_DIR", _DEFAULT_CHROMA_DIR)

_shared_client = None


def _get_client():
    global _shared_client
    if _shared_client is None:
        import chromadb
        os.makedirs(_CHROMA_DIR, exist_ok=True)
        _shared_client = chromadb.PersistentClient(path=_CHROMA_DIR)
        logger.info(f"ChromaDB PersistentClient initialized at {_CHROMA_DIR}")
    return _shared_client


def reset_client():
    """Reset the shared client (used in tests to get a fresh isolated client)."""
    global _shared_client
    _shared_client = None


class VectorStore:
    """
    ChromaDB-backed persistent vector store.
    Each session gets its own isolated collection.
    Data is persisted to disk and survives process restarts.
    """

    def __init__(self):
        self.client = _get_client()
        logger.debug("VectorStore initialized (using shared ChromaDB client)")

    def _collection_name(self, session_id: str) -> str:
        """Generate a safe ChromaDB collection name from session_id."""
        return f"session_{session_id.replace('-', '_')}"

    def create_collection(self, session_id: str):
        """Create or retrieve a ChromaDB collection for the given session."""
        name = self._collection_name(session_id)
        collection = self.client.get_or_create_collection(
            name=name,
            metadata={"session_id": session_id},
        )
        logger.debug(f"Collection '{name}' ready for session {session_id}")
        return collection

    def add_chunks(self, session_id: str, chunks: list[Chunk]) -> None:
        """Store text chunks and their embeddings in the session collection."""
        if not chunks:
            return

        collection = self.create_collection(session_id)

        ids = [chunk.id for chunk in chunks]
        embeddings = [chunk.embedding for chunk in chunks]
        documents = [chunk.text for chunk in chunks]
        metadatas = [
            {
                "source_document": chunk.source_document,
                "document_type": chunk.document_type,
                "chunk_index": chunk.chunk_index,
            }
            for chunk in chunks
        ]

        collection.add(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas,
        )
        logger.debug(f"Added {len(chunks)} chunks to session {session_id}")

    def query_top_k(
        self,
        session_id: str,
        embedding: list[float],
        k: int = 5,
    ) -> list[Chunk]:
        """Return the k most semantically similar chunks to the given embedding."""
        collection = self.create_collection(session_id)

        count = collection.count()
        if count == 0:
            return []

        actual_k = min(k, count)

        results = collection.query(
            query_embeddings=[embedding],
            n_results=actual_k,
            include=["documents", "metadatas", "embeddings", "distances"],
        )

        chunks = []
        if not results["ids"] or not results["ids"][0]:
            return chunks

        distances = results.get("distances", [[]])[0] if results.get("distances") else []

        for i, chunk_id in enumerate(results["ids"][0]):
            text = results["documents"][0][i]
            metadata = results["metadatas"][0][i]
            embedding_vec = (
                results["embeddings"][0][i]
                if results["embeddings"]
                else []
            )
            # Store distance in metadata for relevance filtering downstream
            distance = distances[i] if i < len(distances) else None

            chunk = Chunk(
                id=chunk_id,
                text=text,
                embedding=list(embedding_vec) if embedding_vec is not None else [],
                source_document=metadata.get("source_document", ""),
                document_type=metadata.get("document_type", "pdf"),
                chunk_index=int(metadata.get("chunk_index", 0)),
                distance=distance,
            )
            chunks.append(chunk)

        return chunks

    def get_all_chunks(self, session_id: str) -> list[Chunk]:
        """Retrieve all chunks stored for a session."""
        collection = self.create_collection(session_id)
        count = collection.count()

        if count == 0:
            return []

        results = collection.get(
            include=["documents", "metadatas", "embeddings"],
            limit=count,
        )

        chunks = []
        if not results["ids"]:
            return chunks

        for i, chunk_id in enumerate(results["ids"]):
            text = results["documents"][i]
            metadata = results["metadatas"][i]
            embeddings_data = results.get("embeddings")
            if embeddings_data is not None and len(embeddings_data) > i and embeddings_data[i] is not None:
                embedding_vec = embeddings_data[i]
            else:
                embedding_vec = []

            chunk = Chunk(
                id=chunk_id,
                text=text,
                embedding=list(embedding_vec) if len(embedding_vec) > 0 else [],
                source_document=metadata.get("source_document", ""),
                document_type=metadata.get("document_type", "pdf"),
                chunk_index=int(metadata.get("chunk_index", 0)),
            )
            chunks.append(chunk)

        return chunks

    def collection_exists(self, session_id: str) -> bool:
        """Check whether a collection exists for the given session."""
        try:
            name = self._collection_name(session_id)
            collection = self.client.get_collection(name=name)
            return collection.count() > 0
        except Exception:
            return False
