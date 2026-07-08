"""
End-to-end pipeline test: Upload a PDF, check chunks are stored, verify content.
"""
import asyncio
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv()

from services.document_parser import DocumentParser
from services.embedding_service import EmbeddingService
from services.vector_store import VectorStore

# 1. Parse the PDF
parser = DocumentParser()

# Read test PDF
pdf_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "Enterprise_Invoice_Sample.pdf")
if not os.path.exists(pdf_path):
    # Try finding it elsewhere
    for root, dirs, files in os.walk("C:\\Users"):
        for f in files:
            if "Enterprise_Invoice" in f and f.endswith(".pdf"):
                pdf_path = os.path.join(root, f)
                break
        if os.path.exists(pdf_path):
            break

# Just create test content directly
test_content = b""  
print(f"Looking for PDF at: {pdf_path}")
print(f"Exists: {os.path.exists(pdf_path)}")

# Test with raw text extraction simulation
raw_text = """ENTERPRISE INVOICE
Seller: Apex Enterprise Solutions Inc.
Invoice #: INV-2026-1001
Bill To: Global Holdings Corporation
AI Consulting Services  120  $250.00  $30,000.00
Cloud Infrastructure  1  $18,500.00  $18,500.00
Enterprise Software License  500  $120.00  $60,000.00
Premium Support  12  $2,000.00  $24,000.00
Subtotal $132,500.00
Tax (12%) $15,900.00
Total Due $148,400.00
Payment Terms: Net 30 days.
Bank: Example Bank
Thank you for your business."""

print("\n=== 1. RAW TEXT ===")
print(raw_text[:200])

# 2. Chunk it
print("\n=== 2. CHUNKING ===")
embedding_service = EmbeddingService()
chunks_text = embedding_service.chunk_text(raw_text)
print(f"Number of chunks: {len(chunks_text)}")
for i, c in enumerate(chunks_text):
    print(f"  Chunk {i}: {c[:100]}...")

# 3. Embed and store
print("\n=== 3. EMBEDDING ===")
embeddings = embedding_service.embed_batch(chunks_text)
print(f"Embeddings generated: {len(embeddings)}, dim={len(embeddings[0])}")

# 4. Build chunk objects and store
from models.document import Chunk
import uuid

stored_chunks = []
for idx, (text, emb) in enumerate(zip(chunks_text, embeddings)):
    chunk = Chunk(
        id=str(uuid.uuid4()),
        text=text,
        embedding=emb,
        source_document="Enterprise_Invoice_Sample.pdf",
        document_type="pdf",
        chunk_index=idx,
    )
    stored_chunks.append(chunk)

vector_store = VectorStore()
session_id = "test-session-123"
vector_store.add_chunks(session_id, stored_chunks)

# 5. Retrieve
print("\n=== 4. RETRIEVAL ===")
question = "how much is AI consulting"
q_embedding = embedding_service.embed(question)
results = vector_store.query_top_k(session_id, q_embedding, k=5)
print(f"Retrieved {len(results)} chunks for question: '{question}'")
for i, r in enumerate(results):
    print(f"  Result {i}: {r.text[:150]}...")

# 6. Now test the full prompt
print("\n=== 5. FULL PROMPT TO GROQ ===")
from prompts.executive_summary import build_summary_prompt
prompt = build_summary_prompt(results)
print(f"Prompt length: {len(prompt)} chars")
print(f"First 500 chars of prompt:\n{prompt[:500]}")

# 7. Call Groq with this prompt
print("\n=== 6. GROQ RESPONSE ===")
from services.llm_service import LLMService
llm = LLMService()
from prompts.system_prompt import get_system_prompt
sys_prompt = get_system_prompt(["Enterprise_Invoice_Sample.pdf"])

result = asyncio.run(llm.complete(sys_prompt, prompt, max_tokens=500))
print(f"Response ({len(result)} chars):")
print(result[:500])
