"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Vraagt periodiek de verwerkingsstatus op (ook als de webhook niet aankomt). */
export function StatusPoller({ meetingId, active }: { meetingId: string; active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const res = await fetch(`/api/meetings/${meetingId}/advance`, { method: "POST" });
        const { status } = (await res.json()) as { status?: string };
        if (status && status !== "transcribing") router.refresh();
      } finally {
        busy = false;
      }
    }, 20_000);
    return () => clearInterval(timer);
  }, [meetingId, active, router]);
  return null;
}
