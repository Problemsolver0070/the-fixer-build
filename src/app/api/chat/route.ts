export const maxDuration = 120;

import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { getClient, MODEL } from "@/lib/ai/client";
import { buildChatMessages, type ChatMessage } from "@/lib/ai/prompts";
import {
  sanitizeStreamChunk,
  sanitizeResponse,
  flushBuffer,
} from "@/lib/ai/sanitizer";
import { buildContentBlocks, summarizeAttachments } from "@/lib/ai/attachments";
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

    // 3. Access check (trial / purchased time)
    const canAccess = await hasAccessCheck(dbUser);
    if (!canAccess) {
      // Transition plan to 'expired' if not already
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

    // Validate input sizes
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

    // Validate attachment ownership
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

    // Validate mode at runtime
    const validModes = ["chat", "build"];
    const safeMode = validModes.includes(mode) ? mode : "chat";

    // 5. Conversation — create if needed
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

    // 7. Load last 50 messages as history
    const recentMessages = await getMessages(conversationId, dbUser.id, 50);
    // History = all recent messages except the last one (the user message we just saved)
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

    // 8b. Build content blocks for current message's attachments
    if (incomingAttachments?.length) {
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg.role === "user") {
        lastMsg.content = await buildContentBlocks(
          trimmedMessage,
          incomingAttachments
        );
      }
    }

    // 9. Stream response via SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Send conversation ID immediately
        controller.enqueue(
          encoder.encode(
            sseEvent({ type: "conversation_id", id: conversationId })
          )
        );

        let fullRawContent = "";
        const buffer = { value: "" };

        try {
          const response = getClient().messages.stream({
            model: MODEL,
            max_tokens: safeMode === "build" ? 100000 : 16000,
            system: systemPrompt,
            messages: msgs,
          });

          for await (const event of response) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              const rawChunk = event.delta.text;
              fullRawContent += rawChunk;

              const sanitized = sanitizeStreamChunk(rawChunk, buffer);
              if (sanitized) {
                controller.enqueue(
                  encoder.encode(sseEvent({ type: "text", content: sanitized }))
                );
              }
            }
          }

          // Flush remaining buffer
          const remaining = flushBuffer(buffer);
          if (remaining) {
            controller.enqueue(
              encoder.encode(sseEvent({ type: "text", content: remaining }))
            );
          }

          // Save the full sanitized assistant message to DB
          const sanitizedFull = sanitizeResponse(fullRawContent);
          await createMessage(conversationId!, "assistant", sanitizedFull, null, dbUser.id);

          // Auto-title on first message
          if (isFirstMessage) {
            const trimmed = trimmedMessage;
            const title =
              trimmed.length > 60 ? trimmed.slice(0, 60) + "..." : trimmed;
            await updateConversationTitle(
              conversationId!,
              dbUser.id,
              title
            );
            controller.enqueue(
              encoder.encode(sseEvent({ type: "title", title }))
            );
          }

          controller.enqueue(encoder.encode(sseEvent({ type: "done" })));
        } catch (err) {
          console.error("AI stream error:", err);

          // Flush buffer on error
          flushBuffer(buffer);

          controller.enqueue(
            encoder.encode(
              sseEvent({
                type: "error",
                message: "Something went wrong. Please try again.",
              })
            )
          );
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
