"use client";

import { useState } from "react";
import { ChevronRight, Search, Globe, Terminal, FileCode } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolBlockProps {
  name: string;
  toolUseId: string;
  input?: string;
  result?: string;
  isError?: boolean;
  isStreaming?: boolean;
}

const TOOL_CONFIG: Record<
  string,
  {
    icon: typeof Search;
    activeLabel: string;
    doneLabel: string | ((input?: string, result?: string) => string);
  }
> = {
  web_search: {
    icon: Search,
    activeLabel: "Searching the web...",
    doneLabel: "Searched the web",
  },
  web_fetch: {
    icon: Globe,
    activeLabel: "Reading page...",
    doneLabel: (input?: string) => {
      try {
        const parsed = JSON.parse(input || "{}");
        const url = parsed.url || "";
        const domain = url ? new URL(url).hostname : "";
        return domain ? `Fetched ${domain}` : "Fetched page";
      } catch {
        return "Fetched page";
      }
    },
  },
  code_execution: {
    icon: Terminal,
    activeLabel: "Running code...",
    doneLabel: "Ran code",
  },
  write_files: {
    icon: FileCode,
    activeLabel: "Writing files...",
    doneLabel: (_input?: string, result?: string) => {
      const match = result?.match(/Files written successfully: (.+)/);
      if (match) {
        const fileCount = match[1].split(",").length;
        return `Wrote ${fileCount} file${fileCount !== 1 ? "s" : ""}`;
      }
      return "Wrote files";
    },
  },
};

export function ToolBlock({
  name,
  input,
  result,
  isError,
  isStreaming = false,
}: ToolBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const config = TOOL_CONFIG[name] || {
    icon: Terminal,
    activeLabel: `Using ${name}...`,
    doneLabel: `Used ${name}`,
  };
  const Icon = config.icon;

  const doneLabel =
    typeof config.doneLabel === "function"
      ? config.doneLabel(input, result)
      : config.doneLabel;

  return (
    <div className="mb-2">
      <button
        onClick={() => !isStreaming && setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform duration-200",
            isExpanded && "rotate-90"
          )}
        />
        <Icon className={cn("h-3 w-3", isStreaming && "animate-pulse")} />
        {isStreaming ? (
          <span className="animate-pulse">{config.activeLabel}</span>
        ) : (
          <span>{doneLabel}</span>
        )}
        {isError && (
          <span className="ml-1 text-destructive">(error)</span>
        )}
      </button>

      {isExpanded && (result || input) && (
        <div className="mt-1 ml-6 rounded-md border border-border/40 bg-muted/30 px-3 py-2">
          <pre className="whitespace-pre-wrap text-xs text-muted-foreground font-mono leading-relaxed max-h-60 overflow-y-auto">
            {result || input}
          </pre>
        </div>
      )}
    </div>
  );
}
