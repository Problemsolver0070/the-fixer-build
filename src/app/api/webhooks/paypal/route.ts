import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/paypal/client";
import {
  getPurchaseByOrderId,
  claimPurchaseForCompletion,
  updatePurchaseStatus,
} from "@/lib/db/queries";
import { getProduct } from "@/lib/access/products";
import { grantTimeForPurchase, revokeTimeForPurchase } from "@/lib/access/grant";

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();

    const headers: Record<string, string> = {};
    const paypalHeaders = [
      "paypal-auth-algo",
      "paypal-cert-url",
      "paypal-transmission-id",
      "paypal-transmission-sig",
      "paypal-transmission-time",
    ];
    for (const key of paypalHeaders) {
      const value = req.headers.get(key);
      if (value) headers[key] = value;
    }

    const isValid = await verifyWebhookSignature(headers, body);
    if (!isValid) {
      console.error("PayPal webhook signature verification failed");
      return NextResponse.json(
        { error: "Invalid webhook signature" },
        { status: 401 }
      );
    }

    const event = JSON.parse(body);
    const eventType: string = event.event_type;
    const resource = event.resource;

    console.log(`PayPal webhook received: ${eventType}`);

    switch (eventType) {
      case "PAYMENT.CAPTURE.COMPLETED": {
        await handleCaptureCompleted(resource);
        break;
      }

      case "PAYMENT.CAPTURE.DENIED":
      case "PAYMENT.CAPTURE.REFUNDED": {
        await handleCaptureFailed(resource, eventType);
        break;
      }

      default: {
        console.log(`Unhandled PayPal event type: ${eventType}`);
      }
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    console.error("PayPal webhook error:", err);
    return NextResponse.json(
      { received: true, error: "processing_failed" },
      { status: 200 }
    );
  }
}

async function handleCaptureCompleted(resource: Record<string, unknown>) {
  const captureId = resource.id as string | undefined;

  const supplementaryData = resource.supplementary_data as
    | Record<string, unknown>
    | undefined;
  const relatedIds = supplementaryData?.related_ids as
    | Record<string, string>
    | undefined;
  const orderId = relatedIds?.order_id;

  if (!orderId) {
    console.log("PAYMENT.CAPTURE.COMPLETED: no order_id found, skipping");
    return;
  }

  const purchase = await getPurchaseByOrderId(orderId);
  if (!purchase) {
    console.log(`No purchase record for order ${orderId}`);
    return;
  }

  if (purchase.status === "completed") {
    console.log(`Purchase for order ${orderId} already completed`);
    return;
  }

  // Atomically claim this purchase — prevents double-grant if capture endpoint races
  const claimed = await claimPurchaseForCompletion(orderId, captureId);
  if (!claimed) {
    console.log(`Purchase for order ${orderId} already claimed by another handler`);
    return;
  }

  const product = getProduct(purchase.passType);
  if (!product) {
    console.error("Unknown pass type:", purchase.passType);
    return;
  }

  await grantTimeForPurchase(purchase.userId, product);
  console.log(`Webhook: capture completed for order ${orderId}`);
}

async function handleCaptureFailed(
  resource: Record<string, unknown>,
  eventType: string
) {
  const supplementaryData = resource.supplementary_data as
    | Record<string, unknown>
    | undefined;
  const relatedIds = supplementaryData?.related_ids as
    | Record<string, string>
    | undefined;
  const orderId = relatedIds?.order_id;

  if (!orderId) {
    console.log(`${eventType}: no order_id found, skipping`);
    return;
  }

  const purchase = await getPurchaseByOrderId(orderId);
  const status = eventType === "PAYMENT.CAPTURE.REFUNDED" ? "refunded" : "failed";
  await updatePurchaseStatus(orderId, status);

  // Revoke granted time if the purchase was previously completed
  if (purchase && purchase.status === "completed") {
    const product = getProduct(purchase.passType);
    if (product) {
      await revokeTimeForPurchase(purchase.userId, product);
    }
  }

  console.log(`Webhook: ${status} for order ${orderId}`);
}
