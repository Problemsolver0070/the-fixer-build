// ─── PayPal REST API Client ──────────────────────────────────────────────────

function getPayPalBaseUrl(): string {
  if (process.env.PAYPAL_BASE_URL) return process.env.PAYPAL_BASE_URL;
  return process.env.NODE_ENV === "production"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

/**
 * Fetch a short-lived OAuth2 access token from PayPal.
 * Uses Basic auth with PAYPAL_CLIENT_ID:PAYPAL_CLIENT_SECRET.
 * Tokens are cached in memory until 60s before expiry.
 */
let _tokenCache: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 60_000) {
    return _tokenCache.token;
  }

  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("PayPal credentials are not configured");
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal OAuth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const token = data.access_token as string;
  const expiresIn = (data.expires_in as number) || 3600;
  _tokenCache = { token, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}

/**
 * Verify a webhook signature with the PayPal API.
 * Returns true if the webhook is genuine, false otherwise.
 */
export async function verifyWebhookSignature(
  headers: Record<string, string>,
  body: string
): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    throw new Error("PAYPAL_WEBHOOK_ID is not configured");
  }

  const requiredHeaders = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];
  for (const h of requiredHeaders) {
    if (!headers[h]) {
      console.error(`Missing required PayPal header: ${h}`);
      return false;
    }
  }

  const accessToken = await getAccessToken();

  const verificationPayload = {
    auth_algo: headers["paypal-auth-algo"],
    cert_url: headers["paypal-cert-url"],
    transmission_id: headers["paypal-transmission-id"],
    transmission_sig: headers["paypal-transmission-sig"],
    transmission_time: headers["paypal-transmission-time"],
    webhook_id: webhookId,
    webhook_event: JSON.parse(body),
  };

  const res = await fetch(
    `${getPayPalBaseUrl()}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(verificationPayload),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error(`PayPal webhook verification request failed (${res.status}): ${text}`);
    return false;
  }

  const data = await res.json();
  return data.verification_status === "SUCCESS";
}

/**
 * Fetch full subscription details from PayPal.
 */
export async function getSubscriptionDetails(
  subscriptionId: string
): Promise<PayPalSubscription> {
  const accessToken = await getAccessToken();

  const res = await fetch(
    `${getPayPalBaseUrl()}/v1/billing/subscriptions/${subscriptionId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `PayPal get subscription failed (${res.status}): ${text}`
    );
  }

  return res.json() as Promise<PayPalSubscription>;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PayPalSubscription {
  id: string;
  plan_id: string;
  status: string;
  custom_id?: string;
  start_time?: string;
  billing_info?: {
    next_billing_time?: string;
    last_payment?: {
      amount?: {
        currency_code: string;
        value: string;
      };
      time?: string;
    };
    cycle_executions?: Array<{
      tenure_type: string;
      sequence: number;
      cycles_completed: number;
      cycles_remaining: number;
      current_pricing_scheme_version: number;
      total_cycles: number;
    }>;
  };
  subscriber?: {
    email_address?: string;
    name?: {
      given_name?: string;
      surname?: string;
    };
  };
  create_time?: string;
  update_time?: string;
}
