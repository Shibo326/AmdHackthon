import asyncio, httpx, json

async def main():
    async with httpx.AsyncClient(timeout=120.0) as client:
        with open(r"C:\Users\rhenm\Downloads\Enterprise_Invoice_Sample.pdf", "rb") as f:
            files = {"files": ("Enterprise_Invoice_Sample.pdf", f, "application/pdf")}
            resp = await client.post("http://127.0.0.1:8001/api/upload", files=files)
        data = resp.json()
        sid = data["sessionId"]
        print(f"Upload: {resp.status_code} session={sid}")
        
        resp = await client.post("http://127.0.0.1:8001/api/analyze", json={"sessionId": sid})
        if resp.status_code == 200:
            a = resp.json()["analysis"]
            summary = a["executiveSummary"]
            questions = a.get("suggestedQuestions", [])
            risks = a["risks"]
            full = json.dumps(a)
            
            print(f"\nSummary: {summary[:250]}")
            print(f"\nQuestions: {questions}")
            print(f"\nRisks ({len(risks)}):")
            for r in risks[:3]:
                print(f"  [{r['level']}] {r['description'][:80]}...")
            
            print(f"\nREAL data: {'Apex' in full or '148,400' in full or 'Global Holdings' in full}")
            print(f"FAKE data: {'TechCorp' in full or 'Supplier_A' in full}")
        else:
            print(f"Analyze FAILED: {resp.status_code} {resp.text[:300]}")

asyncio.run(main())
