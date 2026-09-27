"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Knop die een API-route aanroept en daarna de pagina ververst. */
export function ActionButton({
  url,
  children,
  className,
  pendingText = "…",
}: {
  url: string;
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch(url, { method: "POST" });
            if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? res.statusText);
            router.refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? pendingText : children}
      </button>
      {error && <span className="error small">{error}</span>}
    </>
  );
}
