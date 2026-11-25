import "server-only";
import { decryptSecret } from "@/lib/mail/crypto";
import type { AdminClient } from "@/lib/supabase/admin";
import {
  GoogleError,
  RevokedError,
  calendarFetch,
  listCalendars,
  refreshAccessToken,
  type CalendarFetchOptions,
  type CalendarMethod,
  type Caller,
  type GoogleCalendarListEntry,
} from "@/lib/calendar/google";

export const TIISTAI_CALENDAR_SUMMARY = "Tiistai";
/** Marks the dedicated calendar so a reconnect can reuse it instead of creating a duplicate. */
export const TIISTAI_CALENDAR_DESCRIPTION = "Tiistai-sovelluksen aikablokit (tiistai-app).";

export type AvailableCalendar = {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor: string | null;
};

export type WatchChannel = {
  id: string;
  resourceId: string;
  token: string;
  expiration: number; // ms since epoch
};

export type CalendarAccountRow = {
  id: string;
  owner_id: string;
  email: string;
  status: "ok" | "error" | "revoked";
  last_error: string | null;
  last_synced_at: string | null;
  write_calendar_id: string | null;
  read_calendar_ids: string[];
  available_calendars: AvailableCalendar[];
};

export type CalendarSecretRow = {
  account_id: string;
  owner_id: string;
  refresh_token: string;
  sync_tokens: Record<string, string>;
  watch_channels: Record<string, WatchChannel>; // keyed by calendar id
};

export type Connection = { account: CalendarAccountRow; secret: CalendarSecretRow };

const ACCOUNT_COLUMNS =
  "id, owner_id, email, status, last_error, last_synced_at, write_calendar_id, read_calendar_ids, available_calendars";

export async function loadAccount(admin: AdminClient, ownerId: string): Promise<CalendarAccountRow | null> {
  const { data, error } = await admin
    .from("calendar_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as CalendarAccountRow;
  return {
    ...row,
    read_calendar_ids: Array.isArray(row.read_calendar_ids) ? row.read_calendar_ids : [],
    available_calendars: Array.isArray(row.available_calendars) ? row.available_calendars : [],
  };
}

export async function loadConnection(admin: AdminClient, ownerId: string): Promise<Connection | null> {
  const account = await loadAccount(admin, ownerId);
  if (!account) return null;
  const { data, error } = await admin
    .from("calendar_account_secrets")
    .select("account_id, owner_id, refresh_token, sync_tokens, watch_channels")
    .eq("owner_id", ownerId)
    .eq("account_id", account.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const secret = data as CalendarSecretRow;
  return {
    account,
    secret: {
      ...secret,
      sync_tokens: secret.sync_tokens ?? {},
      watch_channels: secret.watch_channels ?? {},
    },
  };
}

/** Connected = account + secret exist and the refresh token has not been revoked. */
export type UsableConnection = Connection & { account: CalendarAccountRow & { write_calendar_id: string } };

export function isUsable(connection: Connection | null): connection is UsableConnection {
  return Boolean(connection && connection.account.status !== "revoked" && connection.account.write_calendar_id);
}

// Access tokens live ~1h; cache per account for the lifetime of the server instance.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function forgetAccessToken(accountId: string) {
  tokenCache.delete(accountId);
}

export function cacheAccessToken(accountId: string, token: string, expiresIn = 3600) {
  tokenCache.set(accountId, { token, expiresAt: Date.now() + (expiresIn - 120) * 1000 });
}

/** Fresh access token for the account. Marks the account 'revoked' on invalid_grant. */
export async function getAccessToken(admin: AdminClient, connection: Connection): Promise<string> {
  const cached = tokenCache.get(connection.account.id);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  try {
    const data = await refreshAccessToken(decryptSecret(connection.secret.refresh_token));
    cacheAccessToken(connection.account.id, data.access_token, data.expires_in);
    return data.access_token;
  } catch (caught) {
    if (caught instanceof RevokedError) {
      await setAccountStatus(admin, connection.account, "revoked", caught.message);
      connection.account.status = "revoked";
    }
    throw caught;
  }
}

export async function setAccountStatus(
  admin: AdminClient,
  account: Pick<CalendarAccountRow, "id" | "owner_id">,
  status: CalendarAccountRow["status"],
  lastError: string | null,
  extra: Record<string, unknown> = {},
) {
  await admin
    .from("calendar_accounts")
    .update({ status, last_error: lastError, updated_at: new Date().toISOString(), ...extra })
    .eq("id", account.id)
    .eq("owner_id", account.owner_id);
}

export async function saveSecretFields(
  admin: AdminClient,
  secret: Pick<CalendarSecretRow, "account_id" | "owner_id">,
  fields: Partial<Pick<CalendarSecretRow, "sync_tokens" | "watch_channels">>,
) {
  const { error } = await admin
    .from("calendar_account_secrets")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("account_id", secret.account_id)
    .eq("owner_id", secret.owner_id);
  if (error) throw new Error(error.message);
}

export function toAvailable(entries: GoogleCalendarListEntry[], writeCalendarId: string | null): AvailableCalendar[] {
  return entries
    .filter((entry) => entry.id !== writeCalendarId)
    .map((entry) => ({
      id: entry.id,
      summary: entry.summaryOverride || entry.summary || entry.id,
      primary: Boolean(entry.primary),
      backgroundColor: entry.backgroundColor ?? null,
    }))
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.summary.localeCompare(b.summary, "fi"));
}

/** Re-reads calendarList and stores it; drops read ids that no longer exist. */
export async function refreshCalendarList(admin: AdminClient, connection: Connection, call: Caller) {
  const entries = await listCalendars(call);
  const available = toAvailable(entries, connection.account.write_calendar_id);
  const ids = new Set(available.map((c) => c.id));
  const readIds = connection.account.read_calendar_ids.filter((id) => ids.has(id));
  const { error } = await admin
    .from("calendar_accounts")
    .update({ available_calendars: available, read_calendar_ids: readIds, updated_at: new Date().toISOString() })
    .eq("id", connection.account.id)
    .eq("owner_id", connection.account.owner_id);
  if (error) throw new Error(error.message);
  connection.account.available_calendars = available;
  connection.account.read_calendar_ids = readIds;
  return available;
}

export function errorMessage(caught: unknown) {
  if (caught instanceof GoogleError || caught instanceof RevokedError || caught instanceof Error) return caught.message;
  return String(caught);
}

/** Calendars whose events we fetch: chosen read calendars + the dedicated Tiistai calendar. */
export function syncedCalendarIds(account: CalendarAccountRow): string[] {
  return [...new Set([...account.read_calendar_ids, ...(account.write_calendar_id ? [account.write_calendar_id] : [])])];
}

/** Calendar API caller bound to a connection; retries once with a new token on 401. */
export function calendarCaller(admin: AdminClient, connection: Connection) {
  const call: Caller = async <T,>(method: CalendarMethod, path: string, options?: CalendarFetchOptions) => {
    const token = await getAccessToken(admin, connection);
    try {
      return await calendarFetch<T>(token, method, path, options);
    } catch (caught) {
      if (!(caught instanceof GoogleError) || caught.status !== 401) throw caught;
      forgetAccessToken(connection.account.id);
      return calendarFetch<T>(await getAccessToken(admin, connection), method, path, options);
    }
  };
  return call;
}
