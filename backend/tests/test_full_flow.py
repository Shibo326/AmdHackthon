"""
Test the FULL API flow: upload → analyze → verify content is from REAL document.
This bypasses the frontend entirely.
"""
import asyncio
import httpx
import json
import os

API = "http://localhost:8000"
PDF_PATH = r"C:\Users\rhenm\Downloads\Enterprise_Invoice_Sample.pdf"

async def main():
    async with httpx.AsyncClient(timeout=120.0) as client:
        # Step 1: Upload
        print("=" * 60)
        print("STEP 1: Uploading Enterprise_Invoice_Sample.pdf...")
        print("=" * 60)
        
        with open(PDF_PATH, "rb") as f:
            files = {"files": ("Enterprise_Invoice_Sample.pdf", f, "application/pdf")}
            resp = await client.post(f"{API}/api/upload", files=files)
        
        print(f"Status: {resp.status_code}")
        upload_data = resp.json()
        session_id = upload_data["sessionId"]
        print(f"Session ID: {session_id}")
        print(f"Documents: {[d['filename'] for d in upload_data['documents']]}")
        print(f"Message: {upload_data['message']}")
        
        # Step 2: Analyze
        print("\n" + "=" * 60)
        print("STEP 2: Running analysis...")
        print("=" * 60)
        
        resp = await client.post(
            f"{API}/api/analyze",
            json={"sessionId": session_id},
        )
        print(f"Status: {resp.status_code}")
        
        if resp.status_code != 200:
            print(f"ERROR: {resp.text}")
            return
            
        analysis_data = resp.json()
        analysis = analysis_data["analysis"]
        
        print("\n--- EXECUTIVE SUMMARY ---")
        print(analysis["executiveSummary"][:500])
        
        print("\n--- RISKS ---")
        for risk in analysis["risks"][:3]:
            print(f"  [{risk['level']}] {risk['description'][:100]}...")
            print(f"    Source: {risk['sourceDocument']}")
        
        print("\n--- RECOMMENDATION ---")
        print(f"  Title: {analysis['recommendation']['title']}")
        print(f"  Summary: {analysis['recommendation']['summary'][:200]}...")
        
        # Step 3: Verify content matches uploaded file
        print("\n" + "=" * 60)
        print("VERIFICATION: Does the analysis reference the ACTUAL document?")
        print("=" * 60)
        
        full_text = json.dumps(analysis)
        
        # Check for REAL document content
        real_markers = ["Apex", "148,400", "Global Holdings", "INV-2026", "AI Consulting"]
        fake_markers = ["TechCorp", "Supplier_A", "Supplier_B", "$48,500", "$45,200"]
        
        print("\nREAL document markers found:")
        for marker in real_markers:
            found = marker in full_text
            print(f"  {'✅' if found else '❌'} '{marker}': {found}")
        
        print("\nFAKE/demo markers found:")
        for marker in fake_markers:
            found = marker in full_text
            print(f"  {'{'+'❌' if found else '✅'+'}' } '{marker}': {'FOUND - BAD!' if found else 'Not found - GOOD'}")
        
        # Step 4: Test chat
        print("\n" + "=" * 60)
        print("STEP 3: Chat - 'how much is AI consulting?'")
        print("=" * 60)
        
        resp = await client.post(
            f"{API}/api/chat",
            json={"sessionId": session_id, "question": "how much is the cost of AI consulting services?"},
        )
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            chat_data = resp.json()
            sr = chat_data["structuredResponse"]
            print(f"\nANSWER: {sr['answer'][:300]}")
            print(f"\nEVIDENCE:")
            for ev in sr["evidence"]:
                print(f"  - \"{ev['quote'][:100]}\" ({ev['sourceDocument']})")
        else:
            print(f"ERROR: {resp.text}")

asyncio.run(main())
