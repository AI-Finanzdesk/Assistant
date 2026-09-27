import { after, NextResponse } from "next/server";
import { advanceMeeting } from "@/lib/services/meetings";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

/** Wordt aangeroepen door AssemblyAI zodra een transcriptie klaar is. */
export async function POST(request: Request) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || request.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json()) as { transcript_id?: string };
  if (!body.transcript_id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const admin = createAdminClient();
  const { data: meeting } = await admin
    .from("meetings")
    .select("id")
    .eq("transcription_id", body.transcript_id)
    .maybeSingle();
  if (!meeting) return NextResponse.json({ ok: true });

  // Direct antwoorden; samenvatten gebeurt daarna op de achtergrond.
  after(() => advanceMeeting(meeting.id));
  return NextResponse.json({ ok: true });
}
