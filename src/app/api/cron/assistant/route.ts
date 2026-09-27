import { NextResponse } from "next/server";
import { runAssistantForAll } from "@/lib/services/assistant";
import { isCronAuthorized } from "../cron-auth";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ suggestions: await runAssistantForAll() });
}
