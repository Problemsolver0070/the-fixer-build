// src/lib/ai/types.ts

// ─── SSE Event Types ─────────────────────────────────────────────────────────
// These are the typed events yielded by the stream handler and consumed by
// both the Next.js route (→ ReadableStream) and Lambda (→ streamifyResponse).

export type SSEEvent =
  | { type: "conversation_id"; id: string }
  | { type: "text"; content: string }
  | { type: "title"; title: string }
  | { type: "thinking_start" }
  | { type: "thinking_delta"; content: string }
  | { type: "thinking_done"; durationMs: number }
  | { type: "citation"; index: number; cited_text: string; source: CitationSource }
  | { type: "done" }
  | { type: "error"; message: string };

// ─── Citation Types ──────────────────────────────────────────────────────────

export interface CitationSource {
  type: "document" | "web";
  title: string;
  url?: string;        // web citations
  page?: number;       // document citations (PDF page)
  startChar?: number;  // document citations (text range)
  endChar?: number;
}

export interface Citation {
  index: number;
  cited_text: string;
  source: CitationSource;
}

// ─── Message Metadata ────────────────────────────────────────────────────────
// Stored in the `metadata` JSONB column on the messages table.

export interface MessageMetadata {
  thinkingContent?: string;
  thinkingDurationMs?: number;
  citations?: Citation[];
}

// ─── Stream Handler Options ──────────────────────────────────────────────────

export interface StreamOptions {
  thinking?: boolean;
  caching?: boolean;
  citations?: boolean;
}
