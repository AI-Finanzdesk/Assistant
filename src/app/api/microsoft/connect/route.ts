import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeUrl, msConfigured } from "@/lib/microsoft/graph";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!msConfigured()) return NextResponse.redirect(new URL("/settings?ms=not-configured", request.url));

  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(authorizeUrl(state));
  response.cookies.set("ms_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return response;
}
