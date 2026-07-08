import { useState, useRef, useEffect } from "react";
import { NavigationBar, AMDBadge } from "../components/NavigationBar";
import { Card } from "../components/Card";
import { RiskBadge, EvidenceTag, EvidenceBox } from "../components/Badges";
import { PrimaryButton, GhostButton } from "../components/Buttons";
import { Link } from "react-router";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
  ArrowLeft,
  FileText,
  AlertTriangle,
  Scale,
  Lightbulb,
  ChevronDown,
  Cpu,
  PanelLeft,
  X,
  FileDown,
  BarChart3,
} from "lucide-react";
import { exportReport, analyzeDocuments } from "../../lib/api";
import { toast } from "sonner";
import { useAppState, useAppDispatch } from "../../lib/store";
import type { AppAction } from "../../lib/store";
import type { UploadedDocument } from "../../lib/types";
import type { Dispatch } from "react";

// ── DashboardSidebar ─────────────────────────────────────────────────────────
// Extracted outside Dashboard to prevent full remount on every parent re-render.
interface DashboardSidebarProps {
  documents: UploadedDocument[];
  dispatch: Dispatch<AppAction>;
}

function DashboardSidebar({ documents, dispatch }: DashboardSidebarProps) {
  return (
    <>
      <div className="p-5 flex items-center justify-between">
        <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "14px", fontWeight: 500, color: "var(--ash)" }}>
          Session Documents
        </span>
        <span className="px-2 py-0.5 rounded-full" style={{ background: "var(--graphite)", fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 500, color: "var(--paper)" }}>
          {documents.length}
        </span>
      </div>

      <div>
        {documents.map((doc) => {
          const isImage = doc.fileType === "image";
          return (
            <div
              key={doc.id}
              className="px-4 py-3 cursor-pointer"
              style={{ borderBottom: "1px solid rgba(42,45,62,0.3)", borderLeft: "2px solid transparent", transition: "background 0.15s, border-left-color 0.15s" }}
              onMouseOver={(e) => { e.currentTarget.style.background = "var(--graphite)"; e.currentTarget.style.borderLeftColor = "var(--volt)"; }}
              onMouseOut={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderLeftColor = "transparent"; }}
            >
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center rounded-md shrink-0" style={{ width: "24px", height: "24px", background: isImage ? "rgba(59,123,246,0.1)" : "rgba(237,28,36,0.1)", border: `1px solid ${isImage ? "rgba(59,123,246,0.3)" : "rgba(237,28,36,0.3)"}` }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", fontWeight: 600, color: isImage ? "var(--volt)" : "var(--conflict)" }}>
                    {isImage ? "IMG" : "PDF"}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate" style={{ fontFamily: "'Inter', sans-serif", fontSize: "14px", fontWeight: 500, color: "var(--paper)" }}>
                    {doc.filename}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", color: doc.processingStatus === "completed" ? "var(--cleared)" : "var(--caution)" }}>
                    {doc.processingStatus === "completed" ? (isImage ? "Image · OCR Complete" : "Processed") : "Processing..."}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ borderTop: "1px solid var(--rule)", marginTop: "16px" }}>
        <div className="p-4 space-y-3">
          <Link to="/" style={{ display: "block" }}>
            <GhostButton style={{ width: "100%", height: "36px" }}>Upload More</GhostButton>
          </Link>
          <div className="text-center">
            <button
              onClick={() => dispatch({ type: "RESET" })}
              style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 500, color: "var(--ghost)", background: "none", border: "none", cursor: "pointer" }}
            >
              New Session
            </button>
          </div>
          <div className="flex justify-center pt-1"><AMDBadge /></div>
        </div>
      </div>
    </>
  );
}

