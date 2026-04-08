import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getUserByClerkId,
  getUserAccess,
  updateUserAccess,
  updateUserPlan,
} from "@/lib/db/queries";

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
    if (
      !access ||
      access.pausableStatus !== "paused" ||
      access.pausableRemainingSeconds <= 0
    ) {
      return NextResponse.json(
        { error: "No paused time to resume" },
        { status: 400 }
      );
    }

    const now = new Date();
    await updateUserAccess(dbUser.id, {
      pausableStatus: "active",
      pausableLastResumedAt: now,
    });

    await updateUserPlan(dbUser.id, "active");

    return NextResponse.json({
      success: true,
      remainingSeconds: access.pausableRemainingSeconds,
    });
  } catch (err) {
    console.error("Resume error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
