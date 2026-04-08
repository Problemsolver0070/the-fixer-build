import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId, getUserAccess } from "@/lib/db/queries";
import { computeAccessState } from "@/lib/access/check";

export async function GET() {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await getUserByClerkId(clerkId);
    if (!dbUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const access = await getUserAccess(dbUser.id);
    const state = computeAccessState(access ?? null, dbUser.trialExpiresAt);

    return NextResponse.json(state);
  } catch (err) {
    console.error("Access API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
