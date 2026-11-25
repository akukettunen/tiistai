import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AdminClient } from "@/lib/supabase/admin";
import { addDays, todayIso, weekRangeUtc, weekStart } from "@/lib/planning";
import {
  calendarCaller,
  errorMessage,
  isUsable,
  loadConnection,
  saveSecretFields,
  syncedCalendarIds,
  type Connection,
  type WatchChannel,
} from "@/lib/calendar/account";
import { applyEventToBlock, BLOCK_PROPERTY, refreshWeek } from "@/lib/calendar/blocks";
import { GoogleError, RevokedError, cal, env, listAllEvents, type Caller, type GoogleEvent } from "@/lib/calendar/google";

// Live sync: Google push notifications (events.watch) + incremental sync tokens.
// A notification only says "something changed in calendar X"; we then list changes with
// the stored sync token. Block events are applied directly; any other change re-reads
// the current and next week through refreshWeek.

const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;
const CHANNEL_TTL_SECONDS = 7 * 24 * 60 * 60;
const CHANNEL_PREFIX = "tiistai_";

export function webhookAddress(): string | null {
  const base = env("CALENDAR_WEBHOOK_URL").replace(/\/+$/, "");
  if (!base) return null;
  return base.endsWith("/api/calendar/webhook") ? base : `${base}/api/calendar/webhook`;
}

async function stopChannel(call: Caller, channel: WatchChannel) {
  await call("POST", "/channels/stop", { body: { id: channel.id, resourceId: channel.resourceId }, allowMissing: true });
}

/** Sync token for future incremental listings, without fetching full event bodies. */
async function initialSyncToken(call: Caller, calendarId: string): Promise<string> {
  const fields = "nextPageToken,nextSyncToken,items(id)";
  const timeMin = weekRangeUtc(weekStart(todayIso())).start;
  let result = await listAllEvents(call, calendarId, { timeMin, maxResults: 2500, fields });
  if (!result.nextSyncToken) result = await listAllEvents(call, calendarId, { maxResults: 2500, fields });
  if (!result.nextSyncToken) throw new Error("Google did not return a sync token.");
  return result.nextSyncToken;
}

/**
 * Make sure every synced calendar (read calendars + Tiistai) has a watch channel that is valid for
 * at least another 24h, stop channels for calendars no longer synced. No-op without CALENDAR_WEBHOOK_URL.
 */
export async function ensureWatches(
  admin: AdminClient,
  ownerId: string,
): Promise<{ skipped?: boolean; renewed: number; errors: string[] }> {
  const address = webhookAddress();
  if (!address) return { skipped: true, renewed: 0, errors: [] };
  const connection = await loadConnection(admin, ownerId);
  if (!isUsable(connection)) return { skipped: true, renewed: 0, errors: [] };

  const call = calendarCaller(admin, connection);
  const desired = new Set(syncedCalendarIds(connection.account));
  const channels = { ...connection.secret.watch_channels };
  const syncTokens = { ...connection.secret.sync_tokens };
  const errors: string[] = [];
  let renewed = 0;

  try {
    for (const [calendarId, channel] of Object.entries(channels)) {
      if (desired.has(calendarId)) continue;
      await stopChannel(call, channel).catch(() => null);
      delete channels[calendarId];
      delete syncTokens[calendarId];
    }

    for (const calendarId of desired) {
      try {
        if (!syncTokens[calendarId]) syncTokens[calendarId] = await initialSyncToken(call, calendarId);
        const existing = channels[calendarId];
        if (existing && existing.expiration > Date.now() + RENEW_BEFORE_MS) continue;

        const id = `${CHANNEL_PREFIX}${connection.account.id}_${randomBytes(8).toString("hex")}`;
        const token = randomBytes(24).toString("base64url");
        const created = await call<{ resourceId: string; expiration?: string }>(
          "POST",
          `${cal(calendarId)}/events/watch`,
          { body: { id, type: "web_hook", address, token, params: { ttl: String(CHANNEL_TTL_SECONDS) } } },
        );
        channels[calendarId] = {
          id,
          token,
          resourceId: created?.resourceId ?? "",
          expiration: Number(created?.expiration) || Date.now() + CHANNEL_TTL_SECONDS * 1000,
        };
        renewed += 1;
        if (existing) await stopChannel(call, existing).catch(() => null);
      } catch (caught) {
        if (caught instanceof RevokedError) throw caught;
        errors.push(`${calendarId}: ${errorMessage(caught)}`);
      }
    }
  } catch (caught) {
    errors.push(errorMessage(caught));
  }

  await saveSecretFields(admin, connection.secret, { watch_channels: channels, sync_tokens: syncTokens });
  return { renewed, errors };
}

