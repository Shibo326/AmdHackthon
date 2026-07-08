import type {
  AnalyzeResponse,
  ChatResponse,
  DemoResponse,
  UploadResponse,
} from './types';

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';

/**
 * Upload one or more files for analysis.
 * POST /api/upload — multipart/form-data
 */
export async function uploadDocuments(files: File[]): Promise<UploadResponse> {
  const url = `${API_BASE_URL}/api/upload`;
  console.log(`[API] POST ${url} — uploading ${files.length} file(s):`, files.map((f) => f.name));

  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  console.log(`[API] POST ${url} → ${response.status}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(error.error ?? `Upload failed: ${response.status}`);
  }

  return response.json() as Promise<UploadResponse>;
}

/**
 * Run full AI analysis on a session's uploaded documents.
 * POST /api/analyze
 */
export async function analyzeDocuments(sessionId: string): Promise<AnalyzeResponse> {
  const url = `${API_BASE_URL}/api/analyze`;
  console.log(`[API] POST ${url} — sessionId=${sessionId}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });

  console.log(`[API] POST ${url} → ${response.status}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Analysis failed' }));
    throw new Error(error.error ?? `Analysis failed: ${response.status}`);
  }

  return response.json() as Promise<AnalyzeResponse>;
}

/**
 * Send a chat message and receive a structured AI response.
 * POST /api/chat
 */
export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function sendChatMessage(
  sessionId: string,
  question: string,
  history: ChatHistoryMessage[] = [],
): Promise<ChatResponse> {
  const url = `${API_BASE_URL}/api/chat`;
  console.log(`[API] POST ${url} — sessionId=${sessionId}, question="${question}"`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, question, history }),
  });

  console.log(`[API] POST ${url} → ${response.status}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Chat failed' }));
    throw new Error(error.error ?? `Chat failed: ${response.status}`);
  }

  return response.json() as Promise<ChatResponse>;
}

/**
 * Export the analysis report as a downloadable Blob.
 * POST /api/report
 * Supports "pdf" and "docx" formats.
 */
export async function exportReport(
  sessionId: string,
  format: 'pdf' | 'docx' = 'pdf',
): Promise<Blob> {
  const url = `${API_BASE_URL}/api/report`;
  console.log(`[API] POST ${url} — sessionId=${sessionId}, format=${format}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, format }),
  });

  console.log(`[API] POST ${url} → ${response.status}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Export failed' }));
    throw new Error(error.error ?? `Export failed: ${response.status}`);
  }

  return response.blob();
}

/**
 * Generate contextually-relevant quick questions based on uploaded documents.
 * POST /api/suggest-questions
 */
export async function getSuggestedQuestions(sessionId: string): Promise<string[]> {
  const url = `${API_BASE_URL}/api/suggest-questions`;
  console.log(`[API] POST ${url} — sessionId=${sessionId}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });

  console.log(`[API] POST ${url} → ${response.status}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to generate questions' }));
    throw new Error(error.error ?? `Question generation failed: ${response.status}`);
  }

  const data = await response.json();
  return data.questions ?? [];
}

/**
 * Check if a session still exists on the backend.
 * Used on app load to detect stale localStorage sessions.
 * GET /api/session/:id/check
 */
export async function checkSession(sessionId: string): Promise<boolean> {
  const url = `${API_BASE_URL}/api/session/${sessionId}/check`;
  try {
    const response = await fetch(url, { method: 'GET' });
    return response.ok;
  } catch {
    // If network is down, assume session is still valid to avoid false clears
    return true;
  }
}

/**
 * Stream a chat response using Server-Sent Events.
 * POST /api/chat/stream
 * Calls onToken for each word, onDone with final structured response.
 *
 * Returns an AbortController — call controller.abort() to cancel mid-stream.
 * Always call abort() in your useEffect cleanup to prevent state updates on
 * unmounted components when the user navigates away during streaming.
 */
export function streamChatMessage(
  sessionId: string,
  question: string,
  history: ChatHistoryMessage[],
  onToken: (text: string) => void,
  onDone: (response: ChatResponse) => void,
  onError: (error: string) => void,
): { abort: () => void; promise: Promise<void> } {
  const controller = new AbortController();
  const url = `${API_BASE_URL}/api/chat/stream`;

  const promise = (async (): Promise<void> => {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, question, history }),
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return; // intentional cancel
      onError(e instanceof Error ? e.message : 'Network error');
      return;
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Stream failed' }));
      onError(err.error ?? `Stream failed: ${response.status}`);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) { onError('No response body'); return; }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      let done: boolean, value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return; // intentional cancel
        break;
      }
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        try {
          const event = JSON.parse(raw) as {
            type: string; text?: string; error?: string; code?: string;
            messageId?: string; role?: string;
            structuredResponse?: ChatResponse['structuredResponse'];
            processingTimeMs?: number;
          };

          if (event.type === 'token' && event.text) {
            onToken(event.text);
          } else if (event.type === 'done') {
            onDone({
              messageId: event.messageId ?? '',
              role: event.role ?? 'assistant',
              structuredResponse: event.structuredResponse!,
              processingTimeMs: event.processingTimeMs ?? 0,
            });
          } else if (event.type === 'error') {
            onError(event.error ?? 'Unknown error');
          }
        } catch {
          // skip malformed lines
        }
      }
    }
  })();

  return { abort: () => controller.abort(), promise };
}

/**
 * Fetch pre-loaded demo data (no auth required).
 * GET /api/demo
 */
export async function getDemoData(): Promise<DemoResponse> {
  const url = `${API_BASE_URL}/api/demo`;
  console.log(`[API] GET ${url}`);

  const response = await fetch(url, {
    method: 'GET',
  });

  console.log(`[API] GET ${url} → ${response.status}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to load demo' }));
    throw new Error(error.error ?? `Demo failed: ${response.status}`);
  }

  return response.json() as Promise<DemoResponse>;
}
