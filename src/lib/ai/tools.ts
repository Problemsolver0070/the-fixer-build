// src/lib/ai/tools.ts

import { getClient } from "@/lib/ai/client";
import type { ToolUnion, Tool } from "@anthropic-ai/sdk/resources/messages/messages";

// ─── Server-Managed Tools ────────────────────────────────────────────────────
// Anthropic executes these — no server-side handler needed.

const WEB_SEARCH_TOOL = {
  type: "web_search_20260209" as const,
  name: "web_search" as const,
};

const WEB_FETCH_TOOL = {
  type: "web_fetch_20260309" as const,
  name: "web_fetch" as const,
};

const CODE_EXECUTION_TOOL = {
  type: "code_execution_20260120" as const,
  name: "code_execution" as const,
};

// ─── Custom Tools ────────────────────────────────────────────────────────────

const WRITE_FILES_TOOL: Tool = {
  name: "write_files",
  description:
    "Write one or more files to the project. Use this whenever you generate, create, or modify files for the user's project.",
  input_schema: {
    type: "object" as const,
    properties: {
      files: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "File path relative to project root",
            },
            content: {
              type: "string",
              description: "Full file content",
            },
          },
          required: ["path", "content"],
        },
        description: "Array of files to write",
      },
    },
    required: ["files"],
  },
};

// ─── Tool Selection ──────────────────────────────────────────────────────────

export function getToolsForMode(mode: "chat" | "build"): ToolUnion[] {
  const serverTools: ToolUnion[] = [WEB_SEARCH_TOOL, WEB_FETCH_TOOL, CODE_EXECUTION_TOOL];
  if (mode === "build") {
    return [...serverTools, WRITE_FILES_TOOL];
  }
  return serverTools;
}

// ─── Custom Tool Executors ───────────────────────────────────────────────────

export interface WriteFilesInput {
  files: { path: string; content: string }[];
}

export function executeWriteFiles(input: unknown): {
  files: { path: string; content: string }[];
  resultText: string;
} {
  const parsed = input as WriteFilesInput;

  // Validate input structure
  if (!parsed || !Array.isArray(parsed.files)) {
    return { files: [], resultText: "Error: invalid input — expected { files: [...] }" };
  }

  const files = parsed.files.filter(
    (f) => typeof f.path === "string" && typeof f.content === "string"
  );

  return {
    files,
    resultText: `Files written successfully: ${files.map((f) => f.path).join(", ")}`,
  };
}

// ─── Code Execution Image Download ──────────────────────────────────────────

export async function downloadCodeExecutionImages(
  fileIds: string[]
): Promise<{ base64: string; mediaType: string }[]> {
  const client = getClient();
  const images: { base64: string; mediaType: string }[] = [];

  for (const fileId of fileIds) {
    try {
      // Get metadata first to know the MIME type
      const metadata = await (client as unknown as {
        beta: {
          files: {
            retrieveMetadata: (id: string) => Promise<{ mime_type: string }>;
            download: (id: string) => Promise<Response>;
          };
        };
      }).beta.files.retrieveMetadata(fileId);

      // Only process image files
      if (!metadata.mime_type?.startsWith("image/")) continue;

      // Download the file content
      const response = await (client as unknown as {
        beta: {
          files: {
            download: (id: string) => Promise<Response>;
          };
        };
      }).beta.files.download(fileId);

      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");

      images.push({
        base64,
        mediaType: metadata.mime_type,
      });
    } catch (err) {
      console.error(`Failed to download code execution image ${fileId}:`, err);
      // Skip failed downloads — don't break the stream
    }
  }

  return images;
}
