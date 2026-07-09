import { useEffect, useRef, useState } from "react";
import { NavigationBar } from "../components/NavigationBar";
import { GhostButton, PrimaryButton } from "../components/Buttons";
import { EvidenceTag, EvidenceBox } from "../components/Badges";
import {
  Paperclip,
  Send,
  AlertTriangle,
  ArrowRight,
  FileText,
  Sparkles,
  PanelLeft,
  X,
  ArrowLeft,
  Download,
  ChevronDown,
  FileDown,
  Copy,
  Check,
} from "lucide-react";
import { streamChatMessage, getSuggestedQuestions, exportReport } from "../../lib/api";
import { useAppState } from "../../lib/store";
import { Link } from "react-router";
import { toast } from "sonner";
import type { StructuredAIResponse } from "../../lib/types";
import { MarkdownText } from "../components/MarkdownText";

const fallbackQuestions = [
  "What are the payment terms?",
  "Are there any high-risk clauses?",
  "What conflicts exist between documents?",
  "Which supplier offers better terms?",
  "What are the termination conditions?",
  "Summarize the key financial obligations",
];

interface UserMessage {
  id: string;
  role: "user";
  content: string;
  timestamp: string;
}

interface AssistantMessage {
  id: string;
  role: "assistant";
  structuredResponse: StructuredAIResponse;
  timestamp: string;
}

type ChatMessage = UserMessage | AssistantMessage;

