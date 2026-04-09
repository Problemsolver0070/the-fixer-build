// lambda-chat/src/handler.ts
// Thin AWS Lambda wrapper — all AI/DB logic is imported from shared modules.

import { verifyToken } from "@clerk/backend";
import {
  getUserByClerkId,
  getUserAccess,
  getConversation,
  createConversation,
  getMessages,
  createMessage,
  updateConversationTitle,
} from "@/lib/db/queries";
import { computeAccessState } from "@/lib/access/check";
import { buildChatMessages, type ChatMessage } from "@/lib/ai/prompts";
import { buildContentBlocks, summarizeAttachments } from "@/lib/ai/attachments";
import { streamChat } from "@/lib/ai/stream-handler";
import type { Attachment } from "@/lib/types/attachment";

// --- Helpers ----------------------------------------------------------------

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
    return parts[1];
  }
  return null;
}

// --- Lambda Handler ---------------------------------------------------------

declare const awslambda: {
  streamifyResponse: (
    handler: (
      event: Record<string, unknown>,
      responseStream: NodeJS.WritableStream & {
        setContentType: (type: string) => void;
      },
      context: unknown
    ) => Promise<void>
  ) => unknown;
  HttpResponseStream: {
    from: (
      stream: NodeJS.WritableStream,
      metadata: Record<string, unknown>
    ) => NodeJS.WritableStream & { write: (data: string) => void; end: () => void };
  };
};

