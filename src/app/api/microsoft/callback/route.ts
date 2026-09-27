import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/microsoft/graph";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expected = request.cookies.get("ms_oauth_state")?.value;
  if (!code || !state || state !== expected) {
    return NextResponse.redirect(new URL("/settings?ms=error", request.url));
  }

  try {
    await exchangeCode(user.id, code);
  } catch (e) {
    console.error(e);
    return NextResponse.redirect(new URL("/settings?ms=error", request.url));
  }
  const response = NextResponse.redirect(new URL("/settings?ms=connected", request.url));
  response.cookies.delete("ms_oauth_state");
  return response;
}
