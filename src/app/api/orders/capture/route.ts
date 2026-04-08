import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getUserByClerkId,
  getPurchaseByOrderId,
  claimPurchaseForCompletion,
  updatePurchaseStatus,
} from "@/lib/db/queries";
import { capturePayPalOrder } from "@/lib/paypal/orders";
import { getProduct } from "@/lib/access/products";
import { grantTimeForPurchase } from "@/lib/access/grant";

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

    // Atomically claim this purchase — prevents double-grant if webhook races
    const claimed = await claimPurchaseForCompletion(orderId, capture.captureId ?? undefined);
    if (!claimed) {
      // Another handler (webhook) already processed this purchase
      return NextResponse.json({ success: true, alreadyProcessed: true });
    }

    const product = getProduct(purchase.passType);
    if (!product) {
      console.error("Unknown pass type in purchase:", purchase.passType);
      return NextResponse.json(
        { error: "Unknown pass type" },
        { status: 500 }
      );
    }

    await grantTimeForPurchase(dbUser.id, product);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Capture order error:", err);
    return NextResponse.json(
      { error: "Failed to capture order" },
      { status: 500 }
    );
  }
}
