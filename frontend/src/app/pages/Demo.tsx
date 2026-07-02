import { useEffect, useState } from "react";
import { NavigationBar, AMDBadge } from "../components/NavigationBar";
import { Card } from "../components/Card";
import { RiskBadge, EvidenceTag } from "../components/Badges";
import { PrimaryButton, GhostButton } from "../components/Buttons";
import { Link } from "react-router";
import {
  Target,
  FileText,
  AlertTriangle,
  Scale,
  Lightbulb,
  ArrowRight,
  Cpu,
  PanelLeft,
  X,
  Zap,
} from "lucide-react";
import { getDemoData } from "../../lib/api";
import type { Analysis, PreSeededMessage, UploadedDocument } from "../../lib/types";

// ── Hardcoded fallback data — used when backend is offline ──────────────────

const FALLBACK_DOCUMENTS: UploadedDocument[] = [
  { id: "d1", filename: "Supplier_A_Quotation.pdf", fileType: "pdf", fileSize: 245000, uploadedAt: new Date().toISOString(), processingStatus: "completed" },
  { id: "d2", filename: "Supplier_B_Quotation.pdf", fileType: "pdf", fileSize: 198000, uploadedAt: new Date().toISOString(), processingStatus: "completed" },
  { id: "d3", filename: "Existing_Contract_TechCorp.pdf", fileType: "pdf", fileSize: 512000, uploadedAt: new Date().toISOString(), processingStatus: "completed" },
  { id: "d4", filename: "Invoice_TechCorp_March2026.pdf", fileType: "pdf", fileSize: 87000, uploadedAt: new Date().toISOString(), processingStatus: "completed" },
  { id: "d5", filename: "Procurement_Policy.png", fileType: "image", fileSize: 340000, uploadedAt: new Date().toISOString(), processingStatus: "completed" },
];

const FALLBACK_ANALYSIS: Analysis = {
  analyzedAt: new Date().toISOString(),
  executiveSummary:
    "Analysis of 5 procurement documents reveals two competing supplier quotations for IT infrastructure equipment. Supplier B presents a more favorable financial profile at $42,800 vs Supplier A at $45,200, with more flexible 60-day payment terms. A critical price discrepancy has been detected between the existing TechCorp invoice ($48,500) and their current quotation — warranting clarification before any contract renewal.",
  risks: [
    { id: "r1", level: "HIGH" as const, description: "Price discrepancy: TechCorp invoice ($48,500) exceeds current quotation ($45,200) by $3,300 — 7.3% variance requiring explanation", sourceDocument: "Invoice_TechCorp_March2026.pdf", category: "Financial" },
    { id: "r2", level: "MEDIUM" as const, description: "Current TechCorp contract expires September 2026 — procurement must close within 90 days to avoid service gap", sourceDocument: "Existing_Contract_TechCorp.pdf", category: "Timeline" },
    { id: "r3", level: "LOW" as const, description: "Supplier A requires 30-day payment terms — more aggressive than company standard 60-day policy", sourceDocument: "Supplier_A_Quotation.pdf", category: "Financial" },
  ],
  comparisonMatrix: [
    { field: "Total Price", values: { "Supplier A": "$45,200", "Supplier B": "$42,800" }, winner: "Supplier B" },
    { field: "Payment Terms", values: { "Supplier A": "30 days", "Supplier B": "60 days" }, winner: "Supplier B" },
    { field: "Delivery Time", values: { "Supplier A": "14 days", "Supplier B": "21 days" }, winner: "Supplier A" },
    { field: "Warranty", values: { "Supplier A": "1 year", "Supplier B": "2 years" }, winner: "Supplier B" },
    { field: "Support SLA", values: { "Supplier A": "48 hours", "Supplier B": "24 hours" }, winner: "Supplier B" },
  ],
  conflicts: [
    {
      id: "c1",
      type: "PRICE DISCREPANCY",
      severity: "HIGH" as const,
      documentA: { name: "Invoice_TechCorp_March2026.pdf", excerpt: "Total amount due: $48,500.00" },
      documentB: { name: "Supplier_A_Quotation.pdf", excerpt: "Total quotation value: $45,200.00" },
      explanation: "TechCorp last invoice is $3,300 higher than their current quotation for equivalent equipment.",
      recommendedAction: "Request written clarification from TechCorp before any contract renewal.",
    },
  ],
  recommendation: {
    title: "Proceed with Supplier B",
    summary:
      "Supplier B offers lower cost ($42,800), better payment terms (60 days), extended warranty (2 years), and superior support SLA (24h). Clarify TechCorp invoice discrepancy regardless of final decision.",
    nextSteps: [
      "Initiate contract discussions with Supplier B",
      "Request price clarification from TechCorp",
      "Confirm delivery timeline meets operational requirements",
    ],
    confidence: 0.87,
  },
  suggestedQuestions: [
    "Which supplier offers better value overall?",
    "What are the payment term differences?",
    "Why is there a price conflict in the TechCorp documents?",
    "What deadlines should I be aware of?",
    "Which supplier has better support terms?",
    "What are the key risks in these documents?",
  ],
};