export default function Chat() {
  const { sessionId, documents, analysis } = useAppState();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [quickQuestions, setQuickQuestions] = useState<string[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [streamingAnswer, setStreamingAnswer] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sourceModal, setSourceModal] = useState<{ quote: string; source: string; docType: string } | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [inputShake, setInputShake] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const downloadRef = useRef<HTMLDivElement>(null);

  // Close download dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (downloadRef.current && !downloadRef.current.contains(e.target as Node)) {
        setDownloadOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    if (analysis?.suggestedQuestions?.length) {
      setQuickQuestions(analysis.suggestedQuestions);
      return;
    }
    let cancelled = false;
    setQuestionsLoading(true);
    getSuggestedQuestions(sessionId)
      .then((questions) => {
        if (!cancelled) setQuickQuestions(questions.length > 0 ? questions : fallbackQuestions);
      })
      .catch(() => { if (!cancelled) setQuickQuestions(fallbackQuestions); })
      .finally(() => { if (!cancelled) setQuestionsLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId, analysis]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  if (!sessionId) {
    return (
      <div className="min-h-screen" style={{ background: "var(--ink)" }}>
        <NavigationBar showDemo={false} />
        <div className="flex flex-col items-center pt-24 gap-6 px-4 animate-fadeIn">
          <div className="px-6 py-6 rounded-xl text-center w-full" style={{ background: "var(--lead)", border: "1px solid var(--rule)", maxWidth: "480px" }}>
            <FileText size={40} style={{ color: "var(--ghost)", margin: "0 auto 16px" }} />
            <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "20px", fontWeight: 700, color: "var(--paper)", marginBottom: "8px" }}>
              No active session
            </h2>
            <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "15px", lineHeight: 1.6, color: "var(--ash)", marginBottom: "20px" }}>
              Please upload documents first to start asking questions.
            </p>
            <Link to="/"><PrimaryButton>Upload Documents</PrimaryButton></Link>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || isThinking || !sessionId) return;

    const userMsg: UserMessage = { id: `u-${Date.now()}`, role: "user", content: trimmed, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setIsThinking(true);
    setStreamingAnswer("");
    setSidebarOpen(false);

    const historyForAPI = messages.slice(-10).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.role === 'user'
        ? (m as UserMessage).content
        : (m as AssistantMessage).structuredResponse.answer,
    }));

    let accumulated = "";

    try {
      setIsStreaming(true);
      setIsThinking(false);

      await streamChatMessage(
        sessionId,
        trimmed,
        historyForAPI,
        (token) => {
          accumulated += token;
          setStreamingAnswer(accumulated);
        },
        (response) => {
          setIsStreaming(false);
          setStreamingAnswer("");
          const assistantMsg: AssistantMessage = {
            id: response.messageId,
            role: "assistant",
            structuredResponse: response.structuredResponse,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
        },
        (error) => {
          setIsStreaming(false);
          setStreamingAnswer("");
          toast.error('Message failed to send. Please try again.');
          const errMsg: AssistantMessage = {
            id: `err-${Date.now()}`,
            role: "assistant",
            structuredResponse: {
              answer: error.toLowerCase().includes("session not found")
                ? "Your session has expired. Please re-upload your documents."
                : error,
              evidence: [],
              risks: "",
              recommendation: error.toLowerCase().includes("session not found")
                ? "Navigate to the home page to start a new session."
                : "",
            },
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, errMsg]);
        },
      );
    } catch (err) {
      setIsStreaming(false);
      setStreamingAnswer("");
      const errorMessage = err instanceof Error ? err.message : "Something went wrong.";
      toast.error('Message failed to send. Please try again.');
      const errMsg: AssistantMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        structuredResponse: {
          answer: errorMessage,
          evidence: [],
          risks: "",
          recommendation: "",
        },
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsThinking(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!inputValue.trim()) {
        // Shake the input for visual feedback
        setInputShake(true);
        setTimeout(() => setInputShake(false), 500);
        return;
      }
      void handleSubmit(inputValue);
    }
  };

  const handleExportChat = () => {
    if (!messages.length) return;
    const lines: string[] = [`Clausify AI — Chat Export\n${new Date().toLocaleString()}\n${'='.repeat(60)}\n`];
    for (const msg of messages) {
      if (msg.role === 'user') {
        lines.push(`[You]\n${msg.content}\n`);
      } else {
        const sr = msg.structuredResponse;
        lines.push(`[Clausify AI]\n${sr.answer}`);
        if (sr.evidence.length) {
          lines.push(`\nEvidence:`);
          sr.evidence.forEach(ev => lines.push(`  • "${ev.quote}" — ${ev.sourceDocument}`));
        }
        if (sr.risks) lines.push(`\nRisk: ${sr.risks}`);
        if (sr.recommendation) lines.push(`\nRecommendation: ${sr.recommendation}`);
        lines.push('');
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clausify-chat-${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportReport = async (format: "pdf" | "docx") => {
    if (!sessionId) return;
    setIsExporting(true);
    setDownloadOpen(false);
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

  const handleDownloadChat = () => {
    handleExportChat();
    setDownloadOpen(false);
    toast.success("Chat exported!");
  };

  const docCount = documents.length;

  const SidebarContent = () => (
    <>
      <div className="p-4">
        <h3 style={{ fontFamily: "'Inter', sans-serif", fontSize: "13px", fontWeight: 500, color: "var(--ghost)", marginBottom: "12px" }}>
          Active Documents
        </h3>
        <div className="space-y-2">
          {documents.map((doc) => {
            const isImage = doc.fileType === "image";
            return (
              <div
                key={doc.id}
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg"
                style={{ background: "var(--graphite)", border: "1px solid var(--rule)" }}
              >
                <span
                  aria-hidden="true"
                  style={{ width: "6px", height: "6px", borderRadius: "50%", background: isImage ? "var(--volt)" : "var(--conflict)", flexShrink: 0 }}
                />
                <span
                  className="truncate"
                  style={{ fontFamily: "'Inter', sans-serif", fontSize: "13px", fontWeight: 500, color: "var(--ash)" }}
                >
                  {doc.filename}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ height: "1px", background: "var(--rule)", margin: "8px 0" }} />

      <div className="px-4 pb-4">
        <div className="mb-3 flex items-center gap-2" style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "var(--ghost)", textTransform: "uppercase" }}>
          <Sparkles size={12} style={{ color: "var(--ghost)" }} />
          QUICK QUESTIONS
        </div>
        <div className="flex flex-col gap-2">
          {questionsLoading ? (
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="animate-dot-1 w-1.5 h-1.5 rounded-full" style={{ background: "var(--volt)" }} />
              <div className="animate-dot-2 w-1.5 h-1.5 rounded-full" style={{ background: "var(--volt)" }} />
              <div className="animate-dot-3 w-1.5 h-1.5 rounded-full" style={{ background: "var(--volt)" }} />
              <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", color: "var(--ghost)" }}>Generating…</span>
            </div>
          ) : (
            quickQuestions.map((q, idx) => (
              <button
                key={idx}
                className="w-full px-3 py-2 rounded-lg border text-left transition-all"
                style={{ background: "var(--lead)", borderColor: "var(--rule)", borderRadius: "var(--radius-btn)", fontFamily: "'Inter', sans-serif", fontWeight: 400, fontSize: "13px", color: "var(--ash)", cursor: "pointer" }}
                onMouseOver={(e) => { e.currentTarget.style.borderColor = "var(--volt-border)"; e.currentTarget.style.color = "var(--paper)"; e.currentTarget.style.background = "var(--volt-dim)"; }}
                onMouseOut={(e) => { e.currentTarget.style.borderColor = "var(--rule)"; e.currentTarget.style.color = "var(--ash)"; e.currentTarget.style.background = "var(--lead)"; }}
                onClick={() => { void handleSubmit(q); }}
                disabled={isThinking || isStreaming}
              >
                {q}
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="flex flex-col" style={{ height: "100dvh", background: "var(--ink)" }}>
      <NavigationBar showDemo={false} />

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop left panel */}
        <div
          className="hidden md:flex flex-col shrink-0"
          style={{ width: "280px", background: "var(--lead)", borderRight: "1px solid var(--rule)", overflowY: "auto" }}
        >
          <SidebarContent />
        </div>

        {/* Mobile sidebar drawer */}
        {sidebarOpen && (
          <div className="md:hidden fixed inset-0 z-50 animate-fadeIn" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setSidebarOpen(false)}>
            <div
              className="animate-slideDown"
              style={{ width: "min(300px, 85vw)", height: "100%", background: "var(--lead)", borderRight: "1px solid var(--rule)", overflowY: "auto" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: "1px solid var(--rule)" }}>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 700, color: "var(--paper)" }}>Documents & Questions</span>
                <button onClick={() => setSidebarOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ash)" }}>
                  <X size={18} />
                </button>
              </div>
              <SidebarContent />
            </div>
          </div>
        )}

        {/* Main chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chat Header */}
          <div
            className="flex items-center justify-between px-4 sm:px-6 shrink-0"
            style={{ background: "var(--lead)", borderBottom: "1px solid var(--rule)", height: "60px" }}
          >
            <div className="flex items-center gap-3">
              {/* Mobile sidebar toggle */}
              <button
                className="md:hidden flex items-center justify-center"
                onClick={() => setSidebarOpen(true)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ash)", padding: "4px", marginRight: "4px" }}
              >
                <PanelLeft size={18} />
              </button>

              {/* Back to Analysis button */}
              <Link
                to="/dashboard"
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 500, color: "var(--ghost)", border: "1px solid var(--rule)", textDecoration: "none", transition: "all 0.15s" }}
                onMouseOver={(e) => { e.currentTarget.style.borderColor = "var(--volt-border)"; e.currentTarget.style.color = "var(--paper)"; }}
                onMouseOut={(e) => { e.currentTarget.style.borderColor = "var(--rule)"; e.currentTarget.style.color = "var(--ghost)"; }}
              >
                <ArrowLeft size={13} />
                Analysis
              </Link>

              {/* Document-icon avatar with pulse ring */}
              <div className="relative shrink-0" style={{ width: "40px", height: "40px" }}>
                <div
                  aria-hidden="true"
                  className="animate-voltPulse"
                  style={{ position: "absolute", top: "-4px", left: "-4px", right: "-4px", bottom: "-4px", borderRadius: "10px", border: "1px solid rgba(59,123,246,0.4)", pointerEvents: "none" }}
                />
                <div
                  style={{ width: "40px", height: "40px", borderRadius: "8px", background: "var(--graphite)", border: "1px solid var(--rule)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}
                >
                  <FileText size={18} style={{ color: "var(--volt)" }} />
                </div>
              </div>

              <div className="flex flex-col min-w-0">
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 700, color: "var(--paper)" }}>
                  Decision Copilot
                </div>
                <div className="flex items-center gap-2">
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", fontWeight: 500, color: "var(--cleared)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "200px" }}>
                    {docCount} doc{docCount !== 1 ? "s" : ""} · AMD MI300X active
                  </span>
                  {isThinking && (
                    <div className="flex items-center gap-1">
                      <div className="animate-dot-1 w-1.5 h-1.5 rounded-full" style={{ background: "var(--volt)" }} />
                      <div className="animate-dot-2 w-1.5 h-1.5 rounded-full" style={{ background: "var(--volt)" }} />
                      <div className="animate-dot-3 w-1.5 h-1.5 rounded-full" style={{ background: "var(--volt)" }} />
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Download dropdown */}
              <div className="relative" ref={downloadRef}>
                <GhostButton small onClick={() => setDownloadOpen(!downloadOpen)} disabled={isExporting}>
                  <Download size={14} className="mr-1.5" />
                  <span className="hidden sm:inline">{isExporting ? "Exporting…" : "Download"}</span>
                  <ChevronDown size={12} className="ml-1" style={{ transform: downloadOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                </GhostButton>
                {downloadOpen && (
                  <div
                    className="absolute right-0 top-full mt-1 z-50 rounded-lg py-1 animate-fadeIn"
                    style={{
                      background: "var(--lead)",
                      border: "1px solid var(--rule)",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                      minWidth: "200px",
                    }}
                  >
                    <button
                      onClick={handleDownloadChat}
                      disabled={!messages.length}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left"
                      style={{
                        background: "none",
                        border: "none",
                        cursor: messages.length ? "pointer" : "not-allowed",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: "13px",
                        color: messages.length ? "var(--paper)" : "var(--ghost)",
                        transition: "background 0.15s",
                        opacity: messages.length ? 1 : 0.5,
                      }}
                      onMouseOver={(e) => { if (messages.length) e.currentTarget.style.background = "var(--graphite)"; }}
                      onMouseOut={(e) => { e.currentTarget.style.background = "none"; }}
                    >
                      <div className="flex items-center justify-center rounded" style={{ width: "28px", height: "28px", background: "rgba(59,123,246,0.1)", border: "1px solid rgba(59,123,246,0.2)" }}>
                        <FileText size={14} style={{ color: "var(--volt)" }} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 500 }}>Export Chat</div>
                        <div style={{ fontSize: "11px", color: "var(--ghost)" }}>Download conversation as .txt</div>
                      </div>
                    </button>
                    <div style={{ height: "1px", background: "var(--rule)", margin: "2px 8px" }} />
                    <button
                      onClick={() => handleExportReport("pdf")}
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
                        <FileDown size={14} style={{ color: "var(--amd-signal)" }} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 500 }}>Analysis as PDF</div>
                        <div style={{ fontSize: "11px", color: "var(--ghost)" }}>Full report with findings</div>
                      </div>
                    </button>
                    <button
                      onClick={() => handleExportReport("docx")}
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
                        <div style={{ fontWeight: 500 }}>Analysis as DOCX</div>
                        <div style={{ fontSize: "11px", color: "var(--ghost)" }}>Editable Word document</div>
                      </div>
                    </button>
                  </div>
                )}
              </div>

              {/* Mobile back button */}
              <Link to="/dashboard" className="sm:hidden">
                <GhostButton small>
                  <ArrowLeft size={14} />
                </GhostButton>
              </Link>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5" style={{ background: "var(--ink)" }}>
            {/* Empty state — show inline suggested questions */}
            {messages.length === 0 && !isThinking && !isStreaming && (
              <div className="flex flex-col items-center justify-center h-full py-8 animate-fadeIn">
                <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "var(--volt-dim)", border: "1px solid var(--volt-border)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "16px" }}>
                  <Sparkles size={22} style={{ color: "var(--volt)" }} />
                </div>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "18px", fontWeight: 700, color: "var(--paper)", marginBottom: "6px", textAlign: "center" }}>
                  Ask anything about your documents
                </p>
                <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "14px", color: "var(--ghost)", marginBottom: "24px", textAlign: "center" }}>
                  {documents.length} document{documents.length !== 1 ? "s" : ""} loaded · AMD MI300X ready
                </p>
                {/* Inline suggested questions grid */}
                {quickQuestions.length > 0 && (
                  <div className="w-full grid gap-2" style={{ maxWidth: "560px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                    {quickQuestions.slice(0, 6).map((q, idx) => (
                      <button
                        key={idx}
                        className="px-4 py-3 rounded-xl text-left"
                        style={{ background: "var(--lead)", border: "1px solid var(--rule)", fontFamily: "'Inter', sans-serif", fontSize: "13px", color: "var(--ash)", cursor: "pointer", transition: "all 0.15s", lineHeight: 1.4 }}
                        onMouseOver={(e) => { e.currentTarget.style.borderColor = "var(--volt-border)"; e.currentTarget.style.color = "var(--paper)"; e.currentTarget.style.background = "var(--volt-dim)"; }}
                        onMouseOut={(e) => { e.currentTarget.style.borderColor = "var(--rule)"; e.currentTarget.style.color = "var(--ash)"; e.currentTarget.style.background = "var(--lead)"; }}
                        onClick={() => void handleSubmit(q)}
                      >
                        <ArrowRight size={12} style={{ color: "var(--volt)", marginRight: "6px", display: "inline", flexShrink: 0 }} />
                        {q}
                      </button>
                    ))}
                  </div>
                )}
                {questionsLoading && (
                  <div className="flex items-center gap-2 mt-4">
                    <div className="animate-dot-1 w-1.5 h-1.5 rounded-full" style={{ background: "var(--volt)" }} />
                    <div className="animate-dot-2 w-1.5 h-1.5 rounded-full" style={{ background: "var(--volt)" }} />
                    <div className="animate-dot-3 w-1.5 h-1.5 rounded-full" style={{ background: "var(--volt)" }} />
                    <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", color: "var(--ghost)" }}>Generating questions…</span>
                  </div>
                )}
              </div>
            )}
            {messages.map((msg) => {
              if (msg.role === "user") {
                return (
                  <div key={msg.id} className="flex justify-end animate-slideUp">
                    <div style={{ maxWidth: "min(520px, 85vw)" }}>
                      <div className="rounded-2xl px-4 py-3" style={{ background: "linear-gradient(135deg, var(--graphite) 0%, rgba(59,123,246,0.08) 100%)", border: "1px solid var(--rule)", borderRadius: "16px 16px 4px 16px" }}>
                        <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "15px", lineHeight: 1.6, color: "var(--paper)" }}>
                          {msg.content}
                        </p>
                      </div>
                      <div className="text-right mt-1">
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", color: "var(--ghost)" }}>
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              }

              const sr = msg.structuredResponse;
              return (
                <div key={msg.id} className="flex justify-start animate-slideUp">
                  <div style={{ maxWidth: "min(720px, 95vw)", width: "100%" }}>
                    <div className="rounded-2xl p-4 sm:p-5" style={{ background: "var(--lead)", border: "1px solid var(--rule)", borderLeft: "3px solid var(--volt)", borderRadius: "4px 16px 16px 16px" }}>
                      {/* ANSWER */}
                      <div className="mb-4">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="flex items-center gap-1.5">
                            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--volt)", boxShadow: "0 0 6px rgba(59,123,246,0.4)" }} />
                            <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "var(--volt)", textTransform: "uppercase" }}>ANSWER</span>
                          </div>
                          <div style={{ flex: 1, height: "1px", background: "var(--rule)" }} />
                        </div>
                        <MarkdownText text={sr.answer} style={{ fontSize: "15px", lineHeight: 1.7 }} />
                        <div className="flex justify-end mt-2">
                          <button
                            onClick={() => {
                              void navigator.clipboard.writeText(sr.answer).then(() => {
                                setCopiedId(msg.id);
                                setTimeout(() => setCopiedId(null), 2000);
                              });
                            }}
                            className="flex items-center gap-1"
                            style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", color: copiedId === msg.id ? "var(--cleared)" : "var(--ghost)", padding: "2px 6px", borderRadius: "4px", transition: "color 0.15s" }}
                            onMouseOver={(e) => { if (copiedId !== msg.id) e.currentTarget.style.color = "var(--ash)"; }}
                            onMouseOut={(e) => { if (copiedId !== msg.id) e.currentTarget.style.color = "var(--ghost)"; }}
                          >
                            {copiedId === msg.id ? <><Check size={11} />&nbsp;Copied</> : <><Copy size={11} />&nbsp;Copy</>}
                          </button>
                        </div>
                      </div>

                      {/* EVIDENCE */}
                      {sr.evidence.length > 0 && (
                        <div className="mb-4">
                          <div className="flex items-center gap-1.5 mb-2">
                            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--cyan)" }} />
                            <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "var(--cyan)", textTransform: "uppercase" }}>EVIDENCE</span>
                          </div>
                          <div className="space-y-2">
                            {sr.evidence.map((ev, i) => (
                              <div
                                key={i}
                                style={{ cursor: "pointer", transition: "all 0.15s" }}
                                onClick={() => setSourceModal({ quote: ev.quote, source: ev.sourceDocument, docType: ev.documentType })}
                                onMouseOver={(e) => { e.currentTarget.style.transform = "translateX(2px)"; e.currentTarget.style.opacity = "0.85"; }}
                                onMouseOut={(e) => { e.currentTarget.style.transform = "translateX(0)"; e.currentTarget.style.opacity = "1"; }}
                                title="Click to view source"
                              >
                                <EvidenceBox quote={ev.quote} style={{ marginBottom: "6px" }} />
                                <div className="flex items-center justify-between">
                                  <EvidenceTag filename={ev.sourceDocument} />
                                  <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "10px", color: "var(--volt)", fontWeight: 500 }}>View source →</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* RISK */}
                      {sr.risks && (
                        <div className="mb-4">
                          <div className="flex items-center gap-1.5 mb-2">
                            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--caution)" }} />
                            <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "var(--caution)", textTransform: "uppercase" }}>RISK</span>
                          </div>
                          <div className="flex items-start gap-2 rounded-lg" style={{ background: "rgba(245, 158, 11, 0.04)", border: "1px solid rgba(245, 158, 11, 0.12)", padding: "12px" }}>
                            <AlertTriangle size={14} style={{ color: "var(--caution)", marginTop: "3px", flexShrink: 0 }} />
                            <MarkdownText text={sr.risks} style={{ fontSize: "14px", lineHeight: 1.6, opacity: 0.9 }} />
                          </div>
                        </div>
                      )}

                      {/* RECOMMENDATION */}
                      {sr.recommendation && (
                        <div>
                          <div className="flex items-center gap-1.5 mb-2">
                            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--cleared)" }} />
                            <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "var(--cleared)", textTransform: "uppercase" }}>RECOMMENDATION</span>
                          </div>
                          <div className="flex items-start gap-2 rounded-lg" style={{ background: "rgba(16, 185, 129, 0.04)", border: "1px solid rgba(16, 185, 129, 0.12)", padding: "12px", borderLeft: "2px solid var(--cleared)" }}>
                            <ArrowRight size={14} style={{ color: "var(--cleared)", marginTop: "3px", flexShrink: 0 }} />
                            <MarkdownText text={sr.recommendation} style={{ fontSize: "14px", fontWeight: 500, lineHeight: 1.6 }} />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Timestamp */}
                    <div className="flex items-center gap-3 mt-1.5 px-1">
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", color: "var(--ghost)" }}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Streaming answer bubble */}
            {isStreaming && (
              <div className="flex justify-start animate-slideUp">
                <div style={{ maxWidth: "min(720px, 95vw)", width: "100%" }}>
                  <div className="rounded-2xl p-4 sm:p-5" style={{ background: "var(--lead)", border: "1px solid var(--rule)", borderLeft: "3px solid var(--volt)", borderRadius: "4px 16px 16px 16px" }}>
                    <div className="mb-2 flex items-center gap-2">
                      <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "var(--volt)", textTransform: "uppercase" }}>
                        {streamingAnswer ? "ANSWER" : "THINKING"}
                      </span>
                      <div style={{ flex: 1, height: "1px", background: "var(--rule)" }} />
                      <div className="flex items-center gap-1">
                        <div className="animate-dot-1 w-1.5 h-1.5 rounded-full" style={{ background: "var(--volt)" }} />
                        <div className="animate-dot-2 w-1.5 h-1.5 rounded-full" style={{ background: "var(--volt)" }} />
                        <div className="animate-dot-3 w-1.5 h-1.5 rounded-full" style={{ background: "var(--volt)" }} />
                      </div>
                    </div>
                    {streamingAnswer ? (
                      <div style={{ fontFamily: "'Inter', sans-serif", fontSize: "15px", lineHeight: 1.7, color: "var(--paper)" }}>
                        <MarkdownText text={streamingAnswer} />
                        <span
                          style={{
                            display: "inline-block",
                            width: "2px",
                            height: "1em",
                            background: "var(--volt)",
                            marginLeft: "2px",
                            verticalAlign: "text-bottom",
                            animation: "blink 1s step-end infinite",
                          }}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 py-2">
                        <div style={{ width: "16px", height: "16px", borderRadius: "50%", border: "2px solid var(--volt)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
                        <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "13px", color: "var(--ash)", fontStyle: "italic" }}>
                          Analyzing documents and reasoning...
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Thinking indicator */}
            {isThinking && (
              <div className="flex justify-start animate-slideUp">
                <div className="px-4 py-4 rounded-2xl" style={{ background: "var(--lead)", border: "1px solid var(--rule)", borderLeft: "3px solid var(--volt)", borderRadius: "4px 16px 16px 16px" }}>
                  <div className="flex items-center gap-3">
                    <div className="animate-dot-1 w-2 h-2 rounded-full" style={{ background: "var(--volt)", boxShadow: "0 0 6px rgba(59,123,246,0.5)" }} />
                    <div className="animate-dot-2 w-2 h-2 rounded-full" style={{ background: "var(--volt)", boxShadow: "0 0 6px rgba(59,123,246,0.5)" }} />
                    <div className="animate-dot-3 w-2 h-2 rounded-full" style={{ background: "var(--volt)", boxShadow: "0 0 6px rgba(59,123,246,0.5)" }} />
                    <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "13px", color: "var(--ghost)" }}>Clausify AI is thinking…</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input */}
          <div className="px-4 sm:px-6 py-4 shrink-0 safe-bottom" style={{ background: "var(--lead)", borderTop: "1px solid var(--rule)" }}>
            {/* Mobile: quick questions scrollable horizontally above input */}
            <div className="md:hidden overflow-x-auto no-scrollbar flex items-center gap-2 mb-3">
              {questionsLoading ? (
                <div className="flex items-center gap-2 px-1 shrink-0">
                  <div className="animate-dot-1 w-1.5 h-1.5 rounded-full" style={{ background: "var(--volt)" }} />
                  <div className="animate-dot-2 w-1.5 h-1.5 rounded-full" style={{ background: "var(--volt)" }} />
                  <div className="animate-dot-3 w-1.5 h-1.5 rounded-full" style={{ background: "var(--volt)" }} />
                </div>
              ) : (
                quickQuestions.map((q, idx) => (
                  <button
                    key={idx}
                    className="shrink-0 whitespace-nowrap px-3 py-2 rounded-lg border transition-all"
                    style={{ background: "var(--lead)", borderColor: "var(--rule)", borderRadius: "var(--radius-btn)", fontFamily: "'Inter', sans-serif", fontWeight: 400, fontSize: "13px", color: "var(--ash)", cursor: "pointer" }}
                    onClick={() => { void handleSubmit(q); }}
                    disabled={isThinking || isStreaming}
                  >
                    {q}
                  </button>
                ))
              )}
            </div>

            <div
              className="flex items-center gap-3 px-4 rounded-2xl"
              style={{ background: "var(--graphite)", border: `1px solid ${inputShake ? "var(--amd-signal)" : "var(--rule)"}`, minHeight: "52px", transition: "border-color 0.2s", animation: inputShake ? "shake 0.4s ease" : "none" }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--volt-border)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "var(--rule)"; }}
            >
              <Paperclip size={18} style={{ color: "var(--ghost)", flexShrink: 0 }} />
              <input
                ref={inputRef}
                type="text"
                placeholder="Ask anything about your documents…"
                className="flex-1 bg-transparent border-none outline-none placeholder-ghost"
                style={{ fontFamily: "'Inter', sans-serif", fontSize: "15px", color: "var(--paper)", minWidth: 0 }}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isThinking || isStreaming}
              />
              <button
                className="flex items-center justify-center rounded-full shrink-0"
                style={{ width: "36px", height: "36px", background: isThinking || isStreaming || !inputValue.trim() ? "var(--graphite)" : "var(--volt)", border: "none", cursor: isThinking || isStreaming || !inputValue.trim() ? "not-allowed" : "pointer", transition: "background 0.2s, opacity 0.2s", opacity: isThinking || isStreaming || !inputValue.trim() ? 0.5 : 1 }}
                onClick={() => void handleSubmit(inputValue)}
                disabled={isThinking || isStreaming || !inputValue.trim()}
              >
                <Send size={16} style={{ color: "var(--paper)" }} />
              </button>
            </div>
            <div className="text-center mt-2">
              <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", fontWeight: 500, color: "var(--ghost)" }}>
                Clausify AI only answers from your uploaded documents · Powered by AMD
              </span>
            </div>
          </div>
        </div>
      </div>
      {/* Source Viewer Modal */}
      {sourceModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fadeIn"
          style={{ background: "rgba(0,0,0,0.7)", padding: "16px" }}
          onClick={() => setSourceModal(null)}
        >
          <div
            className="w-full rounded-2xl p-5 animate-slideUp"
            style={{
              maxWidth: "560px",
              background: "var(--lead)",
              border: "1px solid var(--volt-border)",
              boxShadow: "0 0 40px rgba(59,123,246,0.12)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div
                  style={{
                    width: "8px", height: "8px", borderRadius: "50%",
                    background: sourceModal.docType === "image" ? "var(--volt)" : "var(--conflict)",
                  }}
                />
                <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "13px", fontWeight: 600, color: "var(--ash)" }}>
                  {sourceModal.source}
                </span>
              </div>
              <button
                onClick={() => setSourceModal(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ghost)", display: "flex", alignItems: "center" }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Label */}
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ghost)", marginBottom: "8px" }}>
              DOCUMENT EXCERPT
            </div>

            {/* Quote */}
            <EvidenceBox
              quote={sourceModal.quote}
              style={{ fontSize: "14px", lineHeight: 1.7, borderLeft: "3px solid var(--volt)" }}
            />

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setSourceModal(null)}
                style={{
                  fontFamily: "'Inter', sans-serif", fontSize: "13px", fontWeight: 500,
                  color: "var(--volt)", background: "none", border: "none", cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
