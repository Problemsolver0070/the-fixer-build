"use client";

import { useRouter } from "next/navigation";
import { Check, Sparkles, Zap } from "lucide-react";
import { PayPalScriptProvider } from "@paypal/react-paypal-js";
import { PayPalOrderButton } from "@/components/billing/paypal-order-button";
import {
  PRODUCT_DISPLAY_ORDER,
  PRODUCTS,
  type PassType,
} from "@/lib/access/products";
import { cn } from "@/lib/utils";

interface PricingClientProps {
  hasAccess: boolean;
  totalRemaining: number;
}

export function PricingClient({
  hasAccess,
  totalRemaining,
}: PricingClientProps) {
  const router = useRouter();
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "";

  function handleSuccess() {
    router.push("/chat");
    router.refresh();
  }

  const hours = Math.floor(totalRemaining / 3600);
  const minutes = Math.floor((totalRemaining % 3600) / 60);
  const timeLabel =
    hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        {/* Header */}
        <div className="mb-10 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Zap className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Get Access
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            Unlimited AI powered by Claude Opus 4.6. Buy the time you need.
          </p>
        </div>

        {/* Active time banner */}
        {hasAccess && totalRemaining > 0 && (
          <div className="mb-8 flex items-center justify-center gap-2 rounded-lg bg-primary/10 p-3 text-sm text-primary">
            <Sparkles className="h-4 w-4" />
            <span>
              You have <strong>{timeLabel}</strong> remaining. Purchases
              stack — buy more to extend.
            </span>
          </div>
        )}

        {/* Product Grid */}
        {!clientId ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-center text-sm text-destructive">
            PayPal is not configured. Please set NEXT_PUBLIC_PAYPAL_CLIENT_ID.
          </div>
        ) : (
          <PayPalScriptProvider
            options={{ clientId, intent: "capture", currency: "USD" }}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PRODUCT_DISPLAY_ORDER.map((passType) => {
                const product = PRODUCTS[passType];
                const isHighlighted = passType === "48h_pausable";

                return (
                  <div
                    key={passType}
                    className={cn(
                      "relative flex flex-col rounded-xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md",
                      isHighlighted
                        ? "border-primary ring-2 ring-primary/20"
                        : "border-border ring-1 ring-foreground/5"
                    )}
                  >
                    {isHighlighted && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground">
                        Best Value
                      </div>
                    )}

                    <div className="mb-4">
                      <h3 className="text-lg font-semibold text-foreground">
                        {product.name}
                      </h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {product.durationLabel}
                        {product.isPausable && " — pausable"}
                      </p>
                    </div>

                    <div className="mb-4">
                      <span className="text-3xl font-bold tracking-tight text-foreground">
                        {product.priceDisplay}
                      </span>
                    </div>

                    <ul className="mb-6 flex-1 space-y-2">
                      {product.features.map((feature) => (
                        <li
                          key={feature}
                          className="flex items-start gap-2 text-sm text-foreground"
                        >
                          <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10">
                            <Check className="h-2.5 w-2.5 text-primary" />
                          </div>
                          {feature}
                        </li>
                      ))}
                      <li className="flex items-start gap-2 text-sm text-foreground">
                        <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10">
                          <Check className="h-2.5 w-2.5 text-primary" />
                        </div>
                        Unlimited AI usage
                      </li>
                    </ul>

                    <PayPalOrderButton
                      passType={passType}
                      onSuccess={handleSuccess}
                    />
                  </div>
                );
              })}
            </div>
          </PayPalScriptProvider>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          One-time payments. No recurring charges. Buy more time whenever
          you need it.
        </p>
      </div>
    </div>
  );
}
