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
  | { type: "tool_start"; name: string; toolUseId: string }
  | { type: "tool_input_delta"; content: string }
  | { type: "tool_done"; name: string; toolUseId: string }
  | { type: "tool_result"; name: string; toolUseId: string; content: string; isError?: boolean }
  | { type: "image"; base64: string; mediaType: string }
  | { type: "files"; files: { path: string; content: string }[] }
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

// ─── Tool Use Types ─────────────────────────────────────────────────────────

export interface ToolUseRecord {
  toolUseId: string;
  name: string;
  input: string;      // JSON string of tool input
  result: string;
  isError?: boolean;
}

export interface ImageRecord {
  base64: string;
  mediaType: string;
}

export interface FileRecord {
  path: string;
  content: string;
}

// ─── Message Metadata ────────────────────────────────────────────────────────
// Stored in the `metadata` JSONB column on the messages table.

export interface MessageMetadata {
  thinkingContent?: string;
  thinkingDurationMs?: number;
  citations?: Citation[];
  toolUses?: ToolUseRecord[];
  images?: ImageRecord[];
}

// ─── Stream Handler Options ──────────────────────────────────────────────────

export interface StreamOptions {
  thinking?: boolean;
  caching?: boolean;
  citations?: boolean;
  tools?: boolean;      // default true — enable tool use
}
