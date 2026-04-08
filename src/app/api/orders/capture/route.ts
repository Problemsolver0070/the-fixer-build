import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getUserByClerkId,
  getPurchaseByOrderId,
  updatePurchaseStatus,
  getUserAccess,
  upsertUserAccess,
  updateUserPlan,
} from "@/lib/db/queries";
import { capturePayPalOrder } from "@/lib/paypal/orders";
import { getProduct } from "@/lib/access/products";

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await getUserByClerkId(clerkId);
    if (!dbUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await req.json();
    const { orderId } = body as { orderId?: string };

    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json(
        { error: "Missing orderId" },
        { status: 400 }
      );
    }

    const purchase = await getPurchaseByOrderId(orderId);
    if (!purchase) {
      return NextResponse.json(
        { error: "Purchase not found" },
        { status: 404 }
      );
    }
    if (purchase.userId !== dbUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (purchase.status === "completed") {
      return NextResponse.json({ success: true, alreadyProcessed: true });
    }

    const capture = await capturePayPalOrder(orderId);
    if (capture.status !== "COMPLETED") {
      await updatePurchaseStatus(orderId, "failed");
      return NextResponse.json(
        { error: "Payment not completed", paypalStatus: capture.status },
        { status: 402 }
      );
    }

    await updatePurchaseStatus(orderId, "completed", capture.captureId ?? undefined);

    const product = getProduct(purchase.passType);
    if (!product) {
      console.error("Unknown pass type in purchase:", purchase.passType);
      return NextResponse.json(
        { error: "Unknown pass type" },
        { status: 500 }
      );
    }

    const now = new Date();
    const currentAccess = await getUserAccess(dbUser.id);

    if (product.isPausable) {
      const currentSeconds = currentAccess?.pausableRemainingSeconds ?? 0;
      const currentStatus = currentAccess?.pausableStatus ?? "none";

      let snapshotSeconds = currentSeconds;
      if (
        currentStatus === "active" &&
        currentAccess?.pausableLastResumedAt
      ) {
        const elapsed =
          (now.getTime() -
            new Date(currentAccess.pausableLastResumedAt).getTime()) /
          1000;
        snapshotSeconds = Math.max(0, Math.floor(currentSeconds - elapsed));
      }

      const newSeconds = snapshotSeconds + product.durationSeconds;

      await upsertUserAccess(dbUser.id, {
        pausableRemainingSeconds: newSeconds,
        pausableStatus: "active",
        pausableLastResumedAt: now,
      });
    } else {
      const currentExpiry = currentAccess?.continuousExpiresAt
        ? new Date(currentAccess.continuousExpiresAt)
        : null;

      const baseTime =
        currentExpiry && currentExpiry > now ? currentExpiry : now;
      const newExpiry = new Date(
        baseTime.getTime() + product.durationSeconds * 1000
      );

      await upsertUserAccess(dbUser.id, {
        continuousExpiresAt: newExpiry,
      });
    }

    await updateUserPlan(dbUser.id, "active");

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Capture order error:", err);
    return NextResponse.json(
      { error: "Failed to capture order" },
      { status: 500 }
    );
  }
}
