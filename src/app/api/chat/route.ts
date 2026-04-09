export const maxDuration = 120;

import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { buildChatMessages, type ChatMessage } from "@/lib/ai/prompts";
import { buildContentBlocks, summarizeAttachments } from "@/lib/ai/attachments";
import { streamChat } from "@/lib/ai/stream-handler";
import type { Attachment } from "@/lib/types/attachment";
import {
  getUserByClerkId,
  getUserAccess,
  updateUserPlan,
  createConversation,
  getConversation,
  getMessages,
  createMessage,
  updateConversationTitle,
} from "@/lib/db/queries";
import { computeAccessState } from "@/lib/access/check";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function hasAccessCheck(user: {
  id: string;
  plan: string;
  trialExpiresAt: Date | null;
}): Promise<boolean> {
  const access = await getUserAccess(user.id);
  const state = computeAccessState(access ?? null, user.trialExpiresAt);
  return state.hasAccess;
}

// ─── POST /api/chat ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // 1. Auth
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. DB user
    const dbUser = await getUserByClerkId(clerkId);
    if (!dbUser) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. Access check
    const canAccess = await hasAccessCheck(dbUser);
    if (!canAccess) {
      if (dbUser.plan !== "trial" && dbUser.plan !== "expired") {
        await updateUserPlan(dbUser.id, "expired");
      }
      return new Response(
        JSON.stringify({ error: "Access expired. Please purchase a pass." }),
        { status: 402, headers: { "Content-Type": "application/json" } }
      );
    }

    // 4. Parse body
    const body = await req.json();
    const {
      message,
      conversationId: incomingConversationId,
      mode = "chat",
      attachments: incomingAttachments,
    } = body as {
      message: string;
      conversationId?: string;
      mode?: "chat" | "build";
      attachments?: Attachment[];
    };

    const hasAttachments = incomingAttachments && incomingAttachments.length > 0;
    const trimmedMessage = (message && typeof message === "string") ? message.trim() : "";
    if (trimmedMessage.length === 0 && !hasAttachments) {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (trimmedMessage.length > 50_000) {
      return new Response(
        JSON.stringify({ error: "Message too long (max 50,000 characters)" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    if (incomingAttachments && incomingAttachments.length > 10) {
      return new Response(
        JSON.stringify({ error: "Too many attachments (max 10)" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (incomingAttachments?.length) {
      const prefix = `uploads/${dbUser.id}/`;
      for (const att of incomingAttachments) {
        if (!att.blobKey || typeof att.blobKey !== "string" || !att.blobKey.startsWith(prefix) || att.blobKey.includes("..")) {
          return new Response(
            JSON.stringify({ error: "Invalid attachment" }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
      }
    }

    const validModes = ["chat", "build"];
    const safeMode = validModes.includes(mode) ? mode : "chat";

    // 5. Conversation
    let conversationId = incomingConversationId;
    let isFirstMessage = false;

    if (conversationId) {
      const existing = await getConversation(conversationId, dbUser.id);
      if (!existing) {
        return new Response(
          JSON.stringify({ error: "Conversation not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }
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

    // 7. Load history
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

    // 8b. Attachment content blocks
    if (incomingAttachments?.length) {
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg.role === "user") {
        lastMsg.content = await buildContentBlocks(
          trimmedMessage,
          incomingAttachments
        );
      }
    }

    // 9. Stream response via shared handler
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(
          encoder.encode(sseEvent({ type: "conversation_id", id: conversationId }))
        );

        const generator = streamChat({
          systemPrompt,
          messages: msgs,
          mode: safeMode as "chat" | "build",
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
            // Forward each SSE event to the client
            controller.enqueue(encoder.encode(sseEvent(value as unknown as Record<string, unknown>)));
          }

          // Save assistant message to DB
          if (result) {
            const metadata: Record<string, unknown> = {};
            if (result.thinkingContent) metadata.thinkingContent = result.thinkingContent;
            if (result.thinkingDurationMs) metadata.thinkingDurationMs = result.thinkingDurationMs;
            if (result.citations && result.citations.length > 0) metadata.citations = result.citations;
            if (result.toolUses && result.toolUses.length > 0) metadata.toolUses = result.toolUses;
            if (result.images && result.images.length > 0) metadata.images = result.images;

            await createMessage(
              conversationId!,
              "assistant",
              result.content,
              null,
              dbUser.id,
              Object.keys(metadata).length > 0 ? metadata : null
            );
          }

          // Auto-title on first message
          if (isFirstMessage) {
            const title = trimmedMessage.length > 60
              ? trimmedMessage.slice(0, 60) + "..."
              : trimmedMessage;
            await updateConversationTitle(conversationId!, dbUser.id, title);
            controller.enqueue(encoder.encode(sseEvent({ type: "title", title })));
          }
        } catch (err) {
          console.error("Stream processing error:", err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("Chat API error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
