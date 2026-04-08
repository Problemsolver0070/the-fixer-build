import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "./index";
import {
  users,
  conversations,
  messages,
  projects,
  subscriptions,
  userAccess,
  purchases,
  type User,
  type Conversation,
  type Message,
  type Project,
  type Subscription,
  type UserAccess,
  type Purchase,
} from "./schema";
import type { Attachment } from "@/lib/types/attachment";

// ─── Users ────────────────────────────────────────────────────────────────────

export async function getUserByClerkId(
  clerkId: string
): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId));
  return user;
}

export async function createUser(data: {
  clerkId: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({
      clerkId: data.clerkId,
      email: data.email,
      name: data.name ?? null,
      avatarUrl: data.avatarUrl ?? null,
      trialExpiresAt: sql`NOW() + INTERVAL '48 hours'`,
    })
    .returning();
  return user;
}

export async function updateUserPlan(
  userId: string,
  plan: string
): Promise<User | undefined> {
  const [user] = await db
    .update(users)
    .set({ plan, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  return user;
}

// ─── Conversations ────────────────────────────────────────────────────────────

export async function getConversations(
  userId: string
): Promise<Conversation[]> {
  return db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt));
}

export async function getConversation(
  id: string,
  userId: string
): Promise<Conversation | undefined> {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
  return conversation;
}

export async function createConversation(
  userId: string,
  mode: string,
  title?: string
): Promise<Conversation> {
  const [conversation] = await db
    .insert(conversations)
    .values({
      userId,
      mode,
      ...(title ? { title } : {}),
    })
    .returning();
  return conversation;
}

export async function updateConversationTitle(
  id: string,
  userId: string,
  title: string
): Promise<Conversation | undefined> {
  const [conversation] = await db
    .update(conversations)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning();
  return conversation;
}

export async function deleteConversation(
  id: string,
  userId: string
): Promise<void> {
  await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export async function getMessages(
  conversationId: string,
  userId: string,
  limit?: number
): Promise<Message[]> {
  const conversation = await getConversation(conversationId, userId);
  if (!conversation) return [];

  if (limit) {
    const result = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
    return result.reverse();
  }

  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);
}

export async function createMessage(
  conversationId: string,
  role: string,
  content: string,
  attachments?: Attachment[] | null,
  userId?: string
): Promise<Message> {
  if (userId) {
    const conv = await getConversation(conversationId, userId);
    if (!conv) {
      throw new Error("Conversation not found or access denied");
    }
  }

  const [message] = await db
    .insert(messages)
    .values({
      conversationId,
      role,
      content,
      ...(attachments ? { attachments } : {}),
    })
    .returning();

  // Touch the conversation's updatedAt
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  return message;
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function getProjects(userId: string): Promise<Project[]> {
  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt));
}

export async function getProject(
  id: string,
  userId: string
): Promise<Project | undefined> {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
  return project;
}

export async function getProjectByConversationId(
  conversationId: string,
  userId: string
): Promise<Project | undefined> {
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.conversationId, conversationId),
        eq(projects.userId, userId)
      )
    );
  return project;
}

export async function createProject(
  userId: string,
  name: string,
  conversationId?: string,
  files?: Record<string, unknown>
): Promise<Project> {
  const [project] = await db
    .insert(projects)
    .values({
      userId,
      name,
      conversationId: conversationId ?? null,
      ...(files ? { files } : {}),
    })
    .returning();
  return project;
}

export async function updateProjectFiles(
  id: string,
  userId: string,
  files: Record<string, unknown>
): Promise<Project | undefined> {
  const [project] = await db
    .update(projects)
    .set({ files, updatedAt: new Date() })
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .returning();
  return project;
}

export async function deleteProject(
  id: string,
  userId: string
): Promise<void> {
  await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

export async function getSubscription(
  userId: string
): Promise<Subscription | undefined> {
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));
  return subscription;
}

