"use client";

import { useRef, useState, useCallback, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/stores/chat-store";
import { useChatStream } from "@/hooks/use-chat-stream";
import { AttachmentButton, uploadFile } from "./attachment-button";
import { AttachmentPreview } from "./attachment-preview";
import type { PendingAttachment, Attachment } from "@/lib/types/attachment";
import { detectCategory, isAllowedFile, MAX_FILE_SIZE } from "@/lib/types/attachment";

interface ChatInputProps {
  conversationId?: string;
  mode?: "chat" | "build";
  onFilesGenerated?: (files: { path: string; content: string }[]) => void;
}

export function ChatInput({
  conversationId,
  mode = "chat",
  onFilesGenerated,
}: ChatInputProps) {
  const router = useRouter();
  const { getToken } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const fullContentRef = useRef("");
  const currentConversationIdRef = useRef(conversationId);

  const addMessage = useChatStore((s) => s.addMessage);
  const setStreamingFlag = useChatStore((s) => s.setStreaming);
  const appendStreamContent = useChatStore((s) => s.appendStreamContent);
  const clearStreamContent = useChatStore((s) => s.clearStreamContent);
  const finalizeStream = useChatStore((s) => s.finalizeStream);
  const startThinking = useChatStore((s) => s.startThinking);
  const appendThinkingContent = useChatStore((s) => s.appendThinkingContent);
  const finishThinking = useChatStore((s) => s.finishThinking);
  const addCitation = useChatStore((s) => s.addCitation);

  const { sendMessage: streamSend, isStreaming } = useChatStream(
    {
      onConversationId: (id) => {
        currentConversationIdRef.current = id;
        if (!conversationId) {
          const basePath = mode === "build" ? "/build" : "/chat";
          router.replace(`${basePath}/${id}`);
        }
      },
      onText: (content) => {
        fullContentRef.current += content;
        appendStreamContent(content);
      },
      onTitle: () => {
        // Title set server-side; layout will refresh
      },
      onThinkingStart: () => {
        startThinking();
      },
      onThinkingDelta: (content) => {
        appendThinkingContent(content);
      },
      onThinkingDone: (durationMs) => {
        finishThinking(durationMs);
      },
      onCitation: (citation) => {
        addCitation(citation);
      },
      onDone: () => {
        const assistantId = crypto.randomUUID();
        finalizeStream(assistantId);

        // Parse <bricks-files> if in build mode
        if (mode === "build" && onFilesGenerated) {
          try {
            const fullContent = fullContentRef.current;
            let bricksJson: string | undefined;
            const complete = fullContent.match(
              /<bricks-files>\s*([\s\S]*?)\s*<\/bricks-files>/
            );
            if (complete) {
              bricksJson = complete[1];
            } else {
              const incomplete = fullContent.match(/<bricks-files>\s*([\s\S]*)/);
              if (incomplete) {
                bricksJson = incomplete[1];
                let depth = 0;
                let lastCompleteEnd = -1;
                for (let i = 0; i < bricksJson.length; i++) {
                  const ch = bricksJson[i];
                  if (ch === '"') {
                    i++;
                    while (i < bricksJson.length && bricksJson[i] !== '"') {
                      if (bricksJson[i] === '\\') i++;
                      i++;
                    }
                  } else if (ch === '{') {
                    depth++;
                  } else if (ch === '}') {
                    depth--;
                    if (depth === 0) lastCompleteEnd = i;
                  }
                }
                if (lastCompleteEnd > 0) {
                  bricksJson = bricksJson.slice(0, lastCompleteEnd + 1) + "]";
                }
              }
            }
            if (bricksJson) {
              const files = JSON.parse(bricksJson);
              onFilesGenerated(files);
            }
          } catch {
            // JSON parse failed — skip
          }
        }
      },
      onError: (message) => {
        finalizeStream(crypto.randomUUID());
        addMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content: message,
          createdAt: new Date().toISOString(),
        });
      },
    },
    getToken
  );

  const handleFilesSelected = useCallback(
    async (newPending: PendingAttachment[]) => {
      setPendingAttachments((prev) => [...prev, ...newPending]);
      const token = await getToken();
      for (const pending of newPending) {
        try {
          const attachment = await uploadFile(pending.file, token);
          setPendingAttachments((prev) =>
            prev.map((p) =>
              p.id === pending.id
                ? { ...p, status: "ready" as const, attachment }
                : p
            )
          );
        } catch {
          setPendingAttachments((prev) =>
            prev.map((p) =>
              p.id === pending.id ? { ...p, status: "error" as const } : p
            )
          );
        }
      }
    },
    [getToken]
  );

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => {
      const att = prev.find((p) => p.id === id);
      if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const sendMessage = useCallback(async () => {
    const trimmed = value.trim();
    const readyAttachments: Attachment[] = pendingAttachments
      .filter((p) => p.status === "ready" && p.attachment)
      .map((p) => p.attachment!);
    if ((!trimmed && readyAttachments.length === 0) || isStreaming) return;

    // Add user message to store
    addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
      attachments: readyAttachments.length > 0 ? readyAttachments : undefined,
    });

    setValue("");
    pendingAttachments.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
    setPendingAttachments([]);
    setStreamingFlag(true);
    clearStreamContent();
    fullContentRef.current = "";

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    await streamSend({
      message: trimmed,
      conversationId,
      mode: mode as "chat" | "build",
      attachments: readyAttachments.length > 0 ? readyAttachments : undefined,
    });
  }, [
    value, isStreaming, conversationId, mode, addMessage, setStreamingFlag,
    clearStreamContent, streamSend, pendingAttachments,
  ]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const uploading = pendingAttachments.some((p) => p.status === "uploading");

  return (
    <div
      className="border-t border-border/50 bg-card/50 backdrop-blur-sm"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.files.length > 0) {
          const files = Array.from(e.dataTransfer.files).filter(
            (file) => isAllowedFile(file.type, file.name) && file.size <= MAX_FILE_SIZE
          );
          if (files.length === 0) return;
          const pending: PendingAttachment[] = files.map((file) => ({
            id: crypto.randomUUID(),
            file,
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            category: detectCategory(file.type, file.name),
            status: "uploading" as const,
            progress: 0,
            previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
          }));
          handleFilesSelected(pending);
        }
      }}
    >
      <div className="mx-auto max-w-3xl p-4">
        <AttachmentPreview
          attachments={pendingAttachments}
          onRemove={removeAttachment}
        />
        <div className="flex items-end gap-2">
          <AttachmentButton
            onFilesSelected={handleFilesSelected}
            disabled={isStreaming}
          />
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              const items = Array.from(e.clipboardData.items);
              const imageFiles = items
                .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
                .map((item) => item.getAsFile())
                .filter((f): f is File => f !== null);
              if (imageFiles.length > 0) {
                e.preventDefault();
                const pending: PendingAttachment[] = imageFiles.map((file) => ({
                  id: crypto.randomUUID(),
                  file,
                  filename: file.name || `pasted-image.${file.type.split("/")[1] || "png"}`,
                  mimeType: file.type,
                  size: file.size,
                  category: "image" as const,
                  status: "uploading" as const,
                  progress: 0,
                  previewUrl: URL.createObjectURL(file),
                }));
                handleFilesSelected(pending);
              }
            }}
            placeholder={
              mode === "build"
                ? "Describe what you want to build..."
                : "Ask The Fixer anything..."
            }
            disabled={isStreaming}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
            style={{ minHeight: "48px", maxHeight: "200px" }}
          />
          <Button
            onClick={sendMessage}
            disabled={isStreaming || (value.trim().length === 0 && pendingAttachments.length === 0) || uploading}
            size="icon"
            className="h-12 w-12 shrink-0 rounded-xl"
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
