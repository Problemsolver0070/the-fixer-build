// src/lib/ai/stream-handler.ts

import { getClient, MODEL } from "@/lib/ai/client";
import {
  sanitizeStreamChunk,
  sanitizeResponse,
  flushBuffer,
} from "@/lib/ai/sanitizer";
import { getToolsForMode, executeWriteFiles, downloadCodeExecutionImages } from "@/lib/ai/tools";
import type { ChatMessage } from "@/lib/ai/prompts";
import type {
  SSEEvent,
  StreamOptions,
  Citation,
  CitationSource,
  ToolUseRecord,
  ImageRecord,
  FileRecord,
} from "@/lib/ai/types";
import type {
  TextBlockParam,
  MessageParam,
  TextCitation,
  ContentBlock,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";

// ─── Configuration ───────────────────────────────────────────────────────────

// Maximum thinking budget — set to Foundry/Anthropic max for Opus 4.6.
const MAX_THINKING_BUDGET = 128_000;

// ─── Stream Handler ──────────────────────────────────────────────────────────

export interface StreamHandlerParams {
  systemPrompt: string;
  messages: ChatMessage[];
  mode: "chat" | "build";
  options?: StreamOptions;
}

export interface StreamResult {
  content: string;
  thinkingContent?: string;
  thinkingDurationMs?: number;
  citations?: Citation[];
  toolUses?: ToolUseRecord[];
  images?: ImageRecord[];
  files?: FileRecord[];
}

/**
 * Core AI streaming pipeline.
 *
 * Yields typed SSE events as it processes the Anthropic stream.
 * Handles server-managed tools (web_search, web_fetch, code_execution)
 * and custom tools (write_files) with a tool execution loop.
 */
export async function* streamChat(
  params: StreamHandlerParams
): AsyncGenerator<SSEEvent, StreamResult> {
  const { systemPrompt, mode, options } = params;

  const thinkingEnabled = options?.thinking !== false;
  const cachingEnabled = options?.caching !== false;
  const citationsEnabled = options?.citations !== false;
  const toolsEnabled = options?.tools !== false;

  // ── Build API parameters ────────────────────────────────────────────────

  const maxTokens = mode === "build" ? 100_000 : 16_000;
  const thinkingBudget = mode === "build"
    ? MAX_THINKING_BUDGET
    : Math.floor(MAX_THINKING_BUDGET / 2);

  const system: string | TextBlockParam[] = cachingEnabled
    ? [{ type: "text" as const, text: systemPrompt, cache_control: { type: "ephemeral" as const } }]
    : systemPrompt;

  const tools = toolsEnabled ? getToolsForMode(mode) : undefined;

  // ── Accumulated state across the tool loop ──────────────────────────────

  let fullRawContent = "";
  let thinkingContent = "";
  let thinkingStartTime = 0;
  let thinkingDurationMs = 0;
  const citations: Citation[] = [];
  let citationIndex = 0;
  const allToolUses: ToolUseRecord[] = [];
  const allImages: ImageRecord[] = [];
  const allFiles: FileRecord[] = [];

  // Messages array that grows with tool use/result pairs
  const apiMessages: MessageParam[] = prepareMessages(params.messages, cachingEnabled);

  try {
    // ── Tool execution loop ─────────────────────────────────────────────
    // Loops when the model calls custom tools (write_files).
    // Server-managed tools are handled inline during streaming.

    while (true) {
      const textBuffer = { value: "" };
      const thinkingBuffer = { value: "" };
      let currentBlockType: "thinking" | "text" | "server_tool_use" | "tool_use" | null = null;
      let currentToolName = "";
      let currentToolUseId = "";
      let currentToolInput = "";

      // Collect tool_use blocks from the response for custom execution
      const pendingToolUseBlocks: { id: string; name: string; input: unknown }[] = [];
      // Collect all content blocks for the assistant message
      const assistantContentBlocks: ContentBlock[] = [];

      const response: MessageStream = getClient().messages.stream({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: apiMessages,
        ...(thinkingEnabled && {
          thinking: {
            type: "enabled" as const,
            budget_tokens: thinkingBudget,
          },
        }),
        ...(citationsEnabled && {
          citations: { enabled: true },
        }),
        ...(tools && {
          tools,
          tool_choice: { type: "auto" as const },
        }),
      });

      for await (const event of response) {
        // ── Content block start ─────────────────────────────────────────
        if (event.type === "content_block_start") {
          const block = event.content_block;

          if (block.type === "thinking") {
            currentBlockType = "thinking";
            thinkingStartTime = Date.now();
            yield { type: "thinking_start" };
          } else if (block.type === "text") {
            currentBlockType = "text";
          } else if (block.type === "server_tool_use") {
            currentBlockType = "server_tool_use";
            currentToolName = block.name;
            currentToolUseId = block.id;
            currentToolInput = "";
            yield { type: "tool_start", name: block.name, toolUseId: block.id };
          } else if (block.type === "tool_use") {
            currentBlockType = "tool_use";
            currentToolName = block.name;
            currentToolUseId = block.id;
            currentToolInput = "";
            yield { type: "tool_start", name: block.name, toolUseId: block.id };
          }

          // ── Server tool result blocks (handled at block start) ────────
          if (block.type === "web_search_tool_result") {
            let resultText = "";
            // content is WebSearchToolResultError | Array<WebSearchResultBlock>
            if (Array.isArray(block.content)) {
              resultText = block.content
                .map((r) => `${r.title || "Result"}: ${r.url || ""}`)
                .join("\n");
            } else if (block.content?.type === "web_search_tool_result_error") {
              resultText = `Search error: ${block.content.error_code}`;
            }
            const record: ToolUseRecord = {
              toolUseId: block.tool_use_id,
              name: "web_search",
              input: "",
              result: resultText,
            };
            allToolUses.push(record);
            yield { type: "tool_result", name: "web_search", toolUseId: block.tool_use_id, content: resultText };
            yield { type: "tool_done", name: "web_search", toolUseId: block.tool_use_id };
          }

          if (block.type === "web_fetch_tool_result") {
            let resultText = "";
            // content is WebFetchToolResultErrorBlock | WebFetchBlock
            if (block.content.type === "web_fetch_result") {
              resultText = `Fetched: ${block.content.url || "unknown"}`;
            } else if (block.content.type === "web_fetch_tool_result_error") {
              resultText = `Fetch error: ${block.content.error_code}`;
            }
            const record: ToolUseRecord = {
              toolUseId: block.tool_use_id,
              name: "web_fetch",
              input: "",
              result: resultText,
            };
            allToolUses.push(record);
            yield { type: "tool_result", name: "web_fetch", toolUseId: block.tool_use_id, content: resultText };
            yield { type: "tool_done", name: "web_fetch", toolUseId: block.tool_use_id };
          }

          if (block.type === "code_execution_tool_result") {
            let resultText = "";
            const fileIds: string[] = [];

            // content is CodeExecutionToolResultError | CodeExecutionResultBlock | EncryptedCodeExecutionResultBlock
            const cContent = block.content;
            if (cContent.type === "code_execution_result") {
              if (cContent.stdout) resultText += cContent.stdout;
              if (cContent.stderr) resultText += (resultText ? "\n" : "") + `stderr: ${cContent.stderr}`;
              if (cContent.return_code !== 0) {
                resultText += (resultText ? "\n" : "") + `exit code: ${cContent.return_code}`;
              }
              // Collect file_ids for image download
              for (const output of cContent.content) {
                if (output.type === "code_execution_output" && output.file_id) {
                  fileIds.push(output.file_id);
                }
              }
            } else if (cContent.type === "code_execution_tool_result_error") {
              resultText = `Code execution error: ${cContent.error_code}`;
            }

            const record: ToolUseRecord = {
              toolUseId: block.tool_use_id,
              name: "code_execution",
              input: "",
              result: resultText,
            };
            allToolUses.push(record);
            yield { type: "tool_result", name: "code_execution", toolUseId: block.tool_use_id, content: resultText };

            // Download images from code execution
            if (fileIds.length > 0) {
              const images = await downloadCodeExecutionImages(fileIds);
              for (const img of images) {
                allImages.push(img);
                yield { type: "image", base64: img.base64, mediaType: img.mediaType };
              }
            }

            yield { type: "tool_done", name: "code_execution", toolUseId: block.tool_use_id };
          }
        }

        // ── Content block delta ─────────────────────────────────────────
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

          if (
            event.delta.type === "input_json_delta" &&
            (currentBlockType === "server_tool_use" || currentBlockType === "tool_use")
          ) {
            const chunk = event.delta.partial_json;
            currentToolInput += chunk;
            yield { type: "tool_input_delta", content: chunk };
          }
        }

        // ── Content block stop ──────────────────────────────────────────
        if (event.type === "content_block_stop") {
          if (currentBlockType === "thinking") {
            const remaining = flushBuffer(thinkingBuffer);
            if (remaining) {
              yield { type: "thinking_delta", content: remaining };
            }
            thinkingDurationMs = Date.now() - thinkingStartTime;
            yield { type: "thinking_done", durationMs: thinkingDurationMs };
          }

          if (currentBlockType === "text") {
            const remaining = flushBuffer(textBuffer);
            if (remaining) {
              yield { type: "text", content: remaining };
            }
          }

          if (currentBlockType === "tool_use") {
            // Custom tool — collect for execution after stream ends
            let parsedInput: unknown = {};
            try {
              parsedInput = JSON.parse(currentToolInput);
            } catch {
              // input may be empty or malformed
            }
            pendingToolUseBlocks.push({
              id: currentToolUseId,
              name: currentToolName,
              input: parsedInput,
            });
          }

          currentBlockType = null;
        }
      }

      // ── Post-stream: extract citations from final message ───────────────
      let finalMessage;
      try {
        finalMessage = await response.finalMessage();
      } catch {
        // finalMessage() may not be available — that's OK
      }

      if (finalMessage?.content && Array.isArray(finalMessage.content)) {
        for (const block of finalMessage.content) {
          assistantContentBlocks.push(block);

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

      // ── Check stop reason — do we need to execute custom tools? ─────────
      const stopReason = finalMessage?.stop_reason;

      if (stopReason !== "tool_use" || pendingToolUseBlocks.length === 0) {
        break;
      }

      // ── Execute custom tools and loop ───────────────────────────────────
      const toolResultMessages: ToolResultBlockParam[] = [];

      for (const toolBlock of pendingToolUseBlocks) {
        if (toolBlock.name === "write_files") {
          const { files, resultText } = executeWriteFiles(toolBlock.input);

          for (const f of files) {
            allFiles.push({ path: f.path, content: f.content });
          }

          if (files.length > 0) {
            yield { type: "files", files };
          }

          allToolUses.push({
            toolUseId: toolBlock.id,
            name: "write_files",
            input: JSON.stringify(toolBlock.input),
            result: resultText,
          });

          yield { type: "tool_result", name: "write_files", toolUseId: toolBlock.id, content: resultText };
          yield { type: "tool_done", name: "write_files", toolUseId: toolBlock.id };

          toolResultMessages.push({
            type: "tool_result" as const,
            tool_use_id: toolBlock.id,
            content: resultText,
          });
        } else {
          toolResultMessages.push({
            type: "tool_result" as const,
            tool_use_id: toolBlock.id,
            content: `Unknown tool: ${toolBlock.name}`,
            is_error: true,
          });
        }
      }

      apiMessages.push({
        role: "assistant" as const,
        content: assistantContentBlocks as unknown as MessageParam["content"],
      });

      apiMessages.push({
        role: "user" as const,
        content: toolResultMessages as unknown as MessageParam["content"],
      });
    }

    // ── Emit citations ──────────────────────────────────────────────────────
    for (const citation of citations) {
      yield { type: "citation", ...citation };
    }

    yield { type: "done" };

    const sanitizedContent = sanitizeResponse(fullRawContent);
    const sanitizedThinking = thinkingContent
      ? sanitizeResponse(thinkingContent)
      : undefined;

    return {
      content: sanitizedContent,
      thinkingContent: sanitizedThinking,
      thinkingDurationMs: thinkingDurationMs || undefined,
      citations: citations.length > 0 ? citations : undefined,
      toolUses: allToolUses.length > 0 ? allToolUses : undefined,
      images: allImages.length > 0 ? allImages : undefined,
      files: allFiles.length > 0 ? allFiles : undefined,
    };
  } catch (err) {
    console.error("AI stream error:", err);
    yield {
      type: "error",
      message: "Something went wrong. Please try again.",
    };
    return {
      content: sanitizeResponse(fullRawContent),
      thinkingContent: thinkingContent ? sanitizeResponse(thinkingContent) : undefined,
      thinkingDurationMs: thinkingDurationMs || undefined,
      citations: citations.length > 0 ? citations : undefined,
      toolUses: allToolUses.length > 0 ? allToolUses : undefined,
      images: allImages.length > 0 ? allImages : undefined,
      files: allFiles.length > 0 ? allFiles : undefined,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function prepareMessages(
  messages: ChatMessage[],
  cachingEnabled: boolean
): MessageParam[] {
  const base = messages as unknown as MessageParam[];

  if (!cachingEnabled || messages.length < 2) {
    return base.map((m) => ({ ...m }));
  }

  const prepared: MessageParam[] = base.map((m) => ({ ...m }));

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
