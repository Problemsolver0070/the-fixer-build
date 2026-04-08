export const dynamic = "force-dynamic";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getUserByClerkId, getConversations, getUserAccess } from "@/lib/db/queries";
import { computeAccessState } from "@/lib/access/check";
import { AppLayoutClient } from "./app-layout-client";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect("/sign-in");

  const dbUser = await getUserByClerkId(clerkId);

  if (!dbUser) {
    return (
      <AppLayoutClient
        plan="trial"
        trialExpiresAt={null}
        conversations={[]}
        accessData={{
          continuousRemaining: 0,
          pausableRemaining: 0,
          pausableStatus: "none",
          trialActive: false,
          trialRemaining: 0,
        }}
      >
        {children}
      </AppLayoutClient>
    );
  }

  const [conversations, access] = await Promise.all([
    getConversations(dbUser.id),
    getUserAccess(dbUser.id),
  ]);

  const state = computeAccessState(
    access ?? null,
    dbUser.trialExpiresAt
  );

  const trialActive =
    dbUser.plan === "trial" &&
    dbUser.trialExpiresAt !== null &&
    new Date(dbUser.trialExpiresAt) > new Date();
  const trialRemaining = trialActive
    ? Math.max(
        0,
        Math.floor(
          (new Date(dbUser.trialExpiresAt!).getTime() - Date.now()) / 1000
        )
      )
    : 0;

  const serializedConversations = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    mode: c.mode,
    updatedAt: c.updatedAt.toISOString(),
  }));

  return (
    <AppLayoutClient
      plan={dbUser.plan}
      trialExpiresAt={dbUser.trialExpiresAt?.toISOString() ?? null}
      conversations={serializedConversations}
      accessData={{
        continuousRemaining: state.continuousRemaining,
        pausableRemaining: state.pausableRemaining,
        pausableStatus: state.pausableStatus,
        trialActive,
        trialRemaining,
      }}
    >
      {children}
    </AppLayoutClient>
  );
}