/** Stop all channels (used on disconnect). Best effort. */
export async function stopAllWatches(call: Caller, connection: Connection) {
  for (const channel of Object.values(connection.secret.watch_channels)) {
    await stopChannel(call, channel).catch(() => null);
  }
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Apply one changed event of the Tiistai calendar to its block. Returns false if it is not a block event. */
async function applyWriteCalendarChange(admin: AdminClient, ownerId: string, calendarId: string, event: GoogleEvent) {
  const blockId = event.extendedProperties?.private?.[BLOCK_PROPERTY];
  let query = admin
    .from("time_blocks")
    .select("id, google_event_id, google_etag, sync_status, starts_at, ends_at")
    .eq("owner_id", ownerId);
  query = blockId ? query.eq("id", blockId) : query.eq("google_event_id", event.id).eq("google_calendar_id", calendarId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return Boolean(blockId); // a Tiistai event with no block: ignore
  if (data.google_event_id !== event.id) return true; // push still in flight
  await applyEventToBlock(admin, ownerId, data, event);
  return true;
}

async function storeSyncToken(admin: AdminClient, connection: Connection, calendarId: string, token: string) {
  // Re-read so concurrent ensureWatches/webhooks for other calendars are not overwritten.
  const { data } = await admin
    .from("calendar_account_secrets")
    .select("sync_tokens")
    .eq("account_id", connection.account.id)
    .eq("owner_id", connection.account.owner_id)
    .maybeSingle();
  const tokens = { ...((data?.sync_tokens as Record<string, string> | null) ?? {}), [calendarId]: token };
  await saveSecretFields(admin, connection.secret, { sync_tokens: tokens });
}

/** Incremental sync of one calendar after a push notification. */
export async function syncCalendarChanges(admin: AdminClient, ownerId: string, calendarId: string) {
  const connection = await loadConnection(admin, ownerId);
  if (!isUsable(connection)) return;
  if (!syncedCalendarIds(connection.account).includes(calendarId)) return;

  const call = calendarCaller(admin, connection);
  const isWrite = calendarId === connection.account.write_calendar_id;
  const stored = connection.secret.sync_tokens[calendarId];
  let needsRefresh = false;
  let nextToken: string | undefined;

  if (!stored) {
    nextToken = await initialSyncToken(call, calendarId);
    needsRefresh = true;
  } else {
    try {
      const { items, nextSyncToken } = await listAllEvents(call, calendarId, { syncToken: stored, maxResults: 2500 });
      nextToken = nextSyncToken;
      for (const event of items) {
        const handled = isWrite && (await applyWriteCalendarChange(admin, ownerId, calendarId, event));
        if (!handled) needsRefresh = true;
      }
    } catch (caught) {
      if (!(caught instanceof GoogleError) || caught.status !== 410) throw caught;
      // Sync token expired: full resync of the current and next week.
      nextToken = await initialSyncToken(call, calendarId);
      needsRefresh = true;
    }
  }

  if (nextToken) await storeSyncToken(admin, connection, calendarId, nextToken);
  if (needsRefresh) {
    const monday = weekStart(todayIso());
    await refreshWeek(admin, ownerId, monday);
    await refreshWeek(admin, ownerId, addDays(monday, 7));
  }
}

/**
 * Validate a Google push notification against stored channels.
 * Returns the owner and calendar it belongs to, or null if unknown / bad token.
 */
export async function resolveNotification(
  admin: AdminClient,
  channelId: string,
  token: string,
): Promise<{ ownerId: string; calendarId: string } | null> {
  const match = channelId.match(/^tiistai_([0-9a-f-]{36})_[0-9a-f]+$/);
  if (!match) return null;
  // Unauthenticated entry point: the owner comes from the account row the channel id names.
  const { data, error } = await admin
    .from("calendar_account_secrets")
    .select("owner_id, watch_channels")
    .eq("account_id", match[1])
    .maybeSingle();
  if (error || !data) return null;
  const channels = (data.watch_channels ?? {}) as Record<string, WatchChannel>;
  for (const [calendarId, channel] of Object.entries(channels)) {
    if (channel.id === channelId && safeEqual(channel.token, token)) {
      return { ownerId: data.owner_id as string, calendarId };
    }
  }
  return null;
}