export async function upsertSubscription(data: {
  userId: string;
  paypalSubscriptionId: string;
  plan?: string;
  status?: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
}): Promise<Subscription> {
  const [subscription] = await db
    .insert(subscriptions)
    .values({
      userId: data.userId,
      paypalSubscriptionId: data.paypalSubscriptionId,
      plan: data.plan ?? "pro",
      status: data.status ?? "active",
      currentPeriodStart: data.currentPeriodStart ?? null,
      currentPeriodEnd: data.currentPeriodEnd ?? null,
    })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: {
        paypalSubscriptionId: data.paypalSubscriptionId,
        plan: data.plan ?? "pro",
        status: data.status ?? "active",
        currentPeriodStart: data.currentPeriodStart ?? null,
        currentPeriodEnd: data.currentPeriodEnd ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return subscription;
}

// ─── User Access ─────────────────────────────────────────────────────────────

export async function getUserAccess(
  userId: string
): Promise<UserAccess | undefined> {
  const [access] = await db
    .select()
    .from(userAccess)
    .where(eq(userAccess.userId, userId));
  return access;
}

export async function upsertUserAccess(
  userId: string,
  data: Partial<{
    continuousExpiresAt: Date | null;
    pausableRemainingSeconds: number;
    pausableStatus: string;
    pausableLastResumedAt: Date | null;
  }>
): Promise<UserAccess> {
  const [access] = await db
    .insert(userAccess)
    .values({
      userId,
      continuousExpiresAt: data.continuousExpiresAt ?? null,
      pausableRemainingSeconds: data.pausableRemainingSeconds ?? 0,
      pausableStatus: data.pausableStatus ?? "none",
      pausableLastResumedAt: data.pausableLastResumedAt ?? null,
    })
    .onConflictDoUpdate({
      target: userAccess.userId,
      set: {
        ...data,
        updatedAt: new Date(),
      },
    })
    .returning();
  return access;
}

export async function updateUserAccess(
  userId: string,
  data: Partial<{
    continuousExpiresAt: Date | null;
    pausableRemainingSeconds: number;
    pausableStatus: string;
    pausableLastResumedAt: Date | null;
  }>
): Promise<UserAccess | undefined> {
  const [access] = await db
    .update(userAccess)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(userAccess.userId, userId))
    .returning();
  return access;
}

// ─── Purchases ───────────────────────────────────────────────────────────────

export async function createPurchase(data: {
  userId: string;
  passType: string;
  amountUsd: string;
  paypalOrderId: string;
}): Promise<Purchase> {
  const [purchase] = await db
    .insert(purchases)
    .values({
      userId: data.userId,
      passType: data.passType,
      amountUsd: data.amountUsd,
      paypalOrderId: data.paypalOrderId,
      status: "pending",
    })
    .returning();
  return purchase;
}

export async function getPurchaseByOrderId(
  paypalOrderId: string
): Promise<Purchase | undefined> {
  const [purchase] = await db
    .select()
    .from(purchases)
    .where(eq(purchases.paypalOrderId, paypalOrderId));
  return purchase;
}

export async function updatePurchaseStatus(
  paypalOrderId: string,
  status: string,
  paypalCaptureId?: string
): Promise<Purchase | undefined> {
  const set: Record<string, unknown> = { status };
  if (paypalCaptureId) set.paypalCaptureId = paypalCaptureId;
  const [purchase] = await db
    .update(purchases)
    .set(set)
    .where(eq(purchases.paypalOrderId, paypalOrderId))
    .returning();
  return purchase;
}

/**
 * Atomically claim a pending purchase for completion.
 * Returns the purchase if successfully claimed (status transitioned from 'pending' to 'completed'),
 * or undefined if another handler already claimed it. This prevents double-granting of time
 * when the capture endpoint and webhook race.
 */
export async function claimPurchaseForCompletion(
  paypalOrderId: string,
  paypalCaptureId?: string
): Promise<Purchase | undefined> {
  const set: Record<string, unknown> = { status: "completed" };
  if (paypalCaptureId) set.paypalCaptureId = paypalCaptureId;
  const [purchase] = await db
    .update(purchases)
    .set(set)
    .where(and(eq(purchases.paypalOrderId, paypalOrderId), eq(purchases.status, "pending")))
    .returning();
  return purchase;
}

export async function getUserPurchases(
  userId: string
): Promise<Purchase[]> {
  return db
    .select()
    .from(purchases)
    .where(eq(purchases.userId, userId))
    .orderBy(desc(purchases.createdAt));
}
