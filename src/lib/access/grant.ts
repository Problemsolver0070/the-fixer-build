import { getUserAccess, upsertUserAccess, updateUserPlan } from "@/lib/db/queries";
import type { Product } from "./products";

/**
 * Grant time from a purchased pass to the appropriate pool.
 * Handles both pausable and continuous pools, with proper snapshotting
 * of live pausable time before adding.
 *
 * Called from both the capture endpoint and the webhook handler.
 */
export async function grantTimeForPurchase(
  userId: string,
  product: Product
): Promise<void> {
  const now = new Date();
  const currentAccess = await getUserAccess(userId);

  if (product.isPausable) {
    const currentSeconds = currentAccess?.pausableRemainingSeconds ?? 0;
    const currentStatus = currentAccess?.pausableStatus ?? "none";

    // Snapshot live remaining time if timer is actively running
    let snapshotSeconds = currentSeconds;
    if (
      currentStatus === "active" &&
      currentAccess?.pausableLastResumedAt
    ) {
      const elapsed =
        (now.getTime() -
          new Date(currentAccess.pausableLastResumedAt).getTime()) /
        1000;
      snapshotSeconds = Math.max(0, Math.floor(currentSeconds - elapsed));
    }

    await upsertUserAccess(userId, {
      pausableRemainingSeconds: snapshotSeconds + product.durationSeconds,
      pausableStatus: "active",
      pausableLastResumedAt: now,
    });
  } else {
    const currentExpiry = currentAccess?.continuousExpiresAt
      ? new Date(currentAccess.continuousExpiresAt)
      : null;

    const baseTime =
      currentExpiry && currentExpiry > now ? currentExpiry : now;
    const newExpiry = new Date(
      baseTime.getTime() + product.durationSeconds * 1000
    );

    await upsertUserAccess(userId, {
      continuousExpiresAt: newExpiry,
    });
  }

  await updateUserPlan(userId, "active");
}

/**
 * Revoke time from a refunded/denied purchase.
 * Snapshots live pausable time before subtracting.
 */
export async function revokeTimeForPurchase(
  userId: string,
  product: Product
): Promise<void> {
  const now = new Date();
  const currentAccess = await getUserAccess(userId);
  if (!currentAccess) return;

  if (product.isPausable) {
    // Snapshot live remaining time if timer is actively running
    let liveRemaining = currentAccess.pausableRemainingSeconds;
    if (
      currentAccess.pausableStatus === "active" &&
      currentAccess.pausableLastResumedAt
    ) {
      const elapsed =
        (now.getTime() -
          new Date(currentAccess.pausableLastResumedAt).getTime()) /
        1000;
      liveRemaining = Math.max(0, Math.floor(liveRemaining - elapsed));
    }

    const newSeconds = Math.max(0, liveRemaining - product.durationSeconds);
    await upsertUserAccess(userId, {
      pausableRemainingSeconds: newSeconds,
      pausableStatus: newSeconds <= 0 ? "none" : currentAccess.pausableStatus as string,
      pausableLastResumedAt: newSeconds <= 0 ? null : (currentAccess.pausableStatus === "active" ? now : null),
    });
  } else if (currentAccess.continuousExpiresAt) {
    const newExpiry = new Date(
      new Date(currentAccess.continuousExpiresAt).getTime() -
        product.durationSeconds * 1000
    );
    await upsertUserAccess(userId, {
      continuousExpiresAt: newExpiry > now ? newExpiry : null,
    });
  }
}
