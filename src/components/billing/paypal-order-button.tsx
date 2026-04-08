// src/components/billing/paypal-order-button.tsx

"use client";

import { useState } from "react";
import { PayPalButtons } from "@paypal/react-paypal-js";
import type { PassType } from "@/lib/access/products";

interface PayPalOrderButtonProps {
  passType: PassType;
  onSuccess: () => void;
}

export function PayPalOrderButton({
  passType,
  onSuccess,
}: PayPalOrderButtonProps) {
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="w-full">
      {error && (
        <div className="mb-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <PayPalButtons
        style={{
          shape: "rect",
          color: "gold",
          layout: "vertical",
          label: "pay",
          height: 40,
        }}
        createOrder={async () => {
          setError(null);
          const res = await fetch("/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ passType }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Failed to create order");
          }
          const data = await res.json();
          return data.orderId;
        }}
        onApprove={async (data) => {
          setError(null);
          const res = await fetch("/api/orders/capture", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: data.orderID }),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            setError(errData.error || "Payment capture failed");
            return;
          }
          onSuccess();
        }}
        onError={(err) => {
          console.error("PayPal error:", err);
          setError("Something went wrong with PayPal. Please try again.");
        }}
        onCancel={() => {
          setError(null);
        }}
      />
    </div>
  );
}
