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
} from "lucide-react";
import { streamChatMessage, getSuggestedQuestions } from "../../lib/api";
import { useAppState, useAppDispatch } from "../../lib/store";
import { Link } from "react-router";
import type { StructuredAIResponse, UserChatMessage, AssistantChatMessage, PersistedChatMessage, UploadedDocument } from "../../lib/types";

const fallbackQuestions = [
  "Summarize this document",
  "What are the key points?",
  "Any concerns?",
  "What should I do next?",
  "What's missing?",
  "Compare the options",
];

// Re-export local type aliases for component readability
type UserMessage = UserChatMessage;
type AssistantMessage = AssistantChatMessage;
type ChatMessage = PersistedChatMessage;

// ── ChatSidebar ─────────────────────────────────────────────────────────────
// Extracted outside Chat component to prevent remount on every parent re-render.
interface ChatSidebarProps {
  documents: UploadedDocument[];
  questionsLoading: boolean;
  quickQuestions: string[];
  isThinking: boolean;
  isStreaming: boolean;
  onQuestionClick: (q: string) => void;
}

function ChatSidebar({
  documents,
  questionsLoading,
  quickQuestions,
  isThinking,
  isStreaming,
  onQuestionClick,
}: ChatSidebarProps) {
  return (
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
                <span className="truncate" style={{ fontFamily: "'Inter', sans-serif", fontSize: "13px", fontWeight: 500, color: "var(--ash)" }}>
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
                onClick={() => { void onQuestionClick(q); }}
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
}

export default function Chat() {
  const { sessionId, documents, analysis, messages } = useAppState();
  const dispatch = useAppDispatch();

  const [inputValue, setInputValue] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [quickQuestions, setQuickQuestions] = useState<string[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [streamingAnswer, setStreamingAnswer] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sourceModal, setSourceModal] = useState<{ quote: string; source: string; docType: string } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // AbortController ref for cleaning up in-flight streaming requests on unmount
  const abortControllerRef = useRef<{ abort: () => void } | null>(null);

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

  // Abort any in-flight stream when the component unmounts (user navigates away)
  // This prevents React "state update on unmounted component" warnings
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

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
    dispatch({ type: "ADD_MESSAGE", payload: userMsg });
    setInputValue("");
    setIsThinking(true);
    setStreamingAnswer("");
    setSidebarOpen(false);

    const historyForAPI = messages.slice(-6).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.role === 'user'
        ? (m as UserMessage).content
        : (m as AssistantMessage).structuredResponse.answer,
    }));

    let accumulated = "";

    try {
      setIsStreaming(true);
      setIsThinking(false);

      const { abort, promise } = streamChatMessage(
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
          dispatch({ type: "ADD_MESSAGE", payload: assistantMsg });
        },
        (error) => {
          setIsStreaming(false);
          setStreamingAnswer("");
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
          dispatch({ type: "ADD_MESSAGE", payload: errMsg });
        },
      );
      // Store the abort function so the unmount cleanup can cancel mid-stream
      abortControllerRef.current = { abort };
      await promise;
    } catch (err) {
      setIsStreaming(false);
      setStreamingAnswer("");
      const errorMessage = err instanceof Error ? err.message : "Something went wrong.";
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
      dispatch({ type: "ADD_MESSAGE", payload: errMsg });
    } finally {
      setIsThinking(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSubmit(inputValue); }
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

  const docCount = documents.length;

  return (
    <div className="flex flex-col" style={{ height: "100dvh", background: "var(--ink)" }}>
      <NavigationBar showDemo={false} />

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop left panel */}
        <div
          className="hidden md:flex flex-col shrink-0"
          style={{ width: "280px", background: "var(--lead)", borderRight: "1px solid var(--rule)", overflowY: "auto" }}
        >
          <ChatSidebar
            documents={documents}
            questionsLoading={questionsLoading}
            quickQuestions={quickQuestions}
            isThinking={isThinking}
            isStreaming={isStreaming}
            onQuestionClick={handleSubmit}
          />
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
              <ChatSidebar
                documents={documents}
                questionsLoading={questionsLoading}
                quickQuestions={quickQuestions}
                isThinking={isThinking}
                isStreaming={isStreaming}
                onQuestionClick={handleSubmit}
              />
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

            <div className="hidden sm:block">
              <GhostButton small onClick={handleExportChat} disabled={!messages.length}>Export Chat</GhostButton>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5" style={{ background: "var(--ink)" }}>
            {messages.map((msg) => {
              if (msg.role === "user") {
                return (
                  <div key={msg.id} className="flex justify-end animate-slideUp">
                    <div style={{ maxWidth: "min(520px, 85vw)" }}>
                      <div className="rounded-2xl px-4 py-3" style={{ background: "var(--graphite)", borderRadius: "16px 16px 4px 16px" }}>
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
                          <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "var(--ghost)", textTransform: "uppercase" }}>ANSWER</span>
                          <div style={{ flex: 1, height: "1px", background: "var(--rule)" }} />
                        </div>
                        <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "15px", lineHeight: 1.6, color: "var(--paper)" }}>{sr.answer}</p>
                      </div>

                      {/* EVIDENCE */}
                      {sr.evidence.length > 0 && (
                        <div className="mb-4">
                          <div className="mb-2" style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "var(--ghost)", textTransform: "uppercase" }}>EVIDENCE</div>
                          <div className="space-y-2">
                            {sr.evidence.map((ev, i) => (
                              <div
                                key={i}
                                style={{ cursor: "pointer", transition: "opacity 0.15s" }}
                                onClick={() => setSourceModal({ quote: ev.quote, source: ev.sourceDocument, docType: ev.documentType })}
                                onMouseOver={(e) => { e.currentTarget.style.opacity = "0.85"; }}
                                onMouseOut={(e) => { e.currentTarget.style.opacity = "1"; }}
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
                          <div className="mb-2" style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "var(--ghost)", textTransform: "uppercase" }}>RISK</div>
                          <div className="flex items-start gap-2">
                            <AlertTriangle size={14} style={{ color: "var(--caution)", marginTop: "3px", flexShrink: 0 }} />
                            <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "14px", lineHeight: 1.6, color: "var(--caution)" }}>{sr.risks}</p>
                          </div>
                        </div>
                      )}

                      {/* RECOMMENDATION */}
                      {sr.recommendation && (
                        <div>
                          <div className="mb-2" style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "var(--ghost)", textTransform: "uppercase" }}>RECOMMENDATION</div>
                          <div className="flex items-start gap-2" style={{ background: "rgba(0, 212, 255, 0.04)", borderRadius: "4px", padding: "12px", borderLeft: "2px solid var(--volt)" }}>
                            <ArrowRight size={14} style={{ color: "var(--volt)", marginTop: "3px", flexShrink: 0 }} />
                            <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "14px", fontWeight: 500, lineHeight: 1.6, color: "var(--paper)" }}>{sr.recommendation}</p>
                          </div>
                        </div>
                      )}
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
                      <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "var(--ghost)", textTransform: "uppercase" }}>ANSWER</span>
                      <div style={{ flex: 1, height: "1px", background: "var(--rule)" }} />
                      <div className="flex items-center gap-1">
                        <div className="animate-dot-1 w-1.5 h-1.5 rounded-full" style={{ background: "var(--volt)" }} />
                        <div className="animate-dot-2 w-1.5 h-1.5 rounded-full" style={{ background: "var(--volt)" }} />
                        <div className="animate-dot-3 w-1.5 h-1.5 rounded-full" style={{ background: "var(--volt)" }} />
                      </div>
                    </div>
                    <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "15px", lineHeight: 1.6, color: "var(--paper)" }}>
                      {streamingAnswer}
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
                    </p>
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
              style={{ background: "var(--graphite)", border: "1px solid var(--rule)", minHeight: "52px", transition: "border-color 0.2s" }}
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
