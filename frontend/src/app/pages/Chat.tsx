import { useEffect, useRef, useState } from "react";
import { NavigationBar } from "../components/NavigationBar";
import { GhostButton, PrimaryButton } from "../components/Buttons";
import { EvidenceTag } from "../components/Badges";
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
import { useAppState } from "../../lib/store";
import { Link } from "react-router";
import type { StructuredAIResponse } from "../../lib/types";

const fallbackQuestions = [
  "Summarize this document",
  "What are the key points?",
  "Any concerns?",
  "What should I do next?",
  "What's missing?",
  "Compare the options",
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      <div className="min-h-screen" style={{ background: "#080D1A" }}>
        <NavigationBar showDemo={false} />
        <div className="flex flex-col items-center pt-24 gap-6 px-4 animate-fadeIn">
          <div className="px-6 py-6 rounded-xl text-center w-full" style={{ background: "#0D1528", border: "1px solid #1E2D4A", maxWidth: "480px" }}>
            <FileText size={40} style={{ color: "#4A5878", margin: "0 auto 16px" }} />
            <h2 style={{ fontFamily: "DM Sans, sans-serif", fontSize: "20px", fontWeight: 600, color: "#F0F4FF", marginBottom: "8px" }}>
              No active session
            </h2>
            <p style={{ fontFamily: "Inter, sans-serif", fontSize: "15px", lineHeight: 1.6, color: "#8B9CC8", marginBottom: "20px" }}>
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

  const SidebarContent = () => (
    <>
      <div className="p-4">
        <h3 style={{ fontFamily: "Inter, sans-serif", fontSize: "13px", fontWeight: 500, color: "#8B9CC8", marginBottom: "12px" }}>
          Active Documents
        </h3>
        <div className="space-y-1">
          {documents.map((doc) => {
            const isImage = doc.fileType === "image";
            return (
              <div
                key={doc.id}
                className="px-3 py-3 rounded-lg"
                style={{ borderLeft: "2px solid transparent", transition: "background 0.15s, border-color 0.15s", cursor: "default" }}
                onMouseOver={(e) => { e.currentTarget.style.background = "#111E35"; e.currentTarget.style.borderLeftColor = "#3B7BF6"; }}
                onMouseOut={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderLeftColor = "transparent"; }}
              >
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center rounded shrink-0" style={{ width: "20px", height: "20px", background: isImage ? "rgba(59,123,246,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${isImage ? "rgba(59,123,246,0.3)" : "rgba(239,68,68,0.3)"}` }}>
                    <span style={{ fontFamily: "Inter, sans-serif", fontSize: "8px", fontWeight: 600, color: isImage ? "#3B7BF6" : "#EF4444" }}>
                      {isImage ? "IMG" : "PDF"}
                    </span>
                  </div>
                  <div className="truncate" style={{ fontFamily: "Inter, sans-serif", fontSize: "13px", fontWeight: 500, color: "#F0F4FF" }}>
                    {doc.filename}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ height: "1px", background: "#1E2D4A", margin: "8px 0" }} />

      <div className="px-4 pb-4">
        <div className="mb-3 flex items-center gap-2" style={{ fontFamily: "Inter, sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "#4A5878", textTransform: "uppercase" }}>
          <Sparkles size={12} style={{ color: "#4A5878" }} />
          QUICK QUESTIONS
        </div>
        <div className="flex flex-col gap-2">
          {questionsLoading ? (
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="animate-dot-1 w-1.5 h-1.5 rounded-full" style={{ background: "#3B7BF6" }} />
              <div className="animate-dot-2 w-1.5 h-1.5 rounded-full" style={{ background: "#3B7BF6" }} />
              <div className="animate-dot-3 w-1.5 h-1.5 rounded-full" style={{ background: "#3B7BF6" }} />
              <span style={{ fontFamily: "Inter, sans-serif", fontSize: "12px", color: "#4A5878" }}>Generating…</span>
            </div>
          ) : (
            quickQuestions.map((q, idx) => (
              <button
                key={idx}
                className="px-3 py-2 rounded-lg border text-left transition-all"
                style={{ background: "#111E35", borderColor: "#1E2D4A", fontFamily: "Inter, sans-serif", fontSize: "13px", color: "#8B9CC8", cursor: "pointer" }}
                onMouseOver={(e) => { e.currentTarget.style.borderColor = "#3B7BF6"; e.currentTarget.style.color = "#F0F4FF"; }}
                onMouseOut={(e) => { e.currentTarget.style.borderColor = "#1E2D4A"; e.currentTarget.style.color = "#8B9CC8"; }}
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
    <div className="flex flex-col" style={{ height: "100dvh", background: "#080D1A" }}>
      <NavigationBar showDemo={false} />

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop left panel */}
        <div
          className="hidden md:flex flex-col shrink-0"
          style={{ width: "280px", background: "#0D1528", borderRight: "1px solid #1E2D4A", overflowY: "auto" }}
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
                <span style={{ fontFamily: "DM Sans, sans-serif", fontSize: "15px", fontWeight: 600, color: "#F0F4FF" }}>Documents & Questions</span>
                <button onClick={() => setSidebarOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#8B9CC8" }}>
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
            className="flex items-center justify-between px-4 sm:px-6 h-14 shrink-0"
            style={{ background: "#0D1528", borderBottom: "1px solid #1E2D4A" }}
          >
            <div className="flex items-center gap-3">
              {/* Mobile sidebar toggle */}
              <button
                className="md:hidden flex items-center justify-center"
                onClick={() => setSidebarOpen(true)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#8B9CC8", padding: "4px", marginRight: "4px" }}
              >
                <PanelLeft size={18} />
              </button>

              {/* AI Avatar */}
              <div className="relative shrink-0">
                <div style={{ width: "36px", height: "36px", position: "relative" }}>
                  <div style={{ width: "36px", height: "36px", clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)", background: "linear-gradient(135deg, #1E2D4A, #0D1528)", border: "2px solid #3B7BF6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontFamily: "DM Sans, sans-serif", fontSize: "11px", fontWeight: "bold", color: "#3B7BF6" }}>AI</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col min-w-0">
                <div style={{ fontFamily: "DM Sans, sans-serif", fontSize: "15px", fontWeight: 600, color: "#F0F4FF" }}>
                  Decision Copilot
                </div>
                <div className="flex items-center gap-2">
                  <span style={{ fontFamily: "Inter, sans-serif", fontSize: "11px", fontWeight: 500, color: "#10B981", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "200px" }}>
                    {docCount} doc{docCount !== 1 ? "s" : ""} · AMD MI300X active
                  </span>
                  {isThinking && (
                    <div className="flex items-center gap-1">
                      <div className="animate-dot-1 w-1.5 h-1.5 rounded-full" style={{ background: "#3B7BF6" }} />
                      <div className="animate-dot-2 w-1.5 h-1.5 rounded-full" style={{ background: "#3B7BF6" }} />
                      <div className="animate-dot-3 w-1.5 h-1.5 rounded-full" style={{ background: "#3B7BF6" }} />
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
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5" style={{ background: "#080D1A" }}>
            {messages.map((msg) => {
              if (msg.role === "user") {
                return (
                  <div key={msg.id} className="flex justify-end animate-slideUp">
                    <div style={{ maxWidth: "min(520px, 85vw)" }}>
                      <div className="rounded-2xl px-4 py-3" style={{ background: "#1E2D4A", borderRadius: "16px 16px 4px 16px" }}>
                        <p style={{ fontFamily: "Inter, sans-serif", fontSize: "15px", lineHeight: 1.6, color: "#F0F4FF" }}>
                          {msg.content}
                        </p>
                      </div>
                      <div className="text-right mt-1">
                        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#4A5878" }}>
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
                    <div className="rounded-2xl p-4 sm:p-5" style={{ background: "#0D1528", border: "1px solid #1E2D4A", borderLeft: "3px solid #3B7BF6", borderRadius: "4px 16px 16px 16px" }}>
                      {/* ANSWER */}
                      <div className="mb-4">
                        <div className="flex items-center gap-2 mb-3">
                          <span style={{ fontFamily: "Inter, sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "#4A5878", textTransform: "uppercase" }}>ANSWER</span>
                          <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.06)" }} />
                        </div>
                        <p style={{ fontFamily: "Inter, sans-serif", fontSize: "15px", lineHeight: 1.6, color: "#F0F4FF" }}>{sr.answer}</p>
                      </div>

                      {/* EVIDENCE */}
                      {sr.evidence.length > 0 && (
                        <div className="mb-4">
                          <div className="mb-2" style={{ fontFamily: "Inter, sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "#4A5878", textTransform: "uppercase" }}>EVIDENCE</div>
                          <div className="space-y-2">
                            {sr.evidence.map((ev, i) => (
                              <div
                                key={i}
                                className="pl-3 py-2 rounded-r-md"
                                style={{
                                  borderLeft: "2px solid rgba(59,123,246,0.3)",
                                  background: "rgba(59,123,246,0.04)",
                                  cursor: "pointer",
                                  transition: "background 0.15s, border-left-color 0.15s",
                                }}
                                onClick={() => setSourceModal({ quote: ev.quote, source: ev.sourceDocument, docType: ev.documentType })}
                                onMouseOver={(e) => { e.currentTarget.style.background = "rgba(59,123,246,0.09)"; e.currentTarget.style.borderLeftColor = "#3B7BF6"; }}
                                onMouseOut={(e) => { e.currentTarget.style.background = "rgba(59,123,246,0.04)"; e.currentTarget.style.borderLeftColor = "rgba(59,123,246,0.3)"; }}
                                title="Click to view source"
                              >
                                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "13px", color: "#F0F4FF", marginBottom: "4px", wordBreak: "break-word" }}>"{ev.quote}"</p>
                                <div className="flex items-center justify-between">
                                  <EvidenceTag filename={ev.sourceDocument} />
                                  <span style={{ fontFamily: "Inter, sans-serif", fontSize: "10px", color: "#3B7BF6", fontWeight: 500 }}>View source →</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* RISK */}
                      {sr.risks && (
                        <div className="mb-4">
                          <div className="mb-2" style={{ fontFamily: "Inter, sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "#4A5878", textTransform: "uppercase" }}>RISK</div>
                          <div className="flex items-start gap-2">
                            <AlertTriangle size={14} style={{ color: "#F59E0B", marginTop: "3px", flexShrink: 0 }} />
                            <p style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", lineHeight: 1.6, color: "#F59E0B" }}>{sr.risks}</p>
                          </div>
                        </div>
                      )}

                      {/* RECOMMENDATION */}
                      {sr.recommendation && (
                        <div>
                          <div className="mb-2" style={{ fontFamily: "Inter, sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "#4A5878", textTransform: "uppercase" }}>RECOMMENDATION</div>
                          <div className="p-3 rounded-lg flex items-start gap-2" style={{ background: "rgba(16,185,129,0.04)" }}>
                            <ArrowRight size={14} style={{ color: "#10B981", marginTop: "3px", flexShrink: 0 }} />
                            <p style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", lineHeight: 1.6, color: "#10B981" }}>{sr.recommendation}</p>
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
                  <div className="rounded-2xl p-4 sm:p-5" style={{ background: "#0D1528", border: "1px solid #1E2D4A", borderLeft: "3px solid #3B7BF6", borderRadius: "4px 16px 16px 16px" }}>
                    <div className="mb-2 flex items-center gap-2">
                      <span style={{ fontFamily: "Inter, sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "#4A5878", textTransform: "uppercase" }}>ANSWER</span>
                      <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.06)" }} />
                      <div className="flex items-center gap-1">
                        <div className="animate-dot-1 w-1.5 h-1.5 rounded-full" style={{ background: "#3B7BF6" }} />
                        <div className="animate-dot-2 w-1.5 h-1.5 rounded-full" style={{ background: "#3B7BF6" }} />
                        <div className="animate-dot-3 w-1.5 h-1.5 rounded-full" style={{ background: "#3B7BF6" }} />
                      </div>
                    </div>
                    <p style={{ fontFamily: "Inter, sans-serif", fontSize: "15px", lineHeight: 1.6, color: "#F0F4FF" }}>
                      {streamingAnswer}
                      <span
                        style={{
                          display: "inline-block",
                          width: "2px",
                          height: "1em",
                          background: "#3B7BF6",
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
                <div className="px-4 py-4 rounded-2xl" style={{ background: "#0D1528", border: "1px solid #1E2D4A", borderLeft: "3px solid #3B7BF6", borderRadius: "4px 16px 16px 16px" }}>
                  <div className="flex items-center gap-3">
                    <div className="animate-dot-1 w-2 h-2 rounded-full" style={{ background: "#3B7BF6" }} />
                    <div className="animate-dot-2 w-2 h-2 rounded-full" style={{ background: "#3B7BF6" }} />
                    <div className="animate-dot-3 w-2 h-2 rounded-full" style={{ background: "#3B7BF6" }} />
                    <span style={{ fontFamily: "Inter, sans-serif", fontSize: "13px", color: "#4A5878" }}>Clausify AI is thinking…</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input */}
          <div className="px-4 sm:px-6 py-4 shrink-0 safe-bottom" style={{ background: "#0D1528", borderTop: "1px solid #1E2D4A" }}>
            <div
              className="flex items-center gap-3 px-4 rounded-2xl"
              style={{ background: "#111E35", border: "1px solid #1E2D4A", minHeight: "52px", transition: "border-color 0.2s" }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "#3B7BF6"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "#1E2D4A"; }}
            >
              <Paperclip size={18} style={{ color: "#4A5878", flexShrink: 0 }} />
              <input
                ref={inputRef}
                type="text"
                placeholder="Ask anything about your documents…"
                className="flex-1 bg-transparent border-none outline-none"
                style={{ fontFamily: "Inter, sans-serif", fontSize: "15px", color: "#F0F4FF", minWidth: 0 }}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isThinking || isStreaming}
              />
              <button
                className="flex items-center justify-center rounded-full shrink-0"
                style={{ width: "36px", height: "36px", background: isThinking || isStreaming || !inputValue.trim() ? "#1E2D4A" : "#3B7BF6", border: "none", cursor: isThinking || isStreaming || !inputValue.trim() ? "not-allowed" : "pointer", transition: "background 0.2s, opacity 0.2s", opacity: isThinking || isStreaming || !inputValue.trim() ? 0.5 : 1 }}
                onClick={() => void handleSubmit(inputValue)}
                disabled={isThinking || isStreaming || !inputValue.trim()}
              >
                <Send size={16} style={{ color: "#F0F4FF" }} />
              </button>
            </div>
            <div className="text-center mt-2">
              <span style={{ fontFamily: "Inter, sans-serif", fontSize: "11px", fontWeight: 500, color: "#4A5878" }}>
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
              background: "#0D1528",
              border: "1px solid rgba(59,123,246,0.3)",
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
                    background: sourceModal.docType === "image" ? "#3B7BF6" : "#EF4444",
                  }}
                />
                <span style={{ fontFamily: "Inter, sans-serif", fontSize: "13px", fontWeight: 600, color: "#8B9CC8" }}>
                  {sourceModal.source}
                </span>
              </div>
              <button
                onClick={() => setSourceModal(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#4A5878", display: "flex", alignItems: "center" }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Label */}
            <div style={{ fontFamily: "Inter, sans-serif", fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#4A5878", marginBottom: "8px" }}>
              DOCUMENT EXCERPT
            </div>

            {/* Quote */}
            <div
              className="rounded-xl p-4"
              style={{
                background: "rgba(59,123,246,0.04)",
                border: "1px solid rgba(59,123,246,0.15)",
                borderLeft: "3px solid #3B7BF6",
              }}
            >
              <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "14px", lineHeight: 1.7, color: "#F0F4FF", wordBreak: "break-word" }}>
                "{sourceModal.quote}"
              </p>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setSourceModal(null)}
                style={{
                  fontFamily: "Inter, sans-serif", fontSize: "13px", fontWeight: 500,
                  color: "#3B7BF6", background: "none", border: "none", cursor: "pointer",
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
