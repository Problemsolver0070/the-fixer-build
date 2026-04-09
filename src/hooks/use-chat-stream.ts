// src/hooks/use-chat-stream.ts
"use client";

import { useRef, useState, useCallback } from "react";
import type { Attachment } from "@/lib/types/attachment";
import type { Citation, CitationSource } from "@/lib/ai/types";

const CHAT_API_URL =
  process.env.NEXT_PUBLIC_CHAT_API_URL || "/api/chat";

// ─── Callback Types ──────────────────────────────────────────────────────────

export interface ChatStreamCallbacks {
  onConversationId: (id: string) => void;
  onText: (content: string) => void;
  onTitle?: (title: string) => void;
  onThinkingStart?: () => void;
  onThinkingDelta?: (content: string) => void;
  onThinkingDone?: (durationMs: number) => void;
  onCitation?: (citation: Citation) => void;

  // Phase 2: Tool events
  onToolStart?: (name: string, toolUseId: string) => void;
  onToolInputDelta?: (content: string) => void;
  onToolDone?: (name: string, toolUseId: string) => void;
  onToolResult?: (name: string, toolUseId: string, content: string, isError?: boolean) => void;
  onImage?: (base64: string, mediaType: string) => void;
  onFiles?: (files: { path: string; content: string }[]) => void;

  onDone: () => void;
  onError: (message: string) => void;
}

export interface SendMessageParams {
  message: string;
  conversationId?: string;
  mode: "chat" | "build";
  attachments?: Attachment[];
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useChatStream(
  callbacks: ChatStreamCallbacks,
  getToken?: () => Promise<string | null>
) {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  const sendMessage = useCallback(
    async (params: SendMessageParams) => {
      const { message, conversationId, mode, attachments } = params;
      const cb = cbRef.current;

      setIsStreaming(true);
      abortRef.current = new AbortController();

      try {
        const token = getToken ? await getToken() : null;
        const res = await fetch(CHAT_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            message,
            conversationId,
            mode,
            attachments: attachments && attachments.length > 0 ? attachments : undefined,
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => null);
          const errorMsg = res.status === 402
            ? "Your access has expired. Please purchase a pass to continue."
            : errorData?.error || "Something went wrong. Please try again.";
          cb.onError(errorMsg);
          setIsStreaming(false);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          cb.onError("No response stream");
          setIsStreaming(false);
          return;
        }

        const decoder = new TextDecoder();
        let sseBuffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              switch (data.type) {
                case "conversation_id":
                  cb.onConversationId(data.id);
                  break;
                case "text":
                  cb.onText(data.content);
                  break;
                case "title":
                  cb.onTitle?.(data.title);
                  break;
                case "thinking_start":
                  cb.onThinkingStart?.();
                  break;
                case "thinking_delta":
                  cb.onThinkingDelta?.(data.content);
                  break;
                case "thinking_done":
                  cb.onThinkingDone?.(data.durationMs);
                  break;
                case "citation":
                  cb.onCitation?.({
                    index: data.index,
                    cited_text: data.cited_text,
                    source: data.source as CitationSource,
                  });
                  break;
                // Phase 2: Tool events
                case "tool_start":
                  cb.onToolStart?.(data.name, data.toolUseId);
                  break;
                case "tool_input_delta":
                  cb.onToolInputDelta?.(data.content);
                  break;
                case "tool_done":
                  cb.onToolDone?.(data.name, data.toolUseId);
                  break;
                case "tool_result":
                  cb.onToolResult?.(data.name, data.toolUseId, data.content, data.isError);
                  break;
                case "image":
                  cb.onImage?.(data.base64, data.mediaType);
                  break;
                case "files":
                  cb.onFiles?.(data.files);
                  break;
                case "done":
                  cb.onDone();
                  setIsStreaming(false);
                  return;
                case "error":
                  cb.onError(data.message);
                  setIsStreaming(false);
                  return;
              }
            } catch {
              // Skip malformed SSE lines
            }
          }
        }

        cb.onDone();
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // User-initiated abort
        } else {
          console.error("Chat stream error:", err);
          cbRef.current.onError("Network error. Please check your connection and try again.");
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [getToken]
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return { sendMessage, isStreaming, abort };
}
