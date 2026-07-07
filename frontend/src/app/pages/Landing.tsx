import { useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router";
import { NavigationBar } from "../components/NavigationBar";
import { PrimaryButton } from "../components/Buttons";
import {
  Upload,
  X,
  FileText,
  Cpu,
  Sparkles,
  Zap,
  File,
  CheckCircle,
  Loader,
} from "lucide-react";
import { Link } from "react-router";
import { uploadDocuments, analyzeDocuments } from "../../lib/api";
import { toast } from "sonner";
import { useAppDispatch } from "../../lib/store";

const LOADING_STAGES = [
  { label: "Extracting text", icon: "📄" },
  { label: "AMD embeddings", icon: "⚡" },
  { label: "Running analysis", icon: "🧠" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Landing() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
      e.target.value = "";
    }
  };

  const addFiles = (incoming: File[]) => {
    setError(null);
    const accepted = incoming.filter((f) => {
      const mime = f.type.toLowerCase();
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      return (
        ["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/jfif", "image/pjpeg"].includes(mime) ||
        ["pdf", "png", "jpg", "jpeg", "jfif", "jpe"].includes(ext)
      );
    });
    const rejected = incoming.length - accepted.length;
    if (rejected > 0) setError(`${rejected} file(s) skipped — only PDF, PNG, JPEG, and JFIF are supported.`);
    setFiles((prev) => {
      const combined = [...prev, ...accepted];
      if (combined.length > 10) {
        setError("You can upload up to 10 files at a time.");
        return combined.slice(0, 10);
      }
      return combined;
    });
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAnalyze = async () => {
    if (!files.length) return;
    setError(null);
    setIsLoading(true);
    dispatch({ type: "RESET" });
    setLoadingStage(0);
    const stageTimers = [
      setTimeout(() => setLoadingStage(1), 1400),
      setTimeout(() => setLoadingStage(2), 2800),
    ];
    try {
      const uploadResult = await uploadDocuments(files);
      stageTimers.forEach(clearTimeout);
      setLoadingStage(2);
      dispatch({ type: "SET_SESSION", payload: uploadResult.sessionId });
      dispatch({ type: "SET_DOCUMENTS", payload: uploadResult.documents });
      const analyzeResult = await analyzeDocuments(uploadResult.sessionId);
      dispatch({ type: "SET_ANALYSIS", payload: analyzeResult.analysis });
      setIsLoading(false);
      navigate("/dashboard");
    } catch (err) {
      stageTimers.forEach(clearTimeout);
      const rawMsg = err instanceof Error ? err.message : "Something went wrong. Please try again.";

      // Map common network/fetch errors to a clear actionable message
      const isNetworkError =
        rawMsg.toLowerCase().includes("failed to fetch") ||
        rawMsg.toLowerCase().includes("network") ||
        rawMsg.toLowerCase().includes("fetch") ||
        rawMsg.toLowerCase().includes("networkerror") ||
        rawMsg.toLowerCase().includes("load failed");

      const msg = isNetworkError
        ? "Cannot reach the server. Make sure the backend is running on port 8000."
        : rawMsg;

      setError(msg);
      if (isNetworkError) {
        toast.error("Backend offline — run: uvicorn main:app --port 8000");
      }
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: "#080D1A" }}>
      <NavigationBar />

      {/* Hero */}
      <div className="flex flex-col items-center px-4 pt-12 sm:pt-16 md:pt-20 animate-fadeIn">
        {/* Event badge */}
        <div
          className="flex items-center gap-2 px-4 py-2 rounded-full mb-8 sm:mb-10"
          style={{
            background: "rgba(59, 123, 246, 0.08)",
            border: "1px solid rgba(59, 123, 246, 0.2)",
          }}
        >
          <Zap size={14} style={{ color: "#3B7BF6" }} />
          <span style={{ fontFamily: "Inter, sans-serif", fontSize: "13px", fontWeight: 500, color: "#3B7BF6" }}>
            AMD Developer Hackathon: ACT II
          </span>
        </div>

        {/* Headline */}
        <h1
          className="text-center mb-5 animate-slideUp"
          style={{
            fontFamily: "DM Sans, sans-serif",
            fontSize: "clamp(28px, 6vw, 56px)",
            fontWeight: "bold",
            lineHeight: 1.15,
            color: "#F0F4FF",
            maxWidth: "min(720px, 90vw)",
          }}
        >
          Your documents speak.<br />We translate them into decisions.
        </h1>

        {/* Subheadline */}
        <p
          className="text-center mb-8 animate-slideUp"
          style={{
            animationDelay: "0.08s",
            fontFamily: "Inter, sans-serif",
            fontSize: "clamp(14px, 2.5vw, 18px)",
            lineHeight: 1.6,
            color: "#8B9CC8",
            maxWidth: "min(580px, 90vw)",
          }}
        >
          Upload contracts, quotations, and invoices. Ask anything in plain
          language. Get evidence-based decisions in under 60 seconds — powered
          by AMD Instinct MI300X.
        </p>

        {/* Stats Row */}
        <div
          className="flex items-center justify-center flex-wrap gap-6 sm:gap-10 mb-10 animate-slideUp"
          style={{ animationDelay: "0.15s" }}
        >
          {[
            { value: "< 60s", label: "Analysis time", color: "#F0F4FF" },
            { value: "5.6x",  label: "Faster on AMD GPU", color: "#3B7BF6" },
            { value: "100%",  label: "Evidence-based", color: "#F0F4FF" },
          ].map((stat, i) => (
            <div key={i} className="flex flex-col items-center">
              <div style={{ fontFamily: "DM Sans, sans-serif", fontSize: "clamp(22px, 4vw, 32px)", fontWeight: "bold", color: stat.color }}>
                {stat.value}
              </div>
              <div style={{ fontFamily: "Inter, sans-serif", fontSize: "12px", fontWeight: 500, color: "#8B9CC8" }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Upload Zone */}
      <div className="flex flex-col items-center px-4 mb-6">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.jfif,.jpe,application/pdf,image/png,image/jpeg"
          style={{ display: "none" }}
          onChange={handleFileInputChange}
        />

        <div
          className="flex flex-col items-center justify-center rounded-2xl w-full animate-slideUp"
          style={{
            maxWidth: "min(720px, 100%)",
            minHeight: files.length > 0 ? "auto" : "260px",
            background: isDragging
              ? "radial-gradient(ellipse at center, rgba(59,123,246,0.06) 0%, #0D1528 70%)"
              : "radial-gradient(ellipse at center, rgba(59,123,246,0.03) 0%, #0D1528 70%)",
            border: `2px dashed ${isDragging ? "#3B7BF6" : "#1E2D4A"}`,
            boxShadow: isDragging
              ? "0 0 60px rgba(59,123,246,0.15)"
              : "0 0 40px rgba(59,123,246,0.06)",
            padding: files.length > 0 ? "24px" : "clamp(24px, 5vw, 40px) clamp(16px, 4vw, 28px)",
            transition: "border-color 0.2s, box-shadow 0.3s, background 0.3s",
            cursor: isLoading ? "default" : "pointer",
            animationDelay: "0.2s",
            position: "relative",
            overflow: "hidden",
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => { if (!isLoading) fileInputRef.current?.click(); }}
        >
          {/* Scan line effect when dragging */}
          {isDragging && <div className="scan-line" />}

          {files.length === 0 ? (
            <>
              {/* Upload icon with glow */}
              <div className="relative mb-5 flex items-center justify-center">
                <div style={{ width: "80px", height: "80px", background: "rgba(59,123,246,0.08)", borderRadius: "50%", position: "absolute" }} />
                <div style={{ width: "56px", height: "56px", background: "rgba(59,123,246,0.12)", borderRadius: "50%", position: "absolute" }} />
                <Upload size={28} style={{ color: "#3B7BF6", position: "relative", zIndex: 1 }} />
              </div>

              <h3 style={{ fontFamily: "DM Sans, sans-serif", fontSize: "clamp(16px, 3vw, 20px)", fontWeight: 600, color: "#F0F4FF", marginBottom: "8px", textAlign: "center" }}>
                Drop your business documents here
              </h3>
              <p style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", color: "#4A5878", marginBottom: "14px", textAlign: "center" }}>
                PDF, PNG, JPG, JPEG, JFIF — up to 10 files, 10MB each
              </p>
              <span style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", fontWeight: 500, color: "#3B7BF6", textDecoration: "underline", marginBottom: "18px" }}>
                or browse files
              </span>

              <div className="flex flex-wrap gap-2 justify-center">
                {["PDF", "PNG", "JPG", "JPEG", "JFIF"].map((fmt) => (
                  <div key={fmt} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md" style={{ background: "#111E35", border: "1px solid #1E2D4A" }}>
                    <File size={11} style={{ color: "#4A5878" }} />
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#4A5878" }}>{fmt}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ width: "100%" }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <span style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", fontWeight: 500, color: "#8B9CC8" }}>
                  {files.length} file{files.length !== 1 ? "s" : ""} selected
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  style={{ fontFamily: "Inter, sans-serif", fontSize: "12px", fontWeight: 500, color: "#3B7BF6", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                >
                  + Add more
                </button>
              </div>

              <div className="space-y-2 mb-4">
                {files.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "#111E35", border: "1px solid #1E2D4A" }}>
                    <FileText size={16} style={{ color: "#3B7BF6", flexShrink: 0 }} />
                    <span className="flex-1 truncate" style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", color: "#F0F4FF" }}>
                      {file.name}
                    </span>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#4A5878", flexShrink: 0 }}>
                      {formatBytes(file.size)}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#4A5878", flexShrink: 0, display: "flex", alignItems: "center" }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div
            className="mt-3 px-4 py-3 rounded-lg w-full animate-slideDown"
            style={{ maxWidth: "min(720px, 100%)", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", fontFamily: "Inter, sans-serif", fontSize: "14px", color: "#EF4444" }}
          >
            {error}
          </div>
        )}

        {/* Analyze button */}
        {files.length > 0 && !isLoading && (
          <div className="mt-5 animate-slideUp">
            <PrimaryButton onClick={handleAnalyze}>
              Analyze {files.length} Document{files.length !== 1 ? "s" : ""}
            </PrimaryButton>
          </div>
        )}

        {/* Loading state — improved */}
        {isLoading && (
          <div className="mt-5 flex flex-col items-center gap-5 w-full animate-fadeIn" style={{ maxWidth: "min(720px, 100%)" }}>
            {/* AMD-style processing card */}
            <div
              className="w-full rounded-xl p-5"
              style={{
                background: "#0D1528",
                border: "1px solid rgba(59,123,246,0.3)",
                boxShadow: "0 0 30px rgba(59,123,246,0.08)",
                animation: "borderPulse 2s ease-in-out infinite",
              }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "rgba(59,123,246,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Loader size={16} style={{ color: "#3B7BF6" }} className="animate-spin-slow" />
                </div>
                <div>
                  <div style={{ fontFamily: "DM Sans, sans-serif", fontSize: "15px", fontWeight: 600, color: "#F0F4FF" }}>
                    AMD MI300X Processing
                  </div>
                  <div style={{ fontFamily: "Inter, sans-serif", fontSize: "12px", color: "#4A5878" }}>
                    {LOADING_STAGES[loadingStage].label}…
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ height: "4px", background: "#1E2D4A", borderRadius: "2px", overflow: "hidden", marginBottom: "16px" }}>
                <div
                  className="shimmer-bar"
                  style={{
                    height: "100%",
                    borderRadius: "2px",
                    width: `${((loadingStage + 1) / LOADING_STAGES.length) * 100}%`,
                    transition: "width 0.6s ease",
                  }}
                />
              </div>

              {/* Stage steps */}
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-0 sm:items-center">
                {LOADING_STAGES.map((stage, i) => (
                  <div key={i} className="flex items-center gap-2 flex-1">
                    {i > 0 && (
                      <div
                        className="hidden sm:block"
                        style={{ flex: 1, height: "1px", background: i <= loadingStage ? "#3B7BF6" : "#1E2D4A", transition: "background 0.4s", margin: "0 8px" }}
                      />
                    )}
                    <div className="flex items-center gap-2">
                      {i < loadingStage ? (
                        <CheckCircle size={16} style={{ color: "#10B981", flexShrink: 0 }} />
                      ) : i === loadingStage ? (
                        <div
                          style={{
                            width: "16px", height: "16px", borderRadius: "50%",
                            border: "2px solid #3B7BF6",
                            borderTopColor: "transparent",
                            flexShrink: 0,
                          }}
                          className="animate-spin-slow"
                        />
                      ) : (
                        <div style={{ width: "16px", height: "16px", borderRadius: "50%", border: "2px solid #1E2D4A", flexShrink: 0 }} />
                      )}
                      <span
                        style={{
                          fontFamily: "Inter, sans-serif",
                          fontSize: "13px",
                          fontWeight: i === loadingStage ? 600 : 400,
                          color: i < loadingStage ? "#10B981" : i === loadingStage ? "#F0F4FF" : "#4A5878",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {stage.label}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* AMD Trust Strip */}
      <div
        className="w-full py-4 flex items-center justify-center gap-2 mt-4"
        style={{ background: "rgba(59,123,246,0.04)", borderTop: "1px solid rgba(59,123,246,0.08)", borderBottom: "1px solid rgba(59,123,246,0.08)" }}
      >
        <Zap size={14} style={{ color: "#4A5878" }} />
        <p style={{ fontFamily: "Inter, sans-serif", fontSize: "clamp(11px, 2vw, 12px)", fontWeight: 500, color: "#4A5878", textAlign: "center" }}>
          Running on AMD Instinct MI300X · ROCm-powered embeddings · Enterprise-grade inference
        </p>
      </div>

      {/* How It Works */}
      <div className="flex flex-col items-center px-4 py-16">
        <p style={{ fontFamily: "Inter, sans-serif", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#4A5878", marginBottom: "10px" }}>
          HOW IT WORKS
        </p>
        <h2 style={{ fontFamily: "DM Sans, sans-serif", fontSize: "clamp(20px, 4vw, 28px)", fontWeight: 600, color: "#F0F4FF", marginBottom: "40px", textAlign: "center" }}>
          From documents to decisions in 3 steps
        </h2>

        <div className="grid gap-5 w-full" style={{ maxWidth: "min(1040px, 100%)", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {[
            { num: "01", Icon: Upload,   title: "Upload Documents",        desc: "Drop your PDFs, contracts, quotations, invoices — any business document" },
            { num: "02", Icon: Cpu,      title: "AMD AI Analyzes",          desc: "Our AMD-powered AI reads all files simultaneously, detects conflicts across documents" },
            { num: "03", Icon: Sparkles, title: "Make Better Decisions",    desc: "Ask questions in plain language. Get evidence-backed answers with exact source citations" },
          ].map(({ num, Icon, title, desc }) => (
            <div
              key={num}
              className="rounded-xl p-6"
              style={{
                background: "#0D1528",
                border: "1px solid #1E2D4A",
                transition: "border-color 0.2s, transform 0.15s",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = "rgba(59,123,246,0.3)";
                e.currentTarget.style.transform = "scale(1.02)";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = "#1E2D4A";
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              <div style={{ fontFamily: "DM Sans, sans-serif", fontSize: "36px", fontWeight: "bold", color: "rgba(59,123,246,0.2)", marginBottom: "10px" }}>{num}</div>
              <Icon size={26} style={{ color: "#3B7BF6", marginBottom: "14px" }} />
              <h3 style={{ fontFamily: "DM Sans, sans-serif", fontSize: "18px", fontWeight: 600, color: "#F0F4FF", marginBottom: "8px" }}>{title}</h3>
              <p style={{ fontFamily: "Inter, sans-serif", fontSize: "15px", lineHeight: 1.6, color: "#8B9CC8" }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Demo CTA */}
      <div className="flex justify-center px-4 pb-16">
        <div
          className="flex flex-col items-center rounded-2xl px-6 py-8 w-full"
          style={{ maxWidth: "min(600px, 100%)", background: "rgba(59,123,246,0.04)", border: "1px solid rgba(59,123,246,0.12)" }}
        >
          <h3 style={{ fontFamily: "DM Sans, sans-serif", fontSize: "clamp(16px, 3vw, 20px)", fontWeight: 600, color: "#F0F4FF", marginBottom: "8px", textAlign: "center" }}>
            See it in action — no upload needed
          </h3>
          <p style={{ fontFamily: "Inter, sans-serif", fontSize: "15px", color: "#8B9CC8", marginBottom: "20px", textAlign: "center" }}>
            Try with pre-loaded procurement documents
          </p>
          <Link to="/demo">
            <PrimaryButton>Try Demo</PrimaryButton>
          </Link>
        </div>
      </div>
    </div>
  );
}
