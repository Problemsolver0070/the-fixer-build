import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getUserByClerkId, getUserAccess } from "@/lib/db/queries";
import { computeAccessState } from "@/lib/access/check";
import { PricingClient } from "./pricing-client";

export const metadata = {
  title: "Pricing - The Fixer",
  description: "Get access to The Fixer — unlimited AI powered by Claude Opus 4.6",
};

export default async function PricingPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect("/sign-in");

  const user = await getUserByClerkId(clerkId);
  const access = user ? await getUserAccess(user.id) : null;
  const state = computeAccessState(
    access ?? null,
    user?.trialExpiresAt ?? null
  );

  return (
    <PricingClient
      hasAccess={state.hasAccess}
      totalRemaining={state.totalRemaining}
    />
  );
}
