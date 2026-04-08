// src/components/billing/access-timer.tsx

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Clock, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

interface AccessTimerProps {
  initialContinuousRemaining: number;
  initialPausableRemaining: number;
  initialPausableStatus: "none" | "active" | "paused";
  initialTrialActive: boolean;
  initialTrialRemaining: number;
}

function formatTime(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0m";
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function AccessTimer({
  initialContinuousRemaining,
  initialPausableRemaining,
  initialPausableStatus,
  initialTrialActive,
  initialTrialRemaining,
}: AccessTimerProps) {
  const [continuous, setContinuous] = useState(initialContinuousRemaining);
  const [pausable, setPausable] = useState(initialPausableRemaining);
  const [pausableStatus, setPausableStatus] = useState(initialPausableStatus);
  const [trialRemaining, setTrialRemaining] = useState(initialTrialRemaining);
  const [trialActive, setTrialActive] = useState(initialTrialActive);
  const [loading, setLoading] = useState(false);

  // Total active time (excludes paused pausable)
  const activeTime =
    continuous +
    (pausableStatus === "active" ? pausable : 0) +
    (trialActive ? trialRemaining : 0);
  const bankedTime = pausableStatus === "paused" ? pausable : 0;
  const totalTime = activeTime + bankedTime;
  const hasAccess = activeTime > 0;

  // Tick every second for active timers
  useEffect(() => {
    const interval = setInterval(() => {
      setContinuous((prev) => Math.max(0, prev - 1));
      if (pausableStatus === "active") {
        setPausable((prev) => Math.max(0, prev - 1));
      }
      if (trialActive) {
        setTrialRemaining((prev) => {
          const next = Math.max(0, prev - 1);
          if (next === 0) setTrialActive(false);
          return next;
        });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [pausableStatus, trialActive]);

  // Sync with server every 60s
  useEffect(() => {
    const sync = async () => {
      try {
        const res = await fetch("/api/access");
        if (!res.ok) return;
        const data = await res.json();
        setContinuous(data.continuousRemaining ?? 0);
        setPausable(data.pausableRemaining ?? 0);
        setPausableStatus(data.pausableStatus ?? "none");
      } catch {
        // Silently fail — will retry next interval
      }
    };
    const interval = setInterval(sync, 60_000);
    return () => clearInterval(interval);
  }, []);

  const handlePause = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/access/pause", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setPausable(data.remainingSeconds ?? pausable);
        setPausableStatus("paused");
      }
    } finally {
      setLoading(false);
    }
  }, [pausable]);

  const handleResume = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/access/resume", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setPausable(data.remainingSeconds ?? pausable);
        setPausableStatus("active");
      }
    } finally {
      setLoading(false);
    }
  }, [pausable]);

  // Don't render if user has no purchased time and no trial
  if (totalTime <= 0 && !trialActive) {
    return (
      <Link
        href="/pricing"
        className="flex items-center gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
      >
        <Clock className="h-3.5 w-3.5" />
        Access expired
      </Link>
    );
  }

  // Paused state
  if (pausableStatus === "paused" && bankedTime > 0 && !hasAccess) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          Paused — {formatTime(bankedTime)} banked
        </span>
        <button
          onClick={handleResume}
          disabled={loading}
          className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
        >
          <Play className="h-3 w-3" />
          Resume
        </button>
      </div>
    );
  }

  // Warning colors
  const isLow = activeTime > 0 && activeTime < 3600;
  const isCritical = activeTime > 0 && activeTime < 600;

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium",
          isCritical
            ? "animate-pulse text-destructive"
            : isLow
              ? "text-yellow-600 dark:text-yellow-400"
              : "text-muted-foreground"
        )}
      >
        <Clock className="h-3.5 w-3.5" />
        {formatTime(activeTime)} remaining
      </span>
      {pausableStatus === "active" && pausable > 0 && (
        <button
          onClick={handlePause}
          disabled={loading}
          className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 disabled:opacity-50"
          title="Pause timer"
        >
          <Pause className="h-3 w-3" />
          Pause
        </button>
      )}
      {pausableStatus === "paused" && bankedTime > 0 && (
        <span className="text-xs text-muted-foreground">
          +{formatTime(bankedTime)} paused
        </span>
      )}
    </div>
  );
}
