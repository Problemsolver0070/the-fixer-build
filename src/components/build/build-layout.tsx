"use client";

import { useState, useCallback, useRef } from "react";
import { useChatStream } from "@/hooks/use-chat-stream";
import { useAuth } from "@clerk/nextjs";
import { useBuildStore } from "@/stores/build-store";
import { CodeEditor } from "./code-editor";
import { FileTree } from "./file-tree";
import { PreviewPanel } from "./preview-panel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Code, Eye, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AttachmentButton, uploadFile } from "@/components/chat/attachment-button";
import { AttachmentPreview } from "@/components/chat/attachment-preview";
import { MessageAttachments } from "@/components/chat/message-attachments";
import type { PendingAttachment, Attachment } from "@/lib/types/attachment";
import { detectCategory, isAllowedFile, MAX_FILE_SIZE } from "@/lib/types/attachment";

// ─── Minimal Chat UI (inline) ────────────────────────────────────────────────
// The chat components are being built by another agent and may not exist yet.
// We provide a self-contained chat interface for build mode that will be
// swapped for the shared ChatMessages/ChatInput once they land.

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[] | null;
}

interface BuildLayoutProps {
  conversationId?: string;
  initialFiles?: Record<string, string>;
  initialMessages?: ChatMessage[];
}

export function BuildLayout({
  conversationId: _conversationId,
  initialFiles,
  initialMessages,
}: BuildLayoutProps) {
  const { getToken } = useAuth();
  const setFiles = useBuildStore((s) => s.setFiles);
  const files = useBuildStore((s) => s.files);

  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages ?? []
  );
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const conversationIdRef = useRef<string | undefined>(_conversationId);
  const fullContentRef = useRef("");
  const assistantIdRef = useRef("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);

  // Load initial files into store
  const hasLoadedRef = useRef(false);
  if (initialFiles && !hasLoadedRef.current) {
    hasLoadedRef.current = true;
    setFiles(initialFiles);
  }

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

  const handleFilesGenerated = useCallback(
    async (newFiles: Record<string, string>) => {
      const existingFiles = useBuildStore.getState().files;
      const mergedFiles = { ...existingFiles, ...newFiles };
      setFiles(mergedFiles);

      // Save to API in the background
      try {
        await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Untitled Project",
            conversationId: conversationIdRef.current,
            files: mergedFiles,
          }),
        });
      } catch (error) {
        console.error("Failed to save project:", error);
      }
    },
    [setFiles]
  );

  const { sendMessage: streamSend, isStreaming } = useChatStream(
    {
      onConversationId: (id) => {
        conversationIdRef.current = id;
        if (!_conversationId) {
          window.history.replaceState(null, "", `/build/${id}`);
        }
      },
      onText: (content) => {
        fullContentRef.current += content;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantIdRef.current
              ? { ...m, content: fullContentRef.current }
              : m
          )
        );
      },
      onThinkingStart: () => {},
      onThinkingDelta: () => {},
      onThinkingDone: () => {},
      onCitation: () => {},
      onToolStart: () => {},
      onToolInputDelta: () => {},
      onToolDone: () => {},
      onToolResult: () => {},
      onImage: () => {},
      onFiles: (files) => {
        // Primary path: structured files from write_files tool
        const filesMap: Record<string, string> = {};
        for (const f of files) {
          filesMap[f.path] = f.content;
        }
        if (Object.keys(filesMap).length > 0) {
          handleFilesGenerated(filesMap);
        }
      },
      onDone: () => {
        const extractedFiles = extractFilesFromResponse(fullContentRef.current);
        if (extractedFiles && Object.keys(extractedFiles).length > 0) {
          handleFilesGenerated(extractedFiles);
        }
      },
      onError: (message) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantIdRef.current
              ? { ...m, content: message || "Something went wrong." }
              : m
          )
        );
      },
    },
    getToken
  );

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    const readyAttachments: Attachment[] = pendingAttachments
      .filter((p) => p.status === "ready" && p.attachment)
      .map((p) => p.attachment!);
    if ((!trimmed && readyAttachments.length === 0) || isStreaming) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      attachments: readyAttachments.length > 0 ? readyAttachments : undefined,
    };

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
    };
    assistantIdRef.current = assistantMessage.id;
    fullContentRef.current = "";

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput("");
    pendingAttachments.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
    setPendingAttachments([]);

    await streamSend({
      message: trimmed,
      conversationId: conversationIdRef.current,
      mode: "build",
      attachments: readyAttachments.length > 0 ? readyAttachments : undefined,
    });

    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [input, isStreaming, handleFilesGenerated, streamSend, pendingAttachments]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* ─── Left: Chat Panel (40%) ───────────────────────────────────────── */}
      <div className="flex w-[40%] flex-col border-r border-border/50">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <p className="text-sm font-medium">Build Mode</p>
              <p className="text-xs text-center max-w-[240px]">
                Describe what you want to build and The Fixer will generate the
                code for you.
              </p>
            </div>
          )}
          {messages.map((msg) => {
            // Strip <bricks-files> blocks from displayed content
            const displayContent =
              msg.role === "assistant"
                ? msg.content
                    .replace(/<bricks-files>[\s\S]*?<\/bricks-files>/g, "")
                    .replace(/<bricks-files>[\s\S]*/g, "") // handle incomplete blocks
                    .trim()
                : msg.content;

            if (msg.role === "assistant" && !displayContent) return null;

            return (
              <div
                key={msg.id}
                className={cn(
                  "flex flex-col gap-1",
                  msg.role === "user" ? "items-end" : "items-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  )}
                >
                  {msg.role === "user" && msg.attachments && (
                    <MessageAttachments attachments={msg.attachments} />
                  )}
                  {displayContent}
                </div>
              </div>
            );
          })}
          {isStreaming && (messages.length === 0 || messages[messages.length - 1]?.role === "user" || messages[messages.length - 1]?.content === "") && (
            <div className="flex flex-col gap-1 items-start">
              <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-muted text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="animate-pulse">The Fixer is thinking</span>
                  <span className="animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
                  <span className="animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
                  <span className="animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
                </span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div
          className="border-t border-border/50 p-3"
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
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
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
              placeholder="Describe what you want to build..."
              rows={2}
              className="flex-1 resize-none rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              disabled={isStreaming}
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={(!input.trim() && pendingAttachments.length === 0) || isStreaming || pendingAttachments.some((p) => p.status === "uploading")}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* ─── Right: Code / Preview (60%) ──────────────────────────────────── */}
      <div className="flex w-[60%] flex-col">
        <Tabs defaultValue="code" className="flex h-full flex-col">
          <TabsList className="mx-3 mt-2" variant="default">
            <TabsTrigger value="code">
              <Code className="h-3.5 w-3.5" data-icon="inline-start" />
              Code
            </TabsTrigger>
            <TabsTrigger value="preview">
              <Eye className="h-3.5 w-3.5" data-icon="inline-start" />
              Preview
            </TabsTrigger>
          </TabsList>

          <TabsContent value="code" className="flex flex-1 overflow-hidden">
            <div className="flex h-full w-full">
              {/* File Tree */}
              <div className="w-48 shrink-0 border-r border-border/50 bg-muted/20">
                <div className="flex h-8 items-center border-b border-border/50 px-3">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Files
                  </span>
                </div>
                <FileTree />
              </div>
              {/* Editor */}
              <CodeEditor />
            </div>
          </TabsContent>

          <TabsContent value="preview" className="flex-1 overflow-hidden">
            <PreviewPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ─── Utility: Extract files from AI response ─────────────────────────────────

/**
 * Parses code blocks from AI responses that follow the convention:
 * ```filename.ext
 * content
 * ```
 * Or JSON blocks with a files object.
 */
function extractFilesFromResponse(
  content: string
): Record<string, string> | null {
  const files: Record<string, string> = {};

  // Try <bricks-files> format first (the AI's primary output format)
  try {
    // Match complete block first
    let bricksJson: string | undefined;
    const completeMatch = content.match(/<bricks-files>\s*([\s\S]*?)\s*<\/bricks-files>/);
    if (completeMatch) {
      bricksJson = completeMatch[1];
    } else {
      // Handle truncated responses — extract whatever JSON array we have
      const incompleteMatch = content.match(/<bricks-files>\s*([\s\S]*)/);
      if (incompleteMatch) {
        bricksJson = incompleteMatch[1];
        // Try to repair truncated JSON: use brace-depth tracking that handles braces inside strings
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
      const parsed = JSON.parse(bricksJson);
      if (Array.isArray(parsed)) {
        for (const f of parsed) {
          if (f.path && f.content) {
            files[f.path] = f.content;
          }
        }
        if (Object.keys(files).length > 0) return files;
      }
    }
  } catch {
    // Not valid bricks-files, try other formats
  }

  // Try JSON parse (if the AI returns a JSON files object)
  try {
    const jsonMatch = content.match(/```json\s*\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.files && typeof parsed.files === "object") {
        return parsed.files as Record<string, string>;
      }
    }
  } catch {
    // Not JSON, try code block extraction
  }

  // Extract named code blocks: ```filename.ext\n...\n```
  const codeBlockRegex =
    /```(\S+\.\S+)\s*\n([\s\S]*?)```/g;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const filename = match[1];
    const code = match[2].trimEnd();

    // Skip if the filename looks like a language identifier only
    if (
      ["typescript", "javascript", "json", "css", "html", "tsx", "jsx", "ts", "js"].includes(
        filename
      )
    ) {
      continue;
    }

    files[filename] = code;
  }

  return Object.keys(files).length > 0 ? files : null;
}
