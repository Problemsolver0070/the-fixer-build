// ─── PayPal Orders API v2 ────────────────────────────────────────────────────

import { getAccessToken } from "./client";

function getPayPalBaseUrl(): string {
  if (process.env.PAYPAL_BASE_URL) return process.env.PAYPAL_BASE_URL;
  return process.env.NODE_ENV === "production"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

/**
 * Create a PayPal order for a one-time payment.
 * Returns the PayPal order ID.
 */
export async function createPayPalOrder(opts: {
  amountUsd: string;
  description: string;
  customId: string;
}): Promise<string> {
  const accessToken = await getAccessToken();

  const res = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "USD",
            value: opts.amountUsd,
          },
          description: opts.description,
          custom_id: opts.customId,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal create order failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.id as string;
}

/**
 * Capture an approved PayPal order.
 * Returns the capture details.
 */
export async function capturePayPalOrder(orderId: string): Promise<{
  status: string;
  captureId: string | null;
  customId: string | null;
}> {
  const accessToken = await getAccessToken();

  const res = await fetch(
    `${getPayPalBaseUrl()}/v2/checkout/orders/${orderId}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal capture order failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const status: string = data.status ?? "UNKNOWN";

  // Extract capture ID from the first capture in the first purchase unit
  let captureId: string | null = null;
  let customId: string | null = null;
  const units = data.purchase_units;
  if (Array.isArray(units) && units.length > 0) {
    customId = units[0].payments?.captures?.[0]?.custom_id ?? units[0].custom_id ?? null;
    captureId = units[0].payments?.captures?.[0]?.id ?? null;
  }

  return { status, captureId, customId };
}
