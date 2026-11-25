import "server-only";

// Thin wrapper around the Google OAuth and Calendar v3 REST APIs (plain fetch).

export const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.app.created",
];

/** Dynamic lookup so Next/Amplify cannot inline empty values at build time. */
export function env(name: string) {
  return process.env[name]?.trim() || "";
}

export function googleClient() {
  const clientId = env("GOOGLE_CLIENT_ID");
  const clientSecret = env("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.");
  return { clientId, clientSecret };
}

/** Public origin of the request, honouring the Amplify/CloudFront forwarding headers. */
export function requestOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (host) return `${proto || url.protocol.replace(":", "")}://${host}`;
  return url.origin;
}

export function redirectUri(request: Request) {
  return env("GOOGLE_OAUTH_REDIRECT_URL") || `${requestOrigin(request)}/api/calendar/oauth/callback`;
}

/** Origin the browser should land on after OAuth (same host as the redirect URI). */
export function appOrigin(request: Request) {
  const configured = env("GOOGLE_OAUTH_REDIRECT_URL");
  return configured ? new URL(configured).origin : requestOrigin(request);
}

export function authorizationUrl(request: Request, state: string) {
  const { clientId } = googleClient();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(request),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

/** A Google failure. `transient` means retrying later may succeed (network, 429, 5xx). */
export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly transient: boolean,
    readonly reason?: string,
  ) {
    super(message);
  }
}

/** The refresh token is no longer valid (user revoked access, Testing-mode expiry, ...). */
export class RevokedError extends Error {}

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse & { access_token: string }> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      cache: "no-store",
    });
  } catch (caught) {
    throw new GoogleError(`Google token request failed: ${String(caught)}`, 0, true);
  }
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !data.access_token) {
    if (data.error === "invalid_grant") {
      throw new RevokedError(data.error_description || "Google revoked the refresh token (invalid_grant).");
    }
    throw new GoogleError(
      `Google token request failed: ${data.error_description || data.error || response.status}`,
      response.status,
      response.status >= 500 || response.status === 429,
      data.error,
    );
  }
  return data as TokenResponse & { access_token: string };
}

export async function exchangeCode(request: Request, code: string) {
  const { clientId, clientSecret } = googleClient();
  return tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(request),
    grant_type: "authorization_code",
  });
}

export async function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = googleClient();
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
}

export async function revokeToken(token: string) {
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      cache: "no-store",
    });
  } catch {
    // Best effort: the secret is deleted locally either way.
  }
}

/** Email from the id_token returned by the token endpoint (direct TLS exchange, so no signature check needed). */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as {
      email?: string;
      aud?: string;
    };
    if (payload.aud && payload.aud !== env("GOOGLE_CLIENT_ID")) return null;
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

export async function fetchUserEmail(accessToken: string): Promise<string | null> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return null;
  const data = (await response.json().catch(() => ({}))) as { email?: string };
  return data.email ?? null;
}

type Query = Record<string, string | number | boolean | undefined>;
export type CalendarMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type CalendarFetchOptions = { query?: Query; body?: unknown; allowMissing?: boolean };

/**
 * Calls the Calendar API. Returns `null` for 404/410 when `allowMissing` is set,
 * otherwise throws GoogleError on any non-2xx.
 */
export async function calendarFetch<T>(
  accessToken: string,
  method: CalendarMethod,
  path: string,
  options: CalendarFetchOptions = {},
): Promise<T | null> {
  const url = new URL(path.startsWith("http") ? path : `${CALENDAR_API}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });
  } catch (caught) {
    throw new GoogleError(`Google Calendar request failed: ${String(caught)}`, 0, true);
  }

  if (response.status === 204) return {} as T;
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : {};
  if (response.ok) return data as T;
  if (options.allowMissing && (response.status === 404 || response.status === 410)) return null;

  const error = (data as { error?: { message?: string; errors?: { reason?: string }[] } }).error;
  const reason = error?.errors?.[0]?.reason;
  const transient =
    response.status === 429 ||
    response.status >= 500 ||
    (response.status === 403 && (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded"));
  throw new GoogleError(
    `Google Calendar ${method} ${url.pathname}: ${error?.message || response.status}`,
    response.status,
    transient,
    reason,
  );
}

export type Caller = <T>(method: CalendarMethod, path: string, options?: CalendarFetchOptions) => Promise<T | null>;

export function tokenCaller(accessToken: string): Caller {
  return (method, path, options) => calendarFetch(accessToken, method, path, options);
}

/** Calendar path segment. Calendar ids contain '@' and '#', so always encode. */
export function cal(calendarId: string) {
  return `/calendars/${encodeURIComponent(calendarId)}`;
}

// ---------------------------------------------------------------------------
// Calendar resources
// ---------------------------------------------------------------------------

export type GoogleEventTime = { date?: string; dateTime?: string; timeZone?: string };

export type GoogleEvent = {
  id: string;
  etag?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  extendedProperties?: { private?: Record<string, string> };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

export type GoogleEventList = {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

export type GoogleCalendarListEntry = {
  id: string;
  summary?: string;
  summaryOverride?: string;
  description?: string;
  primary?: boolean;
  backgroundColor?: string;
  accessRole?: string;
  deleted?: boolean;
};

export async function listAllEvents(call: Caller, calendarId: string, query: Query) {
  const items: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  for (let page = 0; page < 40; page += 1) {
    const data = await call<GoogleEventList>("GET", `${cal(calendarId)}/events`, {
      query: { ...query, pageToken },
    });
    items.push(...(data?.items ?? []));
    pageToken = data?.nextPageToken;
    nextSyncToken = data?.nextSyncToken ?? nextSyncToken;
    if (!pageToken) break;
  }
  return { items, nextSyncToken };
}

export async function listCalendars(call: Caller) {
  const items: GoogleCalendarListEntry[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const data = await call<{ items?: GoogleCalendarListEntry[]; nextPageToken?: string }>(
      "GET",
      "/users/me/calendarList",
      { query: { maxResults: 250, pageToken } },
    );
    items.push(...(data?.items ?? []));
    pageToken = data?.nextPageToken;
    if (!pageToken) break;
  }
  return items.filter((entry) => !entry.deleted);
}