export const handler = awslambda.streamifyResponse(
  async (event, responseStream, _context) => {
    const method = (event.requestContext as Record<string, Record<string, string>>)?.http?.method;
    const headers = event.headers as Record<string, string>;

    if (method !== "POST") {
      const metadata = { statusCode: 405, headers: { "Content-Type": "application/json" } };
      const stream = awslambda.HttpResponseStream.from(responseStream, metadata);
      stream.write(JSON.stringify({ error: "Method not allowed" }));
      stream.end();
      return;
    }

    function writeError(statusCode: number, error: string) {
      const metadata = { statusCode, headers: { "Content-Type": "application/json" } };
      const stream = awslambda.HttpResponseStream.from(responseStream, metadata);
      stream.write(JSON.stringify({ error }));
      stream.end();
    }

    try {
      // 1. Auth
      const authHeader = headers?.["authorization"] || headers?.["Authorization"];
      const token = extractBearerToken(authHeader);
      if (!token) { writeError(401, "Unauthorized"); return; }

      let clerkUserId: string;
      try {
        const payload = await verifyToken(token, {
          secretKey: process.env.CLERK_SECRET_KEY!,
        });
        clerkUserId = payload.sub;
      } catch {
        writeError(401, "Unauthorized: Invalid token");
        return;
      }

      // 2. DB user
      const dbUser = await getUserByClerkId(clerkUserId);
      if (!dbUser) { writeError(404, "User not found"); return; }

      // 3. Access check (uses shared time-passes logic)
      const access = await getUserAccess(dbUser.id);
      const state = computeAccessState(access ?? null, dbUser.trialExpiresAt);
      if (!state.hasAccess) {
        writeError(402, "Access expired. Please purchase a pass.");
        return;
      }

      // 4. Parse body
      let body: Record<string, unknown>;
      try {
        const rawBody = (event as Record<string, unknown>).isBase64Encoded
          ? Buffer.from(event.body as string, "base64").toString("utf-8")
          : event.body as string;
        body = JSON.parse(rawBody);
      } catch {
        writeError(400, "Invalid JSON body");
        return;
      }

      const {
        message,
        conversationId: incomingConversationId,
        mode = "chat",
        attachments: incomingAttachments,
      } = body as {
        message: string;
        conversationId?: string;
        mode?: string;
        attachments?: Attachment[];
      };

      const hasAttachments = incomingAttachments && incomingAttachments.length > 0;
      const trimmedMessage = (message && typeof message === "string") ? message.trim() : "";
      if (trimmedMessage.length === 0 && !hasAttachments) {
        writeError(400, "Message is required");
        return;
      }
      if (trimmedMessage.length > 50_000) { writeError(400, "Message too long"); return; }
      if (incomingAttachments && incomingAttachments.length > 10) { writeError(400, "Too many attachments"); return; }

      // Validate attachment ownership
      if (incomingAttachments?.length) {
        const prefix = `uploads/${dbUser.id}/`;
        for (const att of incomingAttachments) {
          if (!att.blobKey || typeof att.blobKey !== "string" || !att.blobKey.startsWith(prefix) || att.blobKey.includes("..")) {
            writeError(403, "Invalid attachment");
            return;
          }
        }
      }

      const validModes = ["chat", "build"];
      const safeMode = (validModes.includes(mode as string) ? mode : "chat") as "chat" | "build";

      // 5. Conversation
      let conversationId = incomingConversationId as string | undefined;
      let isFirstMessage = false;

      if (conversationId) {
        const existing = await getConversation(conversationId, dbUser.id);
        if (!existing) { writeError(404, "Conversation not found"); return; }
      } else {
        const conversation = await createConversation(dbUser.id, safeMode);
        conversationId = conversation.id;
        isFirstMessage = true;
      }

      // 6. Save user message
      await createMessage(
        conversationId,
        "user",
        trimmedMessage,
        incomingAttachments?.length ? incomingAttachments : null,
        dbUser.id
      );

      // 7. History
      const recentMessages = await getMessages(conversationId, dbUser.id, 50);
      const history: ChatMessage[] = recentMessages.slice(0, -1).map((m) => ({
        role: m.role as "user" | "assistant",
        content: summarizeAttachments(m.content, m.attachments as Attachment[] | null),
      }));

      // 8. Build prompt
      const { system: systemPrompt, messages: msgs } = buildChatMessages(
        history,
        trimmedMessage,
        safeMode,
        { userName: dbUser.name ?? undefined }
      );

      if (incomingAttachments?.length) {
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg.role === "user") {
          lastMsg.content = await buildContentBlocks(trimmedMessage, incomingAttachments);
        }
      }

      // 9. Start SSE streaming
      const metadata = {
        statusCode: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        },
      };
      const stream = awslambda.HttpResponseStream.from(responseStream, metadata);

      stream.write(sseEvent({ type: "conversation_id", id: conversationId }));

      const generator = streamChat({
        systemPrompt,
        messages: msgs,
        mode: safeMode,
      });

      let result: {
        content: string;
        thinkingContent?: string;
        thinkingDurationMs?: number;
        citations?: unknown[];
        toolUses?: unknown[];
        images?: unknown[];
        files?: unknown[];
      } | undefined;

      try {
        while (true) {
          const { done, value } = await generator.next();
          if (done) {
            result = value;
            break;
          }
          stream.write(sseEvent(value as unknown as Record<string, unknown>));
        }

        // Save assistant message
        if (result) {
          const msgMetadata: Record<string, unknown> = {};
          if (result.thinkingContent) msgMetadata.thinkingContent = result.thinkingContent;
          if (result.thinkingDurationMs) msgMetadata.thinkingDurationMs = result.thinkingDurationMs;
          if (result.citations && result.citations.length > 0) msgMetadata.citations = result.citations;
          if (result.toolUses && result.toolUses.length > 0) msgMetadata.toolUses = result.toolUses;
          if (result.images && result.images.length > 0) msgMetadata.images = result.images;

          await createMessage(
            conversationId!,
            "assistant",
            result.content,
            null,
            dbUser.id,
            Object.keys(msgMetadata).length > 0 ? msgMetadata : null
          );
        }

        // Auto-title
        if (isFirstMessage) {
          const title = trimmedMessage.length > 60
            ? trimmedMessage.slice(0, 60) + "..."
            : trimmedMessage;
          await updateConversationTitle(conversationId!, dbUser.id, title);
          stream.write(sseEvent({ type: "title", title }));
        }
      } catch (err) {
        console.error("Lambda stream error:", err);
        stream.write(sseEvent({ type: "error", message: "Something went wrong. Please try again." }));
      }

      stream.end();
    } catch (err) {
      console.error("Lambda handler error:", err);
      try {
        writeError(500, "Internal server error");
      } catch {
        responseStream.end();
      }
    }
  }
);
