"""Quick test to verify Groq is working and adapts to non-procurement content."""
import asyncio
import sys
sys.path.insert(0, '.')
from dotenv import load_dotenv
load_dotenv()

from services.llm_service import LLMService

TEST_CONTENT = (
    "Chapter 3: Data Structures and Algorithms. "
    "Binary trees are hierarchical data structures where each node has at most two children. "
    "Time complexity of search in a balanced BST is O(log n). "
    "Key operations: insert, delete, search, traversal. "
    "Common traversal methods: in-order, pre-order, post-order."
)

async def main():
    svc = LLMService()
    print(f"Provider: {svc.provider.value}")
    print("Sending test request to Groq...")

    result = await svc.complete(
        system_prompt="You are a document analyst. Return only valid JSON.",
        user_prompt=(
            'Analyze this content:\n\n=== test_handout.pdf ===\n'
            + TEST_CONTENT
            + '\n\nReturn JSON: {"executiveSummary": "<your summary based only on this content>"}'
        ),
        max_tokens=300
    )
    print("Response:", result[:400])
    print("\n✅ Groq is working!" if "executiveSummary" in result or "{" in result else "\n  Unexpected response format")

asyncio.run(main())
