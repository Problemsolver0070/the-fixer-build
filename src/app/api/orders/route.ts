import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId, createPurchase } from "@/lib/db/queries";
import { createPayPalOrder } from "@/lib/paypal/orders";
import { getProduct, isValidPassType } from "@/lib/access/products";

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
    const { passType } = body as { passType?: string };

    if (!passType || !isValidPassType(passType)) {
      return NextResponse.json(
        { error: "Invalid pass type" },
        { status: 400 }
      );
    }

    const product = getProduct(passType)!;

    const paypalOrderId = await createPayPalOrder({
      amountUsd: product.price,
      description: product.description,
      customId: dbUser.id,
    });

    await createPurchase({
      userId: dbUser.id,
      passType,
      amountUsd: product.price,
      paypalOrderId,
    });

    return NextResponse.json({ orderId: paypalOrderId });
  } catch (err) {
    console.error("Create order error:", err);
    return NextResponse.json(
      { error: "Failed to create order" },
      { status: 500 }
    );
  }
}