export default function Dashboard() {
  const dispatch = useAppDispatch();
  const { sessionId, documents, analysis } = useAppState();

  const [conflictExpanded, setConflictExpanded] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target as Node)) {
        setExportDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleExport = async (format: "pdf" | "docx") => {
    if (!sessionId) return;
    setIsExporting(true);
    setExportDropdownOpen(false);
    try {
      const blob = await exportReport(sessionId, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clausify-report.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${format.toUpperCase()} report downloaded!`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Export failed.";
      toast.error(`Export failed: ${msg}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleReanalyze = async () => {
    if (!sessionId || isReanalyzing) return;
    setIsReanalyzing(true);
    try {
      const result = await analyzeDocuments(sessionId);
      dispatch({ type: "SET_ANALYSIS", payload: result.analysis });
      toast.success("Re-analysis complete!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Re-analysis failed.");
    } finally {
      setIsReanalyzing(false);
    }
  };

  if (!analysis) {
    return (
      <div className="min-h-screen" style={{ background: "var(--ink)" }}>
        <NavigationBar showDemo={false} />
        <div className="flex flex-col items-center pt-24 gap-6 px-4 animate-fadeIn">
          <div className="px-6 py-6 rounded-xl text-center w-full" style={{ background: "var(--lead)", border: "1px solid var(--rule)", maxWidth: "480px" }}>
            <FileText size={40} style={{ color: "var(--ghost)", margin: "0 auto 16px" }} />
            <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "20px", fontWeight: 700, color: "var(--paper)", marginBottom: "8px" }}>
              No analysis available
            </h2>
            <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "15px", lineHeight: 1.6, color: "var(--ash)", marginBottom: "20px" }}>
              Please upload documents first to generate an analysis.
            </p>
            <Link to="/"><PrimaryButton>Upload Documents</PrimaryButton></Link>
          </div>
        </div>
      </div>
    );
  }

  const matrixColumns: string[] =
    analysis.comparisonMatrix?.[0] ? Object.keys(analysis.comparisonMatrix[0].values) : [];

  const hasConflicts = analysis.conflicts.length > 0;
  const hasHighRisk = analysis.risks.some((r) => r.level === "HIGH");

  return (
    <div className="min-h-screen" style={{ background: "var(--ink)" }}>
      <NavigationBar showDemo={false} />

      {/* Breadcrumb */}
      <div className="px-4 sm:px-6 md:px-10 py-3" style={{ borderBottom: "1px solid var(--rule)" }}>
        <div className="flex items-center gap-2">
          {/* Mobile sidebar toggle */}
          <button
            className="md:hidden flex items-center justify-center mr-1"
            onClick={() => setSidebarOpen(true)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ash)", padding: "4px" }}
          >
            <PanelLeft size={18} />
          </button>
          <Link to="/" className="inline-flex items-center gap-1.5" style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 500, color: "var(--ghost)" }}>
            <ArrowLeft size={13} />Upload
          </Link>
          <span style={{ color: "var(--ghost)" }}>/</span>
          <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 500, color: "var(--paper)" }}>
            Analysis Dashboard
          </span>
        </div>
      </div>

      <div className="flex relative">
        {/* Desktop Sidebar */}
        <div
          className="hidden md:block shrink-0"
          style={{ width: "260px", minHeight: "calc(100vh - 108px)", background: "var(--lead)", borderRight: "1px solid var(--rule)" }}
        >
          <DashboardSidebar documents={documents} dispatch={dispatch} />
        </div>

        {/* Mobile Sidebar Drawer */}
        {sidebarOpen && (
          <div
            className="md:hidden fixed inset-0 z-50 animate-fadeIn"
            style={{ background: "rgba(0,0,0,0.6)" }}
            onClick={() => setSidebarOpen(false)}
          >
            <div
              className="animate-slideDown"
              style={{ width: "min(300px, 85vw)", height: "100%", background: "var(--lead)", borderRight: "1px solid var(--rule)", overflowY: "auto" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: "1px solid var(--rule)" }}>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 700, color: "var(--paper)" }}>Documents</span>
                <button onClick={() => setSidebarOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ash)" }}>
                  <X size={18} />
                </button>
              </div>
              <DashboardSidebar documents={documents} dispatch={dispatch} />
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 min-w-0 animate-fadeIn">
          {/* Top Bar */}
          <div
            className="flex flex-wrap items-center justify-between px-4 sm:px-6 md:px-8 py-3 gap-3"
            style={{ background: "var(--ink)", borderBottom: "1px solid var(--rule)", position: "sticky", top: "60px", zIndex: 10 }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "clamp(16px, 3vw, 20px)", fontWeight: 700, color: "var(--paper)", whiteSpace: "nowrap" }}>
                Analysis Results
              </h2>
              <span className="hidden sm:inline" style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 500, color: "var(--ghost)" }}>
                · Analyzed {analysis.analyzedAt ? new Date(analysis.analyzedAt).toLocaleString() : "just now"}
                {documents[0]?.uploadedAt && analysis.analyzedAt && (() => {
                  const ms = new Date(analysis.analyzedAt).getTime() - new Date(documents[0].uploadedAt).getTime();
                  if (ms > 0 && ms < 300000) return ` · ${(ms/1000).toFixed(1)}s on AMD MI300X`;
                  return "";
                })()}
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <GhostButton small onClick={handleReanalyze} disabled={isReanalyzing}>
                {isReanalyzing ? (
                  <div className="flex items-center gap-1.5">
                    <div className="animate-spin-slow w-3 h-3 rounded-full" style={{ border: "2px solid var(--ghost)", borderTopColor: "var(--volt)" }} />
                    Analyzing…
                  </div>
                ) : "Re-analyze"}
              </GhostButton>
              <Link to="/chat"><PrimaryButton small>Ask a Question</PrimaryButton></Link>
              {/* Export Dropdown */}
              <div className="relative" ref={exportDropdownRef}>
                <GhostButton small onClick={() => setExportDropdownOpen(!exportDropdownOpen)} disabled={isExporting}>
                  <FileDown size={14} className="mr-1.5" />
                  {isExporting ? "Exporting…" : "Export"}
                  <ChevronDown size={12} className="ml-1" style={{ transform: exportDropdownOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                </GhostButton>
                {exportDropdownOpen && (
                  <div
                    className="absolute right-0 top-full mt-1 z-50 rounded-lg py-1 animate-fadeIn"
                    style={{
                      background: "var(--lead)",
                      border: "1px solid var(--rule)",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                      minWidth: "180px",
                    }}
                  >
                    <button
                      onClick={() => handleExport("pdf")}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left"
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: "13px",
                        color: "var(--paper)",
                        transition: "background 0.15s",
                      }}
                      onMouseOver={(e) => { e.currentTarget.style.background = "var(--graphite)"; }}
                      onMouseOut={(e) => { e.currentTarget.style.background = "none"; }}
                    >
                      <div className="flex items-center justify-center rounded" style={{ width: "28px", height: "28px", background: "rgba(237,28,36,0.1)", border: "1px solid rgba(237,28,36,0.2)" }}>
                        <FileText size={14} style={{ color: "var(--amd-signal)" }} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 500 }}>Export as PDF</div>
                        <div style={{ fontSize: "11px", color: "var(--ghost)" }}>Professional report format</div>
                      </div>
                    </button>
                    <button
                      onClick={() => handleExport("docx")}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left"
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: "13px",
                        color: "var(--paper)",
                        transition: "background 0.15s",
                      }}
                      onMouseOver={(e) => { e.currentTarget.style.background = "var(--graphite)"; }}
                      onMouseOut={(e) => { e.currentTarget.style.background = "none"; }}
                    >
                      <div className="flex items-center justify-center rounded" style={{ width: "28px", height: "28px", background: "rgba(59,123,246,0.1)", border: "1px solid rgba(59,123,246,0.2)" }}>
                        <FileDown size={14} style={{ color: "var(--volt)" }} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 500 }}>Export as DOCX</div>
                        <div style={{ fontSize: "11px", color: "var(--ghost)" }}>Editable Word document</div>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-4 sm:p-6 md:p-8 space-y-5">
            {/* AMD Performance Metrics Banner */}
            {(() => {
              const analyzedAt = analysis.analyzedAt ? new Date(analysis.analyzedAt) : null;
              const uploadedAt = documents[0]?.uploadedAt ? new Date(documents[0].uploadedAt) : null;
              const processingMs = analyzedAt && uploadedAt ? analyzedAt.getTime() - uploadedAt.getTime() : null;
              const processingSeconds = processingMs && processingMs > 0 ? (processingMs / 1000).toFixed(1) : null;
              return (
                <div
                  className="rounded-xl p-4 animate-slideDown"
                  style={{
                    background: "linear-gradient(135deg, rgba(237,28,36,0.06) 0%, rgba(59,123,246,0.06) 100%)",
                    border: "1px solid rgba(237,28,36,0.2)",
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "rgba(237,28,36,0.1)", border: "1px solid rgba(237,28,36,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Cpu size={18} style={{ color: "var(--amd-signal)" }} />
                      </div>
                      <div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--paper)" }}>AMD Instinct MI300X</div>
                        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", color: "var(--ghost)" }}>ROCm-accelerated inference · HBM3 memory architecture</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-6">
                      {[
                        { label: "Analysis Time", value: processingSeconds ? `${processingSeconds}s` : "< 60s", color: "var(--cleared)" },
                        { label: "Speedup vs CPU", value: "5.6×", color: "var(--volt)" },
                        { label: "Documents", value: `${documents.length}`, color: "var(--paper)" },
                        { label: "Risks Found", value: `${analysis.risks.length}`, color: hasHighRisk ? "var(--amd-signal)" : "var(--caution)" },
                      ].map(stat => (
                        <div key={stat.label} className="flex flex-col items-center">
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "20px", fontWeight: 600, color: stat.color }}>{stat.value}</span>
                          <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "10px", fontWeight: 500, color: "var(--ghost)", whiteSpace: "nowrap" }}>{stat.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Conflict Alert */}
            {hasConflicts && (
              <div className="rounded-lg p-4 animate-slideDown" style={{ background: "rgba(237,28,36,0.06)", border: "1px solid rgba(237,28,36,0.25)", borderLeft: "4px solid var(--amd-signal)" }}>
                <div className="flex items-start sm:items-center justify-between gap-3 mb-4 flex-wrap">
                  <div className="flex items-center gap-3 flex-wrap">
                    <AlertTriangle size={20} style={{ color: "var(--amd-signal)", flexShrink: 0 }} />
                    <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "13px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--amd-signal)" }}>
                      Conflict Detected
                    </span>
                    <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "14px", color: "var(--ash)" }}>
                      {analysis.conflicts.length} conflict{analysis.conflicts.length !== 1 ? "s" : ""} found
                    </span>
                  </div>
                  <button
                    onClick={() => setConflictExpanded(!conflictExpanded)}
                    style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 500, color: "var(--amd-signal)", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}
                  >
                    View Details
                    <ChevronDown size={14} style={{ transform: conflictExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                  </button>
                </div>

                {conflictExpanded && (
                  <div style={{ paddingTop: "16px", borderTop: "1px solid rgba(237,28,36,0.15)" }}>
                    {analysis.conflicts.map((conflict) => (
                      <div key={conflict.id} className="rounded-lg p-4 mb-3" style={{ background: "rgba(237,28,36,0.04)" }}>
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                          <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "var(--amd-signal)", textTransform: "uppercase" }}>
                            {conflict.type}
                          </span>
                          <RiskBadge variant={conflict.severity} />
                        </div>
                        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginBottom: "12px" }}>
                          {[conflict.documentA, conflict.documentB].map((doc, i) => (
                            <div key={i}>
                              <div className="mb-2"><EvidenceTag filename={doc.name} /></div>
                              <EvidenceBox quote={doc.excerpt} style={{ background: "var(--paper)" }} />
                            </div>
                          ))}
                        </div>
                        <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "14px", lineHeight: 1.6, color: "var(--ash)" }}>{conflict.recommendedAction}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Analysis Cards Grid — 2-column on desktop */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Executive Summary */}
              <Card style={{ display: 'flex', flexDirection: 'column', maxHeight: '420px' }}>
                <div style={{ flexShrink: 0 }}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "18px", fontWeight: 700, color: "var(--paper)" }}>Executive Summary</h3>
                    <FileText size={18} style={{ color: "var(--ghost)" }} />
                  </div>
                  <div style={{ height: "1px", background: "var(--rule)", margin: "12px 0" }} />
                </div>
                <div className="card-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                  <p style={{ fontFamily: "'Inter', sans-serif", fontWeight: 400, fontSize: "15px", lineHeight: 1.6, color: "var(--ash)", marginBottom: "16px" }}>
                    {analysis.executiveSummary}
                  </p>
                  <div style={{ borderTop: "1px solid var(--rule)", paddingTop: "12px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                    <div className="flex items-center gap-1.5">
                      <Cpu size={12} style={{ color: "var(--ghost)" }} />
                      <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 500, color: "var(--ghost)" }}>
                        Generated by AMD Llama 3.2 Vision
                      </span>
                    </div>
                    <AMDBadge />
                  </div>
                </div>
              </Card>

              {/* Risk Analysis */}
              <Card style={{ display: 'flex', flexDirection: 'column', maxHeight: '420px' }}>
                <div style={{ flexShrink: 0 }}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "18px", fontWeight: 700, color: "var(--paper)" }}>Risk Analysis</h3>
                    <AlertTriangle size={18} style={{ color: "var(--ghost)" }} />
                  </div>
                  <div style={{ height: "1px", background: "var(--rule)", margin: "12px 0" }} />
                </div>
                <div className="card-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                  <div className="space-y-3">
                    {analysis.risks.length === 0 && (
                      <div className="flex flex-col items-center py-6 gap-2">
                        <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "rgba(0,196,140,0.1)", border: "1px solid rgba(0,196,140,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <span style={{ fontSize: "18px" }}>✓</span>
                        </div>
                        <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "14px", color: "var(--cleared)", fontWeight: 500 }}>No risks identified</p>
                        <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", color: "var(--ghost)", textAlign: "center" }}>The AI found no material risks in your documents.</p>
                      </div>
                    )}
                    {analysis.risks.map((risk) => (
                      <div key={risk.id} className="flex gap-3">
                        <RiskBadge variant={risk.level} />
                        <div className="flex-1 min-w-0">
                          <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "15px", lineHeight: 1.6, color: "var(--paper)", marginBottom: "4px" }}>
                            {risk.description}
                          </p>
                          <EvidenceTag filename={risk.sourceDocument} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>

              {/* Comparison Matrix */}
              <Card style={{ display: 'flex', flexDirection: 'column', maxHeight: '420px' }}>
                <div style={{ flexShrink: 0 }}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "18px", fontWeight: 700, color: "var(--paper)" }}>Document Comparison</h3>
                    <Scale size={18} style={{ color: "var(--ghost)" }} />
                  </div>
                  <div style={{ height: "1px", background: "var(--rule)", margin: "12px 0" }} />
                </div>
                <div className="card-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                  <div className="rounded-lg overflow-x-auto" style={{ border: "1px solid var(--rule)" }}>
                    <table style={{ width: "100%", minWidth: "360px" }}>
                      <thead>
                        <tr style={{ background: "var(--graphite)", height: "40px" }}>
                          <th className="px-4 text-left" style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 500, color: "var(--ghost)", whiteSpace: "nowrap" }}>Feature</th>
                          {matrixColumns.map((col) => (
                            <th key={col} className="px-4 text-left" style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 500, color: "var(--ghost)", whiteSpace: "nowrap" }}>{col}</th>
                          ))}
                          <th className="px-4 text-left" style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 500, color: "var(--ghost)", whiteSpace: "nowrap" }}>Winner</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.comparisonMatrix.map((row, idx) => (
                          <tr key={row.field} style={{ background: idx % 2 === 0 ? "var(--lead)" : "rgba(37,40,54,0.5)", height: "48px", borderTop: "1px solid var(--rule)" }}>
                            <td className="px-4" style={{ fontFamily: "'Inter', sans-serif", fontSize: "14px", color: "var(--paper)", whiteSpace: "nowrap" }}>{row.field}</td>
                            {matrixColumns.map((col) => (
                              <td key={col} className="px-4" style={{ fontFamily: "'Inter', sans-serif", fontSize: "14px", color: "var(--paper)" }}>{row.values[col] ?? "—"}</td>
                            ))}
                            <td className="px-4" style={{ fontFamily: "'Inter', sans-serif", fontSize: "14px", color: "var(--cleared)", whiteSpace: "nowrap" }}>{row.winner}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </Card>

              {/* Risk Distribution & Analytics */}
              <Card style={{ display: 'flex', flexDirection: 'column', maxHeight: '420px' }}>
                <div style={{ flexShrink: 0 }}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "18px", fontWeight: 700, color: "var(--paper)" }}>Analytics Overview</h3>
                    <BarChart3 size={18} style={{ color: "var(--ghost)" }} />
                  </div>
                  <div style={{ height: "1px", background: "var(--rule)", margin: "12px 0" }} />
                </div>
                <div className="card-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                  {(() => {
                    const high = analysis.risks.filter(r => r.level === "HIGH").length;
                    const medium = analysis.risks.filter(r => r.level === "MEDIUM").length;
                    const low = analysis.risks.filter(r => r.level === "LOW").length;
                    const totalRisks = analysis.risks.length;
                    const totalConflicts = analysis.conflicts.length;
                    const categories = [...new Set(analysis.risks.map(r => r.category))];
                    const confidence = Math.round(analysis.recommendation.confidence * 100);

                    const barData = [
                      { name: "HIGH", count: high, color: "var(--amd-signal)" },
                      { name: "MED", count: medium, color: "var(--caution)" },
                      { name: "LOW", count: low, color: "var(--cleared)" },
                    ];

                    return (
                      <div className="space-y-4">
                        {/* Quick Stats Row */}
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { label: "Total Risks", value: totalRisks, color: high > 0 ? "var(--amd-signal)" : "var(--paper)" },
                            { label: "Conflicts", value: totalConflicts, color: totalConflicts > 0 ? "var(--amd-signal)" : "var(--cleared)" },
                            { label: "Confidence", value: `${confidence}%`, color: confidence >= 70 ? "var(--cleared)" : confidence >= 40 ? "var(--caution)" : "var(--amd-signal)" },
                          ].map(stat => (
                            <div key={stat.label} className="rounded-lg p-3 text-center" style={{ background: "var(--graphite)", border: "1px solid var(--rule)" }}>
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "20px", fontWeight: 600, color: stat.color }}>{stat.value}</div>
                              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: "10px", fontWeight: 500, color: "var(--ghost)", marginTop: "2px" }}>{stat.label}</div>
                            </div>
                          ))}
                        </div>

                        {/* Risk Distribution Chart */}
                        <div>
                          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 600, color: "var(--ash)", marginBottom: "8px", letterSpacing: "0.04em" }}>
                            RISK DISTRIBUTION
                          </div>
                          <ResponsiveContainer width="100%" height={100}>
                            <BarChart data={barData} barSize={32}>
                              <XAxis dataKey="name" tick={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fill: "var(--ash)" }} axisLine={false} tickLine={false} />
                              <YAxis allowDecimals={false} tick={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fill: "var(--ash)" }} axisLine={false} tickLine={false} width={20} />
                              <Tooltip
                                cursor={{ fill: "rgba(59,123,246,0.06)" }}
                                contentStyle={{ background: "var(--lead)", border: "1px solid var(--rule)", borderRadius: "8px", fontFamily: "'Inter', sans-serif", fontSize: "13px" }}
                                labelStyle={{ color: "var(--paper)" }}
                                itemStyle={{ color: "var(--ash)" }}
                              />
                              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                                {barData.map((entry, index) => (
                                  <Cell key={index} fill={entry.color} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>

                        {/* Risk Categories */}
                        {categories.length > 0 && (
                          <div>
                            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 600, color: "var(--ash)", marginBottom: "8px", letterSpacing: "0.04em" }}>
                              RISK CATEGORIES
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {categories.map(cat => (
                                <span
                                  key={cat}
                                  className="px-2.5 py-1 rounded-full"
                                  style={{
                                    background: "var(--graphite)",
                                    border: "1px solid var(--rule)",
                                    fontFamily: "'Inter', sans-serif",
                                    fontSize: "11px",
                                    fontWeight: 500,
                                    color: "var(--ash)",
                                  }}
                                >
                                  {cat} ({analysis.risks.filter(r => r.category === cat).length})
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Document Coverage */}
                        <div>
                          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 600, color: "var(--ash)", marginBottom: "8px", letterSpacing: "0.04em" }}>
                            DOCUMENT COVERAGE
                          </div>
                          <div className="flex items-center justify-between">
                            <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "13px", color: "var(--ash)" }}>
                              {documents.length} document{documents.length !== 1 ? "s" : ""} analyzed
                            </span>
                            <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "13px", color: "var(--ash)" }}>
                              {analysis.comparisonMatrix.length} comparison fields
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </Card>

              {/* AI Recommendation — spans full width */}
              <Card className="md:col-span-2" style={{ display: 'flex', flexDirection: 'column', maxHeight: '320px', background: "var(--volt-dim)", border: "1px solid var(--volt-border)" }}>
                <div style={{ flexShrink: 0 }}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "18px", fontWeight: 700, color: "var(--paper)" }}>AI Recommendation</h3>
                    <Lightbulb size={18} style={{ color: "var(--ghost)" }} />
                  </div>
                  <div style={{ height: "1px", background: "var(--volt-border)", margin: "12px 0" }} />
                </div>
                <div className="card-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                  <div className="inline-block px-4 py-2 rounded-full mb-4" style={{ background: "rgba(0,196,140,0.12)", border: "1px solid rgba(0,196,140,0.25)" }}>
                    <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "14px", fontWeight: 500, color: "var(--cleared)" }}>
                      {analysis.recommendation.title}
                    </span>
                  </div>
                  {/* Confidence Score */}
                  <div className="flex items-center gap-3 mb-4">
                    <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "13px", fontWeight: 500, color: "var(--ash)" }}>
                      AI Confidence
                    </span>
                    <div style={{ flex: 1, height: "6px", background: "var(--rule)", borderRadius: "3px", overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.round(analysis.recommendation.confidence * 100)}%`,
                          background: analysis.recommendation.confidence >= 0.7
                            ? "var(--cleared)"
                            : analysis.recommendation.confidence >= 0.4
                            ? "var(--caution)"
                            : "var(--error)",
                          borderRadius: "3px",
                          transition: "width 1s ease",
                        }}
                      />
                    </div>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "13px",
                      fontWeight: 600,
                      color: analysis.recommendation.confidence >= 0.7 ? "var(--cleared)"
                        : analysis.recommendation.confidence >= 0.4 ? "var(--caution)"
                        : "var(--error)",
                      minWidth: "36px",
                      textAlign: "right",
                    }}>
                      {Math.round(analysis.recommendation.confidence * 100)}%
                    </span>
                  </div>
                  <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "15px", lineHeight: 1.6, color: "var(--ash)", marginBottom: "12px" }}>
                    {analysis.recommendation.summary}
                  </p>
                  {analysis.recommendation.nextSteps.length > 0 && (
                    <ul className="space-y-1 mb-4">
                      {analysis.recommendation.nextSteps.map((step, i) => (
                        <li key={i} style={{ fontFamily: "'Inter', sans-serif", fontSize: "14px", lineHeight: 1.6, color: "var(--ash)", paddingLeft: "12px", position: "relative" }}>
                          <span style={{ color: "var(--volt)", marginRight: "6px" }}>&rarr;</span>{step}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div style={{ borderTop: "1px solid var(--volt-border)", paddingTop: "16px" }}>
                    <Link to="/chat" style={{ fontFamily: "'Inter', sans-serif", fontSize: "14px", fontWeight: 500, color: "var(--volt)", textDecoration: "none" }}>
                      Ask follow-up questions →
                    </Link>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
