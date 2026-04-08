import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  getUserByClerkId,
  getUserAccess,
  getUserPurchases,
} from "@/lib/db/queries";
import { computeAccessState } from "@/lib/access/check";
import { getProduct } from "@/lib/access/products";
import { BillingPauseResumeButton } from "@/components/billing/billing-pause-resume";
import {
  CreditCard,
  ArrowLeft,
  Clock,
  Zap,
  ShoppingBag,
} from "lucide-react";

export const metadata = {
  title: "Billing - The Fixer",
  description: "View your purchase history and access status",
};

export default async function BillingPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect("/sign-in");

  const dbUser = await getUserByClerkId(clerkId);
  const access = dbUser ? await getUserAccess(dbUser.id) : null;
  const state = computeAccessState(
    access ?? null,
    dbUser?.trialExpiresAt ?? null
  );
  const purchases = dbUser ? await getUserPurchases(dbUser.id) : [];

  const hours = Math.floor(state.totalRemaining / 3600);
  const minutes = Math.floor((state.totalRemaining % 3600) / 60);
  const timeLabel = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  return (
    <div className="flex flex-1 justify-center overflow-y-auto p-6">
      <div className="w-full max-w-2xl space-y-6">
        <div>
          <Link
            href="/settings"
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to settings
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Billing
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your access status and purchase history
          </p>
        </div>

        {/* Current Access Card */}
        <div className="rounded-xl border border-border bg-card p-6 ring-1 ring-foreground/5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">
                Current Access
              </h2>
            </div>
            {state.hasAccess ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <Zap className="h-3 w-3" />
                Active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                <Clock className="h-3 w-3" />
                Expired
              </span>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total time remaining</span>
              <span className="font-medium text-foreground">
                {state.totalRemaining > 0 ? timeLabel : "None"}
              </span>
            </div>
            {state.continuousRemaining > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Continuous time</span>
                <span className="font-medium text-foreground">
                  {Math.floor(state.continuousRemaining / 3600)}h{" "}
                  {Math.floor((state.continuousRemaining % 3600) / 60)}m
                </span>
              </div>
            )}
            {state.pausableRemaining > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Pausable time ({state.pausableStatus})
                </span>
                <span className="font-medium text-foreground">
                  {Math.floor(state.pausableRemaining / 3600)}h{" "}
                  {Math.floor((state.pausableRemaining % 3600) / 60)}m
                </span>
              </div>
            )}
            {state.pausableRemaining > 0 && (
              <BillingPauseResumeButton pausableStatus={state.pausableStatus} />
            )}
          </div>

          {!state.hasAccess && (
            <div className="mt-4 border-t border-border pt-4">
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Zap className="h-4 w-4" />
                Get Access
              </Link>
            </div>
          )}
        </div>

        {/* Purchase History */}
        <div className="rounded-xl border border-border bg-card p-6 ring-1 ring-foreground/5">
          <div className="mb-4 flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">
              Purchase History
            </h2>
          </div>

          {purchases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No purchases yet.</p>
          ) : (
            <div className="space-y-3">
              {purchases.map((p) => {
                const product = getProduct(p.passType);
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {product?.name ?? p.passType} Pass
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(p.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-foreground">
                        ${p.amountUsd}
                      </p>
                      <p
                        className={`text-xs capitalize ${
                          p.status === "completed"
                            ? "text-green-600 dark:text-green-400"
                            : p.status === "failed"
                              ? "text-red-500"
                              : "text-yellow-600"
                        }`}
                      >
                        {p.status}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