const FALLBACK_MESSAGES: PreSeededMessage[] = [
  {
    id: "m1",
    role: "user" as const,
    content: "Which supplier should I choose?",
    timestamp: new Date().toISOString(),
  },
  {
    id: "m2",
    role: "assistant" as const,
    content: "Based on the uploaded documents, Supplier B is the recommended choice.",
    timestamp: new Date().toISOString(),
    structuredResponse: {
      answer: "Supplier B is the recommended choice based on overall value, payment flexibility, and support terms.",
      evidence: [
        { quote: "Total quotation value: $42,800.00", sourceDocument: "Supplier_B_Quotation.pdf", documentType: "pdf" },
        { quote: "Payment terms: Net 60 days from invoice date", sourceDocument: "Supplier_B_Quotation.pdf", documentType: "pdf" },
        { quote: "Warranty period: 24 months from delivery", sourceDocument: "Supplier_B_Quotation.pdf", documentType: "pdf" },
      ],
      risks: "Supplier B delivery timeline is 21 days vs Supplier A at 14 days. Factor this in if urgency is critical.",
      recommendation: "Initiate contract discussions with Supplier B. Negotiate delivery timeline if 14-day delivery is operationally required.",
    },
  },
];

// AMD-branded loading screen
function DemoLoader() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#080D1A" }}>
      <NavigationBar showDemo={false} />
      <div className="flex-1 flex items-center justify-center px-4">
        <div
          className="flex flex-col items-center gap-6 animate-fadeIn"
          style={{
            background: "#0D1528",
            border: "1px solid rgba(59,123,246,0.25)",
            borderRadius: "16px",
            padding: "clamp(24px, 6vw, 48px) clamp(24px, 8vw, 64px)",
            maxWidth: "400px",
            width: "100%",
            boxShadow: "0 0 40px rgba(59,123,246,0.08)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Scan line effect */}
          <div className="scan-line" />

          {/* AMD logo area */}
          <div style={{ position: "relative" }}>
            <div style={{ width: "64px", height: "64px", borderRadius: "16px", background: "rgba(237,28,36,0.1)", border: "1px solid rgba(237,28,36,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Zap size={28} style={{ color: "#ED1C24" }} />
            </div>
            <div
              style={{
                position: "absolute",
                inset: "-6px",
                borderRadius: "20px",
                border: "2px solid rgba(237,28,36,0.3)",
                animation: "borderPulse 2s ease-in-out infinite",
              }}
            />
          </div>

          <div className="text-center">
            <div style={{ fontFamily: "DM Sans, sans-serif", fontSize: "18px", fontWeight: 600, color: "#F0F4FF", marginBottom: "6px" }}>
              Loading Demo
            </div>
            <div style={{ fontFamily: "Inter, sans-serif", fontSize: "13px", color: "#4A5878" }}>
              Initializing AMD MI300X inference…
            </div>
          </div>

          {/* Thinking dots */}
          <div className="flex items-center gap-3">
            <div className="animate-dot-1 w-2.5 h-2.5 rounded-full" style={{ background: "#3B7BF6" }} />
            <div className="animate-dot-2 w-2.5 h-2.5 rounded-full" style={{ background: "#3B7BF6" }} />
            <div className="animate-dot-3 w-2.5 h-2.5 rounded-full" style={{ background: "#3B7BF6" }} />
          </div>

          {/* Progress bar */}
          <div style={{ width: "100%", height: "3px", background: "#1E2D4A", borderRadius: "2px", overflow: "hidden" }}>
            <div className="shimmer-bar" style={{ height: "100%", borderRadius: "2px", width: "65%" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Demo() {
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [preSeededMessages, setPreSeededMessages] = useState<PreSeededMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    getDemoData()
      .then((data) => { setDocuments(data.documents); setAnalysis(data.analysis); setPreSeededMessages(data.preSeededMessages ?? []); })
      .catch(() => {
        // Backend offline — use hardcoded fallback so demo always works
        console.info("[Demo] Backend unavailable, using fallback data");
        setDocuments(FALLBACK_DOCUMENTS);
        setAnalysis(FALLBACK_ANALYSIS);
        setPreSeededMessages(FALLBACK_MESSAGES);
      })
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return <DemoLoader />;

  if (error || !analysis) {
    return (
      <div className="min-h-screen" style={{ background: "#080D1A" }}>
        <NavigationBar showDemo={false} />
        <div className="flex flex-col items-center pt-24 gap-4 px-4 animate-fadeIn">
          <div className="px-5 py-4 rounded-lg w-full" style={{ maxWidth: "480px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", fontFamily: "Inter, sans-serif", fontSize: "14px", color: "#EF4444" }}>
            {error ?? "Demo data unavailable."}
          </div>
          <Link to="/"><PrimaryButton>Upload your own documents</PrimaryButton></Link>
        </div>
      </div>
    );
  }

  const matrixColumns: string[] =
    analysis.comparisonMatrix?.[0] ? Object.keys(analysis.comparisonMatrix[0].values) : [];

  const hasConflicts = analysis.conflicts.length > 0;
  const primaryConflict = analysis.conflicts[0];

  const SidebarContent = () => (
    <>
      <div className="p-5 flex items-center justify-between">
        <span style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", fontWeight: 500, color: "#8B9CC8" }}>Demo Documents</span>
        <span className="px-2 py-0.5 rounded-full" style={{ background: "#1E2D4A", fontFamily: "Inter, sans-serif", fontSize: "12px", fontWeight: 500, color: "#F0F4FF" }}>
          {documents.length}
        </span>
      </div>

      <div>
        {documents.map((doc) => {
          const isImage = doc.fileType === "image";
          return (
            <div
              key={doc.id}
              className="px-4 py-3"
              style={{ borderBottom: "1px solid rgba(30,45,74,0.3)", borderLeft: "2px solid transparent", transition: "background 0.15s, border-left-color 0.15s", cursor: "default" }}
              onMouseOver={(e) => { e.currentTarget.style.background = "#111E35"; e.currentTarget.style.borderLeftColor = "#3B7BF6"; }}
              onMouseOut={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderLeftColor = "transparent"; }}
            >
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center rounded-md shrink-0" style={{ width: "24px", height: "24px", background: isImage ? "rgba(59,123,246,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${isImage ? "rgba(59,123,246,0.3)" : "rgba(239,68,68,0.3)"}` }}>
                  <span style={{ fontFamily: "Inter, sans-serif", fontSize: "9px", fontWeight: 600, color: isImage ? "#3B7BF6" : "#EF4444" }}>
                    {isImage ? "IMG" : "PDF"}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate" style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", fontWeight: 500, color: "#F0F4FF" }}>{doc.filename}</div>
                  <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#10B981" }}>
                    {isImage ? "Image · OCR Complete" : "Processed"}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ borderTop: "1px solid #1E2D4A", marginTop: "16px" }}>
        <div className="p-4 space-y-3">
          <Link to="/" style={{ display: "block" }}>
            <PrimaryButton style={{ width: "100%" }}>Upload Your Documents</PrimaryButton>
          </Link>
          <div className="flex justify-center pt-1"><AMDBadge /></div>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen animate-fadeIn" style={{ background: "#080D1A" }}>
      <NavigationBar showDemo={false} />

      {/* Demo Banner */}
      <div
        className="flex flex-wrap items-center justify-between px-4 sm:px-8 py-3 gap-3"
        style={{ background: "rgba(245,158,11,0.08)", borderBottom: "1px solid rgba(245,158,11,0.2)" }}
      >
        <div className="flex items-center gap-2">
          <Target size={15} style={{ color: "#F59E0B", flexShrink: 0 }} />
          <span style={{ fontFamily: "Inter, sans-serif", fontSize: "13px", fontWeight: 500, color: "#F59E0B" }}>
            Demo Mode — Pre-loaded sample procurement documents
          </span>
        </div>
        <Link to="/" style={{ fontFamily: "Inter, sans-serif", fontSize: "13px", fontWeight: 500, color: "#3B7BF6", textDecoration: "none", whiteSpace: "nowrap" }}>
          Try with your own →
        </Link>
      </div>

      <div className="flex relative">
        {/* Desktop sidebar */}
        <div
          className="hidden md:block shrink-0"
          style={{ width: "300px", minHeight: "calc(100vh - 120px)", background: "#0D1528", borderRight: "1px solid #1E2D4A" }}
        >
          <SidebarContent />
        </div>

        {/* Mobile sidebar drawer */}
        {sidebarOpen && (
          <div className="md:hidden fixed inset-0 z-50 animate-fadeIn" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setSidebarOpen(false)}>
            <div
              className="animate-slideDown"
              style={{ width: "min(300px, 85vw)", height: "100%", background: "#0D1528", borderRight: "1px solid #1E2D4A", overflowY: "auto" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: "1px solid #1E2D4A" }}>
                <span style={{ fontFamily: "DM Sans, sans-serif", fontSize: "15px", fontWeight: 600, color: "#F0F4FF" }}>Demo Documents</span>
                <button onClick={() => setSidebarOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#8B9CC8" }}>
                  <X size={18} />
                </button>
              </div>
              <SidebarContent />
            </div>
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Sub-header */}
          <div
            className="flex flex-wrap items-center justify-between px-4 sm:px-8 py-4 gap-3"
            style={{ borderBottom: "1px solid #1E2D4A" }}
          >
            <div className="flex items-center gap-3">
              {/* Mobile sidebar toggle */}
              <button
                className="md:hidden flex items-center justify-center"
                onClick={() => setSidebarOpen(true)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#8B9CC8", padding: "4px" }}
              >
                <PanelLeft size={18} />
              </button>
              <div>
                <h2 style={{ fontFamily: "DM Sans, sans-serif", fontSize: "clamp(16px, 3vw, 20px)", fontWeight: 600, color: "#F0F4FF" }}>
                  Sample Procurement Analysis
                </h2>
                <span style={{ fontFamily: "Inter, sans-serif", fontSize: "12px", fontWeight: 500, color: "#4A5878" }}>
                  {documents.length} documents · Demo data
                </span>
              </div>
            </div>
            <AMDBadge />
          </div>

          <div className="p-4 sm:p-6 md:p-8 space-y-5">
            {/* Conflict Alert */}
            {hasConflicts && primaryConflict && (
              <div className="rounded-lg p-4 animate-slideDown" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)", borderLeft: "4px solid #EF4444" }}>
                <div className="flex items-center gap-3 mb-4 flex-wrap">
                  <AlertTriangle size={20} style={{ color: "#EF4444", flexShrink: 0 }} />
                  <span style={{ fontFamily: "DM Sans, sans-serif", fontSize: "16px", fontWeight: 600, color: "#EF4444" }}>Conflict Detected</span>
                  <span style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", color: "#8B9CC8" }}>
                    {analysis.conflicts.length} critical conflict{analysis.conflicts.length !== 1 ? "s" : ""} found
                  </span>
                </div>

                <div style={{ paddingTop: "16px", borderTop: "1px solid rgba(239,68,68,0.15)" }}>
                  <div className="rounded-lg p-4" style={{ background: "rgba(239,68,68,0.04)" }}>
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <span style={{ fontFamily: "Inter, sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "#EF4444", textTransform: "uppercase" }}>
                        {primaryConflict.type}
                      </span>
                      <RiskBadge variant={primaryConflict.severity} />
                    </div>
                    <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                      {[primaryConflict.documentA, primaryConflict.documentB].map((doc, i) => (
                        <div key={i} className="rounded-lg p-3" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
                          <div className="mb-2"><EvidenceTag filename={doc.name} /></div>
                          <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "13px", color: "#F0F4FF" }}>"{doc.excerpt}"</div>
                        </div>
                      ))}
                    </div>
                    <p style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", lineHeight: 1.6, color: "#8B9CC8" }}>{primaryConflict.recommendedAction}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Analysis Cards */}
            <div className="grid gap-4 sm:gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
              {/* Executive Summary */}
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <h3 style={{ fontFamily: "DM Sans, sans-serif", fontSize: "18px", fontWeight: 600, color: "#F0F4FF" }}>Executive Summary</h3>
                  <FileText size={18} style={{ color: "#4A5878" }} />
                </div>
                <div style={{ height: "1px", background: "#1E2D4A", margin: "12px 0" }} />
                <p style={{ fontFamily: "Inter, sans-serif", fontSize: "15px", lineHeight: 1.6, color: "#8B9CC8", marginBottom: "16px" }}>
                  {analysis.executiveSummary}
                </p>
                <div style={{ borderTop: "1px solid #1E2D4A", paddingTop: "12px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                  <div className="flex items-center gap-1.5">
                    <Cpu size={12} style={{ color: "#4A5878" }} />
                    <span style={{ fontFamily: "Inter, sans-serif", fontSize: "12px", fontWeight: 500, color: "#4A5878" }}>Generated by AMD Llama 3.2 Vision</span>
                  </div>
                  <AMDBadge />
                </div>
              </Card>

              {/* Risk Analysis */}
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <h3 style={{ fontFamily: "DM Sans, sans-serif", fontSize: "18px", fontWeight: 600, color: "#F0F4FF" }}>Risk Analysis</h3>
                  <AlertTriangle size={18} style={{ color: "#4A5878" }} />
                </div>
                <div style={{ height: "1px", background: "#1E2D4A", margin: "12px 0" }} />
                <div className="space-y-3">
                  {analysis.risks.map((risk) => (
                    <div key={risk.id} className="flex gap-3">
                      <RiskBadge variant={risk.level} />
                      <div className="flex-1 min-w-0">
                        <p style={{ fontFamily: "Inter, sans-serif", fontSize: "15px", lineHeight: 1.6, color: "#F0F4FF", marginBottom: "4px" }}>{risk.description}</p>
                        <EvidenceTag filename={risk.sourceDocument} />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Comparison Matrix */}
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <h3 style={{ fontFamily: "DM Sans, sans-serif", fontSize: "18px", fontWeight: 600, color: "#F0F4FF" }}>Document Comparison</h3>
                  <Scale size={18} style={{ color: "#4A5878" }} />
                </div>
                <div style={{ height: "1px", background: "#1E2D4A", margin: "12px 0" }} />
                <div className="rounded-lg overflow-x-auto" style={{ border: "1px solid #1E2D4A" }}>
                  <table style={{ width: "100%", minWidth: "360px" }}>
                    <thead>
                      <tr style={{ background: "#111E35", height: "40px" }}>
                        <th className="px-4 text-left" style={{ fontFamily: "Inter, sans-serif", fontSize: "12px", fontWeight: 500, color: "#4A5878", whiteSpace: "nowrap" }}>Feature</th>
                        {matrixColumns.map((col) => (
                          <th key={col} className="px-4 text-left" style={{ fontFamily: "Inter, sans-serif", fontSize: "12px", fontWeight: 500, color: "#4A5878", whiteSpace: "nowrap" }}>{col}</th>
                        ))}
                        <th className="px-4 text-left" style={{ fontFamily: "Inter, sans-serif", fontSize: "12px", fontWeight: 500, color: "#4A5878", whiteSpace: "nowrap" }}>Winner</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.comparisonMatrix.map((row, idx) => (
                        <tr key={row.field} style={{ background: idx % 2 === 0 ? "#0D1528" : "rgba(17,30,53,0.5)", height: "48px", borderTop: "1px solid #1E2D4A" }}>
                          <td className="px-4" style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", color: "#F0F4FF", whiteSpace: "nowrap" }}>{row.field}</td>
                          {matrixColumns.map((col) => (
                            <td key={col} className="px-4" style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", color: "#F0F4FF" }}>{row.values[col] ?? "—"}</td>
                          ))}
                          <td className="px-4" style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", color: "#10B981", whiteSpace: "nowrap" }}>{row.winner}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* AI Recommendation */}
              <Card style={{ background: "rgba(59,123,246,0.04)", border: "1px solid rgba(59,123,246,0.15)" }}>
                <div className="flex items-center justify-between mb-3">
                  <h3 style={{ fontFamily: "DM Sans, sans-serif", fontSize: "18px", fontWeight: 600, color: "#F0F4FF" }}>AI Recommendation</h3>
                  <Lightbulb size={18} style={{ color: "#4A5878" }} />
                </div>
                <div style={{ height: "1px", background: "rgba(59,123,246,0.15)", margin: "12px 0" }} />
                <div className="inline-block px-4 py-2 rounded-full mb-4" style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)" }}>
                  <span style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", fontWeight: 500, color: "#10B981" }}>{analysis.recommendation.title}</span>
                </div>
                <p style={{ fontFamily: "Inter, sans-serif", fontSize: "15px", lineHeight: 1.6, color: "#8B9CC8" }}>{analysis.recommendation.summary}</p>
              </Card>
            </div>

            {/* Chat Preview + CTA */}
            <div className="rounded-xl p-5 sm:p-6" style={{ background: "#0D1528", border: "1px solid #1E2D4A" }}>
              <div className="flex items-center gap-3 mb-5">
                <div style={{ width: "36px", height: "36px", flexShrink: 0, clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)", background: "linear-gradient(135deg, #1E2D4A, #0D1528)", border: "2px solid #3B7BF6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontFamily: "DM Sans, sans-serif", fontSize: "11px", fontWeight: "bold", color: "#3B7BF6" }}>AI</span>
                </div>
                <div>
                  <h3 style={{ fontFamily: "DM Sans, sans-serif", fontSize: "18px", fontWeight: 600, color: "#F0F4FF" }}>Decision Copilot Preview</h3>
                  <p style={{ fontFamily: "Inter, sans-serif", fontSize: "13px", color: "#8B9CC8" }}>See how the AI answers questions</p>
                </div>
              </div>

              <div className="space-y-3 mb-5">
                {preSeededMessages.length > 0 ? (
                  preSeededMessages.map((msg) => {
                    const isUser = msg.role === "user";
                    const displayText = isUser
                      ? msg.content
                      : (msg.structuredResponse?.answer ?? msg.content);
                    return (
                      <div key={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                        <div
                          className="rounded-xl px-3 py-2"
                          style={
                            isUser
                              ? { background: "#1E2D4A", maxWidth: "min(400px, 90%)" }
                              : {
                                  background: "rgba(59,123,246,0.04)",
                                  border: "1px solid rgba(59,123,246,0.15)",
                                  borderLeft: "3px solid #3B7BF6",
                                  maxWidth: "min(500px, 100%)",
                                  padding: "12px",
                                }
                          }
                        >
                          <p style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", lineHeight: 1.6, color: "#F0F4FF" }}>
                            {displayText}
                          </p>
                          {!isUser && msg.structuredResponse?.evidence && msg.structuredResponse.evidence.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {msg.structuredResponse.evidence.map((ev, i) => (
                                <span
                                  key={i}
                                  style={{
                                    fontFamily: "Inter, sans-serif",
                                    fontSize: "11px",
                                    color: "#3B7BF6",
                                    background: "rgba(59,123,246,0.08)",
                                    border: "1px solid rgba(59,123,246,0.2)",
                                    borderRadius: "4px",
                                    padding: "2px 6px",
                                  }}
                                >
                                  {ev.sourceDocument}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <>
                    <div className="flex justify-end">
                      <div className="rounded-xl px-3 py-2" style={{ background: "#1E2D4A", maxWidth: "min(400px, 90%)" }}>
                        <p style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", color: "#F0F4FF" }}>Which supplier is cheapest?</p>
                      </div>
                    </div>
                    <div className="flex justify-start">
                      <div className="rounded-xl p-3" style={{ background: "rgba(59,123,246,0.04)", border: "1px solid rgba(59,123,246,0.15)", borderLeft: "3px solid #3B7BF6", maxWidth: "min(500px, 100%)" }}>
                        <p style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", lineHeight: 1.6, color: "#F0F4FF" }}>
                          {(() => {
                            const priceRow = analysis.comparisonMatrix.find((r) => r.field.toLowerCase().includes("price"));
                            if (!priceRow) return analysis.recommendation.summary;
                            return `${priceRow.winner} is the most competitive at ${priceRow.values[priceRow.winner]} total value.`;
                          })()}
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="rounded-lg p-4 sm:p-5" style={{ background: "rgba(59,123,246,0.06)", border: "1px solid rgba(59,123,246,0.15)" }}>
                <h4 style={{ fontFamily: "DM Sans, sans-serif", fontSize: "18px", fontWeight: 600, color: "#F0F4FF", marginBottom: "14px" }}>
                  Ready to analyze your own documents?
                </h4>
                <div className="flex flex-wrap gap-3">
                  <Link to="/"><PrimaryButton>Upload Documents</PrimaryButton></Link>
                  <Link to="/">
                    <GhostButton>
                      <div className="flex items-center gap-1.5">Try With Your Documents <ArrowRight size={14} /></div>
                    </GhostButton>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
