import { NextResponse } from "next/server";
import { advanceMeeting, resummarize } from "@/lib/services/meetings";
import { createClient } from "@/lib/supabase/server";

// Samenvatten kan even duren.
export const maxDuration = 300;

/** Controleer transcriptie en vat samen als die klaar is (?resummarize=1: opnieuw samenvatten). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: canEdit } = await supabase.rpc("can_edit_meeting", { mid: id });
  if (!canEdit) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (new URL(request.url).searchParams.get("resummarize")) {
    await resummarize(id);
    return NextResponse.json({ status: "done" });
  }
  const status = await advanceMeeting(id);
  return NextResponse.json({ status });
}
