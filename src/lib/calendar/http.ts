import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAccount } from "@/lib/calendar/account";
import { webhookAddress } from "@/lib/calendar/watch";

export { jsonError, requireUser } from "@/lib/mail/session";

export const OAUTH_STATE_COOKIE = "tiistai_calendar_oauth";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = (await request.json().catch(() => null)) as unknown;
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** What the browser may see about the account (never tokens). */
export async function accountView(ownerId: string) {
  const account = await loadAccount(createAdminClient(), ownerId);
  if (!account) return { connected: false as const, live_sync: Boolean(webhookAddress()) };
  return {
    connected: account.status !== "revoked",
    status: account.status,
    email: account.email,
    last_error: account.last_error,
    last_synced_at: account.last_synced_at,
    available_calendars: account.available_calendars,
    read_calendar_ids: account.read_calendar_ids,
    live_sync: Boolean(webhookAddress()),
  };
}
