"use client";

import { User, Bot } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { MessageAttachments } from "./message-attachments";
import { ThinkingBlock } from "./thinking-block";
import type { Attachment } from "@/lib/types/attachment";
import type { Citation } from "@/lib/ai/types";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  attachments?: Attachment[] | null;
  thinkingContent?: string;
  thinkingDurationMs?: number;
  isThinkingStreaming?: boolean;
  citations?: Citation[];
}

export function MessageBubble({
  role,
  content,
  isStreaming = false,
  attachments,
  thinkingContent,
  thinkingDurationMs,
  isThinkingStreaming = false,
  citations,
}: MessageBubbleProps) {
  const isUser = role === "user";

  // Strip <bricks-files> blocks from displayed content
  const displayContent =
    !isUser
      ? content
          .replace(/<bricks-files>[\s\S]*?<\/bricks-files>/g, "")
          .replace(/<bricks-files>[\s\S]*/g, "")
          .trim()
      : content;

  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-4",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {/* Assistant avatar */}
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Bot className="h-4 w-4" />
        </div>
      )}

      <div
        className={cn(
          "flex max-w-[75%] flex-col gap-1",
          isUser ? "items-end" : "items-start"
        )}
      >
        {/* Name label */}
        <span className="px-1 text-xs font-medium text-muted-foreground">
          {isUser ? "You" : "The Fixer"}
        </span>

        {/* Message content */}
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm leading-relaxed",
            isUser
              ? "bg-primary text-primary-foreground rounded-br-md"
              : "bg-muted text-foreground rounded-bl-md"
          )}
        >
          {isUser ? (
            <>
              {attachments && <MessageAttachments attachments={attachments} />}
              <p className="whitespace-pre-wrap">{content}</p>
            </>
          ) : (
            <>
              {/* Thinking block */}
              {(thinkingContent || isThinkingStreaming) && (
                <ThinkingBlock
                  content={thinkingContent || ""}
                  durationMs={thinkingDurationMs}
                  isStreaming={isThinkingStreaming}
                />
              )}

              {/* Main response */}
              <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-pre:my-2 prose-pre:rounded-lg prose-pre:bg-background/50 prose-code:rounded prose-code:bg-background/50 prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-headings:my-2 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {displayContent}
                </ReactMarkdown>
                {isStreaming && (
                  <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary" />
                )}
              </div>

              {/* Citations */}
              {citations && citations.length > 0 && (
                <div className="mt-3 border-t border-border/30 pt-2">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
                    Sources
                  </p>
                  <div className="space-y-0.5">
                    {citations.map((cite) => (
                      <div
                        key={cite.index}
                        className="text-[11px] text-muted-foreground"
                      >
                        <span className="font-medium text-primary/70">
                          [{cite.index + 1}]
                        </span>{" "}
                        {cite.source.url ? (
                          <a
                            href={cite.source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:text-foreground"
                          >
                            {cite.source.title}
                          </a>
                        ) : (
                          <span>
                            {cite.source.title}
                            {cite.source.page != null && `, p. ${cite.source.page}`}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <User className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}
