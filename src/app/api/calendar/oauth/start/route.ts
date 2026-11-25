import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { appOrigin, authorizationUrl } from "@/lib/calendar/google";
import { OAUTH_STATE_COOKIE } from "@/lib/calendar/http";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const origin = appOrigin(request);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.redirect(new URL("/auth", origin));

  let url: string;
  const state = randomBytes(24).toString("base64url");
  try {
    url = authorizationUrl(request, state);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Google OAuth is not configured.";
    return NextResponse.redirect(new URL(`/settings/calendar?error=${encodeURIComponent(message)}`, origin));
  }

  const response = NextResponse.redirect(url);
  response.cookies.set(OAUTH_STATE_COOKIE, `${state}.${data.user.id}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/calendar/oauth",
    maxAge: 600,
  });
  return response;
}
