// src/lib/ai/stream-handler.ts

import { getClient, MODEL } from "@/lib/ai/client";
import {
  sanitizeStreamChunk,
  sanitizeResponse,
  flushBuffer,
} from "@/lib/ai/sanitizer";
import type { ChatMessage } from "@/lib/ai/prompts";
import type { SSEEvent, StreamOptions, Citation, CitationSource } from "@/lib/ai/types";
import type {
  TextBlockParam,
  MessageParam,
  TextCitation,
} from "@anthropic-ai/sdk/resources/messages";
import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";

// ─── Configuration ───────────────────────────────────────────────────────────

// Maximum thinking budget — set to Foundry/Anthropic max for Opus 4.6.
// Verify this value during testing; reduce if Foundry rejects it.
const MAX_THINKING_BUDGET = 128_000;

// ─── Stream Handler ──────────────────────────────────────────────────────────

export interface StreamHandlerParams {
  systemPrompt: string;
  messages: ChatMessage[];
  mode: "chat" | "build";
  options?: StreamOptions;
}

export interface StreamResult {
  content: string;           // final sanitized text content
  thinkingContent?: string;  // full thinking text (sanitized)
  thinkingDurationMs?: number;
  citations?: Citation[];
}

/**
 * Core AI streaming pipeline.
 *
 * Yields typed SSE events as it processes the Anthropic stream.
 * The final `done` event signals completion. After the generator
 * finishes, call `getResult()` on the returned object to get
 * the accumulated content for DB persistence.
 */
