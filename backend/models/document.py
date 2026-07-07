from enum import Enum
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict


class ProcessingStatus(str, Enum):
    UPLOADING = "uploading"
    UPLOADED = "uploaded"
    EXTRACTING_TEXT = "extracting_text"
    RUNNING_OCR = "running_ocr"
    GENERATING_EMBEDDINGS = "generating_embeddings"
    INDEXING = "indexing"
    COMPLETED = "completed"
    FAILED = "failed"


class UploadedDocument(BaseModel):
    model_config = ConfigDict(json_encoders={datetime: lambda v: v.isoformat()})

    id: str
    filename: str
    fileType: Literal["pdf", "image", "document"]
    fileSize: int
    uploadedAt: datetime
    processingStatus: ProcessingStatus


class Chunk(BaseModel):
    id: str
    text: str
    embedding: list[float]
    source_document: str
    document_type: Literal["pdf", "image", "document"]
    chunk_index: int
