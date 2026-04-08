import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  getUserByClerkId,
  getConversation,
  updateConversationTitle,
  deleteConversation,
} from "@/lib/db/queries";
import { isValidUUID } from "@/lib/utils";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { deleteBlob } from "@/lib/storage/azure-blob";
import type { Attachment } from "@/lib/types/attachment";

type RouteContext = { params: Promise<{ id: string }> };

// ─── GET /api/conversations/:id ──────────────────────────────────────────────

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await getUserByClerkId(clerkId);
    if (!dbUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json(
        { error: "Invalid conversation ID" },
        { status: 400 }
      );
    }

    const conversation = await getConversation(id, dbUser.id);
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: conversation.id,
      title: conversation.title,
      mode: conversation.mode,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("GET /api/conversations/[id] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── PATCH /api/conversations/:id ────────────────────────────────────────────

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await getUserByClerkId(clerkId);
    if (!dbUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json(
        { error: "Invalid conversation ID" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { title } = body as { title?: string };

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }

    if (title.trim().length > 200) {
      return NextResponse.json(
        { error: "Title too long (max 200 characters)" },
        { status: 400 }
      );
    }

    const conversation = await updateConversationTitle(
      id,
      dbUser.id,
      title.trim()
    );
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: conversation.id,
      title: conversation.title,
      mode: conversation.mode,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("PATCH /api/conversations/[id] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── DELETE /api/conversations/:id ───────────────────────────────────────────

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await getUserByClerkId(clerkId);
    if (!dbUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json(
        { error: "Invalid conversation ID" },
        { status: 400 }
      );
    }

    // Clean up orphaned blobs before deleting the conversation
    try {
      const msgs = await db
        .select({ attachments: messages.attachments })
        .from(messages)
        .where(eq(messages.conversationId, id));

      const blobKeys: string[] = [];
      for (const msg of msgs) {
        if (msg.attachments && Array.isArray(msg.attachments)) {
          for (const att of msg.attachments as Attachment[]) {
            if (att.blobKey) blobKeys.push(att.blobKey);
          }
        }
      }

      if (blobKeys.length > 0) {
        await Promise.allSettled(blobKeys.map((key) => deleteBlob(key)));
      }
    } catch (blobErr) {
      console.error("Failed to clean up blobs for conversation:", id, blobErr);
    }

    await deleteConversation(id, dbUser.id);

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("DELETE /api/conversations/[id] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
