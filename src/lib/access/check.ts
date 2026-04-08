// src/lib/access/check.ts

import type { UserAccess } from "@/lib/db/schema";

export interface AccessState {
  hasAccess: boolean;
  continuousRemaining: number; // seconds
  pausableRemaining: number; // seconds
  pausableStatus: "none" | "active" | "paused";
  totalRemaining: number; // seconds
}

/**
 * Compute access state from a user_access row.
 * Pure function — no DB calls.
 */
export function computeAccessState(
  access: UserAccess | undefined | null,
  trialExpiresAt: Date | null
): AccessState {
  const now = new Date();

  // Trial check
  const trialActive =
    trialExpiresAt !== null && new Date(trialExpiresAt) > now;

  if (!access) {
    return {
      hasAccess: trialActive,
      continuousRemaining: 0,
      pausableRemaining: 0,
      pausableStatus: "none",
      totalRemaining: 0,
    };
  }

  // Continuous pool
  const continuousRemaining =
    access.continuousExpiresAt &&
    new Date(access.continuousExpiresAt) > now
      ? Math.floor(
          (new Date(access.continuousExpiresAt).getTime() - now.getTime()) /
            1000
        )
      : 0;

  // Pausable pool
  let pausableRemaining = 0;
  const pausableStatus = access.pausableStatus as
    | "none"
    | "active"
    | "paused";

  if (pausableStatus === "paused") {
    pausableRemaining = Math.max(0, access.pausableRemainingSeconds);
  } else if (
    pausableStatus === "active" &&
    access.pausableLastResumedAt
  ) {
    const elapsed =
      (now.getTime() -
        new Date(access.pausableLastResumedAt).getTime()) /
      1000;
    pausableRemaining = Math.max(
      0,
      Math.floor(access.pausableRemainingSeconds - elapsed)
    );
  }

  const totalRemaining = continuousRemaining + pausableRemaining;

  // Access: trial OR continuous time OR active pausable with time
  const hasAccess =
    trialActive ||
    continuousRemaining > 0 ||
    (pausableStatus === "active" && pausableRemaining > 0);

  return {
    hasAccess,
    continuousRemaining,
    pausableRemaining,
    pausableStatus,
    totalRemaining,
  };
}
