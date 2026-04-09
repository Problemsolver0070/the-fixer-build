export const dynamic = "force-dynamic";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getUserByClerkId, getConversations, getUserAccess } from "@/lib/db/queries";
import { computeAccessState } from "@/lib/access/check";
import { AppLayoutClient } from "./app-layout-client";

const DEFAULT_ACCESS_DATA: {
  continuousRemaining: number;
  pausableRemaining: number;
  pausableStatus: "none" | "active" | "paused";
  trialActive: boolean;
  trialRemaining: number;
} = {
  continuousRemaining: 0,
  pausableRemaining: 0,
  pausableStatus: "none",
  trialActive: false,
  trialRemaining: 0,
};

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
        accessData={DEFAULT_ACCESS_DATA}
      >
        {children}
      </AppLayoutClient>
    );
  }

  let conversations: Awaited<ReturnType<typeof getConversations>> = [];
  let accessData = DEFAULT_ACCESS_DATA;

  try {
    const [convos, access] = await Promise.all([
      getConversations(dbUser.id),
      getUserAccess(dbUser.id).catch(() => undefined),
    ]);

    conversations = convos;

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

    accessData = {
      continuousRemaining: state.continuousRemaining,
      pausableRemaining: state.pausableRemaining,
      pausableStatus: state.pausableStatus,
      trialActive,
      trialRemaining,
    };
  } catch (err) {
    console.error("Failed to load access data in layout:", err);
  }

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
      accessData={accessData}
    >
      {children}
    </AppLayoutClient>
  );
}
