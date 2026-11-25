import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { completeConnection } from "@/lib/calendar/connect";
import { appOrigin, emailFromIdToken, exchangeCode, fetchUserEmail } from "@/lib/calendar/google";
import { OAUTH_STATE_COOKIE } from "@/lib/calendar/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function sameString(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: NextRequest) {
  const origin = appOrigin(request);
  const finish = (params: Record<string, string>) => {
    const response = NextResponse.redirect(new URL(`/settings/calendar?${new URLSearchParams(params)}`, origin));
    response.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/api/calendar/oauth", maxAge: 0 });
    return response;
  };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/auth", origin));

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return finish({ error: `Google: ${params.get("error")}` });

  const cookie = request.cookies.get(OAUTH_STATE_COOKIE)?.value ?? "";
  const [expectedState, expectedUser] = cookie.split(".");
  const state = params.get("state") ?? "";
  const code = params.get("code");
  if (!expectedState || !sameString(state, expectedState) || expectedUser !== auth.user.id || !code) {
    return finish({ error: "Kirjautumisen tarkistus epäonnistui. Yritä uudelleen." });
  }

  try {
    const tokens = await exchangeCode(request, code);
    const email = emailFromIdToken(tokens.id_token) ?? (await fetchUserEmail(tokens.access_token));
    if (!email) throw new Error("Google-tilin sähköpostiosoitetta ei saatu.");
    const granted = new Set((tokens.scope ?? "").split(" "));
    const missing = [
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events.readonly",
      "https://www.googleapis.com/auth/calendar.app.created",
    ].filter((scope) => tokens.scope && !granted.has(scope));
    if (missing.length) throw new Error("Anna kaikki pyydetyt kalenterioikeudet ja yritä uudelleen.");

    await completeConnection(createAdminClient(), auth.user.id, {
      accessToken: tokens.access_token,
      expiresIn: tokens.expires_in,
      refreshToken: tokens.refresh_token,
      email,
    });
    return finish({ connected: "1" });
  } catch (caught) {
    return finish({ error: caught instanceof Error ? caught.message : "Yhdistäminen epäonnistui." });
  }
}
