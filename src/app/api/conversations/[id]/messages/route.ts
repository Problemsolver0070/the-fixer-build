import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getUserByClerkId, getMessages } from "@/lib/db/queries";
import { isValidUUID } from "@/lib/utils";

type RouteContext = { params: Promise<{ id: string }> };

// ─── GET /api/conversations/:id/messages ─────────────────────────────────────

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

    const messages = await getMessages(id, dbUser.id);

    return NextResponse.json(
      messages.map((m) => {
        const meta = m.metadata as Record<string, unknown> | null;
        return {
          id: m.id,
          role: m.role,
          content: m.content,
          attachments: m.attachments ?? null,
          createdAt: m.createdAt.toISOString(),
          thinkingContent: meta?.thinkingContent ?? undefined,
          thinkingDurationMs: meta?.thinkingDurationMs ?? undefined,
          citations: meta?.citations ?? undefined,
        };
      })
    );
  } catch (error) {
    console.error("GET /api/conversations/[id]/messages error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
