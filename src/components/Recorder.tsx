"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { setAudioPath } from "@/app/actions";
import { createClient } from "@/lib/supabase/browser";

interface Labels {
  record: string;
  stop: string;
  upload: string;
  uploading: string;
  consentNeeded: string;
}

/** Opnemen in de browser (ook op de telefoon) of een bestaand audiobestand uploaden. */
export function Recorder({ meetingId, consent, labels }: { meetingId: string; consent: boolean; labels: Labels }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "recording" | "uploading">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (state !== "recording") return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [state]);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const type = rec.mimeType || "audio/webm";
        void upload(new Blob(chunks.current, { type }), type.includes("mp4") ? "m4a" : "webm");
      };
      rec.start(10_000);
      recorder.current = rec;
      setSeconds(0);
      setState("recording");
      // Scherm aan houden tijdens de opname (telefoon).
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
      wakeLock.current = (await nav.wakeLock?.request("screen").catch(() => null)) ?? null;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function stop() {
    recorder.current?.stop();
    void wakeLock.current?.release().catch(() => undefined);
  }

  async function upload(blob: Blob, ext: string) {
    setState("uploading");
    setError(null);
    try {
      const path = `${meetingId}/${Date.now()}.${ext}`;
      const { error: upErr } = await createClient()
        .storage.from("recordings")
        .upload(path, blob, { contentType: blob.type || "audio/webm" });
      if (upErr) throw upErr;
      await setAudioPath(meetingId, path);
      const res = await fetch(`/api/meetings/${meetingId}/process`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setState("idle");
    }
  }

  if (!consent) return <p className="muted">{labels.consentNeeded}</p>;

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="stack">
      <div className="row">
        {state === "recording" ? (
          <>
            <span className="recording-dot" /> <strong>{mm}:{ss}</strong>
            <button className="danger" onClick={stop}>■ {labels.stop}</button>
          </>
        ) : (
          <button onClick={start} disabled={state === "uploading"}>● {labels.record}</button>
        )}
        {state === "uploading" && <span className="muted">{labels.uploading}</span>}
      </div>
      {state === "idle" && (
        <div>
          <label>{labels.upload}</label>
          <input
            type="file"
            accept="audio/*,video/mp4"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file, file.name.split(".").pop() ?? "audio");
            }}
          />
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
