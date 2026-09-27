import { NextResponse } from "next/server";
import { startTranscription } from "@/lib/services/meetings";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/** Start transcriptie van de geüploade opname. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: canEdit } = await supabase.rpc("can_edit_meeting", { mid: id });
  if (!canEdit) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: meeting } = await supabase.from("meetings").select("consent_confirmed, audio_path").eq("id", id).single();
  if (!meeting?.consent_confirmed) return NextResponse.json({ error: "consent" }, { status: 400 });
  if (!meeting.audio_path) return NextResponse.json({ error: "no-audio" }, { status: 400 });

  try {
    await startTranscription(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
