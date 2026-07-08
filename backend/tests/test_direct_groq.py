"""Direct test: Does Groq actually respond with content about our document?"""
import os
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

DOC_CONTENT = """ENTERPRISE INVOICE
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
Bank: Example Bank"""

response = client.chat.completions.create(
    model="llama-3.3-70b-versatile",
    messages=[
        {"role": "system", "content": "You are a document analyst. Analyze ONLY the document content provided."},
        {"role": "user", "content": f"Summarize this document in 2 sentences:\n\n{DOC_CONTENT}"},
    ],
    max_tokens=300,
    temperature=0.1,
)

print("=== GROQ RESPONSE ===")
print(response.choices[0].message.content)
print("=== END ===")
