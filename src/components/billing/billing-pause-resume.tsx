"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";

interface BillingPauseResumeButtonProps {
  pausableStatus: "none" | "active" | "paused";
}

export function BillingPauseResumeButton({
  pausableStatus,
}: BillingPauseResumeButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handlePause = useCallback(async () => {
    setLoading(true);
    try {
      await fetch("/api/access/pause", { method: "POST" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }, [router]);

  const handleResume = useCallback(async () => {
    setLoading(true);
    try {
      await fetch("/api/access/resume", { method: "POST" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }, [router]);

  if (pausableStatus === "active") {
    return (
      <button
        onClick={handlePause}
        disabled={loading}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
      >
        <Pause className="h-3.5 w-3.5" />
        {loading ? "Pausing..." : "Pause Timer"}
      </button>
    );
  }

  if (pausableStatus === "paused") {
    return (
      <button
        onClick={handleResume}
        disabled={loading}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
      >
        <Play className="h-3.5 w-3.5" />
        {loading ? "Resuming..." : "Resume Timer"}
      </button>
    );
  }

  return null;
}
