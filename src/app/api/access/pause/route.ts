import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId, getUserAccess, updateUserAccess } from "@/lib/db/queries";

export async function POST() {
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
    if (!access || access.pausableStatus !== "active" || !access.pausableLastResumedAt) {
      return NextResponse.json(
        { error: "No active pausable timer to pause" },
        { status: 400 }
      );
    }

    const now = new Date();
    const elapsed =
      (now.getTime() - new Date(access.pausableLastResumedAt).getTime()) / 1000;
    const remaining = Math.max(
      0,
      Math.floor(access.pausableRemainingSeconds - elapsed)
    );

    if (remaining <= 0) {
      return NextResponse.json(
        { error: "Pausable time has already expired" },
        { status: 400 }
      );
    }

    await updateUserAccess(dbUser.id, {
      pausableRemainingSeconds: remaining,
      pausableStatus: "paused",
      pausableLastResumedAt: null,
    });

    return NextResponse.json({ success: true, remainingSeconds: remaining });
  } catch (err) {
    console.error("Pause error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