export async function* streamChat(
  params: StreamHandlerParams
): AsyncGenerator<SSEEvent, StreamResult> {
  const { systemPrompt, messages, mode, options } = params;

  const thinkingEnabled = options?.thinking !== false; // default on
  const cachingEnabled = options?.caching !== false;   // default on
  const citationsEnabled = options?.citations !== false; // default on

  // ── Build API parameters ────────────────────────────────────────────────

  const maxTokens = mode === "build" ? 100_000 : 16_000;
  const thinkingBudget = mode === "build"
    ? MAX_THINKING_BUDGET
    : Math.floor(MAX_THINKING_BUDGET / 2);

  // System prompt — with optional caching via cache_control
  const system: string | TextBlockParam[] = cachingEnabled
    ? [{ type: "text" as const, text: systemPrompt, cache_control: { type: "ephemeral" as const } }]
    : systemPrompt;

  // Messages — apply cache_control to last history message if caching
  const apiMessages = prepareMessages(messages, cachingEnabled);

  // ── Stream the response ─────────────────────────────────────────────────

  let fullRawContent = "";
  let thinkingContent = "";
  let thinkingStartTime = 0;
  let thinkingDurationMs = 0;
  const citations: Citation[] = [];
  let citationIndex = 0;

  const textBuffer = { value: "" };
  const thinkingBuffer = { value: "" };

  let currentBlockType: "thinking" | "text" | null = null;

  try {
    // Build the stream call. The SDK types support thinking, citations,
    // and cache_control natively. We cast messages to MessageParam[] since
    // our ChatMessage type is structurally compatible but not nominally.
    const response: MessageStream = getClient().messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: apiMessages as MessageParam[],
      ...(thinkingEnabled && {
        thinking: {
          type: "enabled" as const,
          budget_tokens: thinkingBudget,
        },
      }),
      ...(citationsEnabled && {
        citations: { enabled: true },
      }),
    });

    for await (const event of response) {
      // ── Content block start ───────────────────────────────────────────
      if (event.type === "content_block_start") {
        if (event.content_block.type === "thinking") {
          currentBlockType = "thinking";
          thinkingStartTime = Date.now();
          yield { type: "thinking_start" };
        } else if (event.content_block.type === "text") {
          currentBlockType = "text";
        }
      }

      // ── Content block delta ───────────────────────────────────────────
      if (event.type === "content_block_delta") {
        if (event.delta.type === "thinking_delta" && currentBlockType === "thinking") {
          const chunk = event.delta.thinking;
          thinkingContent += chunk;

          const sanitized = sanitizeStreamChunk(chunk, thinkingBuffer);
          if (sanitized) {
            yield { type: "thinking_delta", content: sanitized };
          }
        }

        if (event.delta.type === "text_delta" && currentBlockType === "text") {
          const chunk = event.delta.text;
          fullRawContent += chunk;

          const sanitized = sanitizeStreamChunk(chunk, textBuffer);
          if (sanitized) {
            yield { type: "text", content: sanitized };
          }
        }
      }

      // ── Content block stop ────────────────────────────────────────────
      if (event.type === "content_block_stop") {
        if (currentBlockType === "thinking") {
          // Flush thinking buffer
          const remaining = flushBuffer(thinkingBuffer);
          if (remaining) {
            yield { type: "thinking_delta", content: remaining };
          }
          thinkingDurationMs = Date.now() - thinkingStartTime;
          yield { type: "thinking_done", durationMs: thinkingDurationMs };
        }

        if (currentBlockType === "text") {
          // Flush text buffer
          const remaining = flushBuffer(textBuffer);
          if (remaining) {
            yield { type: "text", content: remaining };
          }
        }

        currentBlockType = null;
      }
    }

    // ── Post-stream: extract citations from final message ───────────────
    try {
      const finalMessage = await response.finalMessage();
      if (finalMessage?.content && Array.isArray(finalMessage.content)) {
        for (const block of finalMessage.content) {
          if (block.type === "text" && block.citations && Array.isArray(block.citations)) {
            for (const cite of block.citations as TextCitation[]) {
              const source = mapCitationSource(cite);
              if (source) {
                citations.push({
                  index: citationIndex++,
                  cited_text: cite.cited_text,
                  source,
                });
              }
            }
          }
        }
      }
    } catch {
      // finalMessage() may not be available on all SDK versions — that's OK
    }

    // Emit citations
    for (const citation of citations) {
      yield { type: "citation", ...citation };
    }

    yield { type: "done" };

    // Sanitize the full accumulated content for DB storage
    const sanitizedContent = sanitizeResponse(fullRawContent);
    const sanitizedThinking = thinkingContent
      ? sanitizeResponse(thinkingContent)
      : undefined;

    return {
      content: sanitizedContent,
      thinkingContent: sanitizedThinking,
      thinkingDurationMs: thinkingDurationMs || undefined,
      citations: citations.length > 0 ? citations : undefined,
    };
  } catch (err) {
    console.error("AI stream error:", err);
    flushBuffer(textBuffer);
    flushBuffer(thinkingBuffer);
    yield {
      type: "error",
      message: "Something went wrong. Please try again.",
    };
    return {
      content: sanitizeResponse(fullRawContent),
      thinkingContent: thinkingContent ? sanitizeResponse(thinkingContent) : undefined,
      thinkingDurationMs: thinkingDurationMs || undefined,
      citations: citations.length > 0 ? citations : undefined,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Map an SDK TextCitation object to our internal CitationSource type.
 *
 * TextCitation is a union of: CitationCharLocation | CitationPageLocation |
 * CitationContentBlockLocation | CitationsWebSearchResultLocation |
 * CitationsSearchResultLocation
 */
function mapCitationSource(cite: TextCitation): CitationSource | null {
  switch (cite.type) {
    case "web_search_result_location":
      return {
        type: "web",
        title: cite.title || "Source",
        url: cite.url,
      };

    case "char_location":
      return {
        type: "document",
        title: cite.document_title || "Source",
        startChar: cite.start_char_index,
        endChar: cite.end_char_index,
      };

    case "page_location":
      return {
        type: "document",
        title: cite.document_title || "Source",
        page: cite.start_page_number,
      };

    case "content_block_location":
      return {
        type: "document",
        title: cite.document_title || "Source",
      };

    case "search_result_location":
      return {
        type: "document",
        title: cite.title || "Source",
      };

    default:
      return null;
  }
}

/**
 * Prepare messages for the API call.
 * If caching is enabled, marks the last history message with cache_control
 * so Anthropic can cache the conversation prefix.
 */
function prepareMessages(
  messages: ChatMessage[],
  cachingEnabled: boolean
): MessageParam[] {
  // Cast upfront — ChatMessage is structurally compatible with MessageParam
  // (both have role: "user"|"assistant" and content: string | block[])
  const base = messages as unknown as MessageParam[];

  if (!cachingEnabled || messages.length < 2) {
    return base;
  }

  // Clone messages to avoid mutating originals
  const prepared: MessageParam[] = base.map((m) => ({ ...m }));

  // Mark the second-to-last message (last history message, not the current user message)
  // with cache_control so Anthropic caches the conversation prefix.
  const lastHistoryIdx = prepared.length - 2;
  const msg = prepared[lastHistoryIdx];

  if (typeof msg.content === "string") {
    prepared[lastHistoryIdx] = {
      role: msg.role,
      content: [
        {
          type: "text" as const,
          text: msg.content,
          cache_control: { type: "ephemeral" as const },
        },
      ],
    };
  } else if (Array.isArray(msg.content)) {
    // Content is already an array of blocks — add cache_control to the last block
    const blocks = [...msg.content];
    const lastBlock = { ...blocks[blocks.length - 1], cache_control: { type: "ephemeral" as const } };
    blocks[blocks.length - 1] = lastBlock;
    prepared[lastHistoryIdx] = {
      role: msg.role,
      content: blocks,
    };
  }

  return prepared;
}
