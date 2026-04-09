"use client";

import { useState } from "react";
import { ChevronRight, Brain } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThinkingBlockProps {
  content: string;
  durationMs?: number;
  isStreaming?: boolean;
}

export function ThinkingBlock({
  content,
  durationMs,
  isStreaming = false,
}: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(isStreaming);

  const durationLabel = durationMs
    ? durationMs >= 1000
      ? `${(durationMs / 1000).toFixed(1)}s`
      : `${durationMs}ms`
    : null;

  return (
    <div className="mb-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform duration-200",
            isExpanded && "rotate-90"
          )}
        />
        <Brain className="h-3 w-3" />
        {isStreaming ? (
          <span className="animate-pulse">Thinking...</span>
        ) : (
          <span>
            Thought{durationLabel ? ` for ${durationLabel}` : ""}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="mt-1 ml-6 rounded-md border border-border/40 bg-muted/30 px-3 py-2">
          <pre className="whitespace-pre-wrap text-xs text-muted-foreground font-mono leading-relaxed">
            {content}
            {isStreaming && (
              <span className="ml-0.5 inline-block h-3 w-1 animate-pulse rounded-sm bg-muted-foreground/50" />
            )}
          </pre>
        </div>
      )}
    </div>
  );
}
