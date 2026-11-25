import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import {
  TIME_ZONE,
  helsinkiToUtc,
  weekRangeUtc,
  weekStart,
  type SyncStatus,
  type TimeBlock,
  type TimeBlockKind,
} from "@/lib/planning";
import {
  calendarCaller,
  errorMessage,
  isUsable,
  loadConnection,
  setAccountStatus,
  syncedCalendarIds,
  type CalendarAccountRow,
} from "@/lib/calendar/account";
import {
  GoogleError,
  RevokedError,
  cal,
  listAllEvents,
  type Caller,
  type GoogleEvent,
} from "@/lib/calendar/google";

// Server-only calendar API used by the front page, MCP and the calendar routes.
// Every query filters by owner_id: the admin client bypasses RLS.

const KIND_LABELS: Record<TimeBlockKind, string> = {
  focus: "Fokus",
  free_coding: "Vapaa koodaus",
  admin: "Admin",
  other: "",
};

const REVOKED_MESSAGE = "Google Kalenterin yhteys on katkennut. Yhdistä uudelleen asetuksista.";
const PENDING_RETRY_LIMIT = 10;

type BlockRow = Pick<
  TimeBlock,
  | "id"
  | "owner_id"
  | "title"
  | "kind"
  | "starts_at"
  | "ends_at"
  | "note_before"
  | "google_calendar_id"
  | "google_event_id"
  | "google_etag"
  | "sync_status"
>;

const BLOCK_COLUMNS =
  "id, owner_id, title, kind, starts_at, ends_at, note_before, google_calendar_id, google_event_id, google_etag, sync_status";

/** Private extended property linking a Google event to its time block. */
export const BLOCK_PROPERTY = "tiistaiBlockId";

async function loadBlock(admin: AdminClient, ownerId: string, blockId: string): Promise<BlockRow | null> {
  const { data, error } = await admin
    .from("time_blocks")
    .select(BLOCK_COLUMNS)
    .eq("id", blockId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BlockRow | null) ?? null;
}

async function updateBlock(admin: AdminClient, ownerId: string, blockId: string, fields: Record<string, unknown>) {
  const { error } = await admin.from("time_blocks").update(fields).eq("id", blockId).eq("owner_id", ownerId);
  if (error) throw new Error(error.message);
}

/** Google event id derived from the block id (UUID hex is valid base32hex), so retries are idempotent. */
function blockEventId(blockId: string) {
  return blockId.replace(/-/g, "").toLowerCase();
}

function eventPath(calendarId: string, eventId: string) {
  return `${cal(calendarId)}/events/${encodeURIComponent(eventId)}`;
}

function eventBody(block: BlockRow) {
  const label = KIND_LABELS[block.kind] ?? "";
  const title = block.title.trim();
  return {
    summary: title ? (label ? `${label} · ${title}` : title) : label || "Aikablokki",
    description: block.note_before ?? "",
    start: { dateTime: new Date(block.starts_at).toISOString(), timeZone: TIME_ZONE },
    end: { dateTime: new Date(block.ends_at).toISOString(), timeZone: TIME_ZONE },
    extendedProperties: { private: { [BLOCK_PROPERTY]: block.id } },
  };
}

async function upsertEvent(call: Caller, writeCalendarId: string, block: BlockRow): Promise<GoogleEvent> {
  const body = eventBody(block);

  // Block lived in an older dedicated calendar: drop that copy.
  if (block.google_event_id && block.google_calendar_id && block.google_calendar_id !== writeCalendarId) {
    await call("DELETE", eventPath(block.google_calendar_id, block.google_event_id), { allowMissing: true }).catch(
      () => null,
    );
  }

  const known = block.google_event_id && block.google_calendar_id === writeCalendarId ? block.google_event_id : null;
  const eventId = known ?? blockEventId(block.id);

  if (known) {
    const patched = await call<GoogleEvent>("PATCH", eventPath(writeCalendarId, eventId), {
      body: { ...body, status: "confirmed" },
      allowMissing: true,
    });
    if (patched) return patched;
  }

  try {
    const created = await call<GoogleEvent>("POST", `${cal(writeCalendarId)}/events`, { body: { ...body, id: eventId } });
    if (!created) throw new GoogleError("Google returned no event.", 500, true);
    return created;
  } catch (caught) {
    // 409: the id already exists (earlier attempt timed out, or the event was deleted in Google).
    // Patching with status "confirmed" updates / restores it.
    if (!(caught instanceof GoogleError) || caught.status !== 409) throw caught;
    const patched = await call<GoogleEvent>("PATCH", eventPath(writeCalendarId, eventId), {
      body: { ...body, status: "confirmed" },
    });
    if (!patched) throw new GoogleError("Google returned no event.", 500, true);
    return patched;
  }
}

function failureStatus(caught: unknown): SyncStatus {
  if (caught instanceof RevokedError) return "pending";
  if (caught instanceof GoogleError) return caught.transient ? "pending" : "error";
  return "pending";
}

/** Create or patch the block's event in the dedicated Tiistai calendar. 'local' when not connected. */
export async function pushBlock(
  admin: AdminClient,
  ownerId: string,
  blockId: string,
): Promise<{ sync_status: SyncStatus; error?: string }> {
  const block = await loadBlock(admin, ownerId, blockId);
  if (!block) return { sync_status: "error", error: "Aikablokkia ei löytynyt." };

  const connection = await loadConnection(admin, ownerId);
  if (!connection) {
    if (block.sync_status !== "local") await updateBlock(admin, ownerId, blockId, { sync_status: "local" });
    return { sync_status: "local" };
  }
  if (!isUsable(connection)) {
    if (block.sync_status !== "pending") await updateBlock(admin, ownerId, blockId, { sync_status: "pending" });
    return { sync_status: "pending", error: REVOKED_MESSAGE };
  }

  const writeCalendarId = connection.account.write_calendar_id!;
  try {
    const event = await upsertEvent(calendarCaller(admin, connection), writeCalendarId, block);
    await updateBlock(admin, ownerId, blockId, {
      google_event_id: event.id,
      google_calendar_id: writeCalendarId,
      google_etag: event.etag ?? null,
      sync_status: "synced",
    });
    return { sync_status: "synced" };
  } catch (caught) {
    const status = failureStatus(caught);
    await updateBlock(admin, ownerId, blockId, { sync_status: status }).catch(() => null);
    return { sync_status: status, error: caught instanceof RevokedError ? REVOKED_MESSAGE : errorMessage(caught) };
  }
}

/** Delete the Google event (ignoring 404/410), then the time_blocks row. */
export async function removeBlock(admin: AdminClient, ownerId: string, blockId: string): Promise<void> {
  const block = await loadBlock(admin, ownerId, blockId);
  if (!block) return;

  if (block.google_event_id && block.google_calendar_id) {
    try {
      const connection = await loadConnection(admin, ownerId);
      if (isUsable(connection)) {
        await calendarCaller(admin, connection)("DELETE", eventPath(block.google_calendar_id, block.google_event_id), {
          allowMissing: true,
        });
      }
    } catch (caught) {
      // The row goes anyway; an orphaned event stays in Google (refreshWeek ignores it).
      console.error("calendar: could not delete Google event", block.google_event_id, errorMessage(caught));
    }
  }

  const { error } = await admin.from("time_blocks").delete().eq("id", blockId).eq("owner_id", ownerId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Reading events
// ---------------------------------------------------------------------------

/** UTC range of an event; all-day events map to Helsinki midnights. */
export function eventRange(event: GoogleEvent): { starts_at: string; ends_at: string; all_day: boolean } | null {
  const start = event.start;
  const end = event.end;
  if (start?.dateTime) {
    const startsAt = new Date(start.dateTime);
    const endsAt = end?.dateTime ? new Date(end.dateTime) : startsAt;
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;
    return { starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), all_day: false };
  }
  if (start?.date) {
    const endDate = end?.date ?? start.date;
    return {
      starts_at: helsinkiToUtc(start.date, "00:00").toISOString(),
      ends_at: helsinkiToUtc(endDate, "00:00").toISOString(),
      all_day: true,
    };
  }
  return null;
}

function isDeclined(event: GoogleEvent) {
  return Boolean(event.attendees?.some((a) => a.self && a.responseStatus === "declined"));
}

export function isBlockEvent(event: GoogleEvent) {
  return Boolean(event.extendedProperties?.private?.[BLOCK_PROPERTY]);
}

/** Replace the cached rows of one calendar for [range.start, range.end). */
async function replaceWeekCache(
  admin: AdminClient,
  ownerId: string,
  calendarId: string,
  range: { start: string; end: string },
  events: GoogleEvent[],
  isWriteCalendar: boolean,
) {
  const now = new Date().toISOString();
  const rows = events.flatMap((event) => {
    if (event.status === "cancelled" || isDeclined(event)) return [];
    if (isWriteCalendar && isBlockEvent(event)) return [];
    const time = eventRange(event);
    if (!time) return [];
    return [
      {
        owner_id: ownerId,
        calendar_id: calendarId,
        google_event_id: event.id,
        title: event.summary?.trim() || "(ei otsikkoa)",
        ...time,
        updated_at: now,
      },
    ];
  });

  const removed = await admin
    .from("calendar_events_cache")
    .delete()
    .eq("owner_id", ownerId)
    .eq("calendar_id", calendarId)
    .lt("starts_at", range.end)
    .gt("ends_at", range.start);
  if (removed.error) throw new Error(removed.error.message);

  if (rows.length) {
    const { error } = await admin
      .from("calendar_events_cache")
      .upsert(rows, { onConflict: "owner_id,calendar_id,google_event_id" });
    if (error) throw new Error(error.message);
  }
}

/**
 * Apply a Google-side change of a block's event to the block: gone/cancelled deletes the
 * block, a new etag copies start/end. Blocks with unpushed local changes are left alone.
 */
export async function applyEventToBlock(
  admin: AdminClient,
  ownerId: string,
  block: Pick<BlockRow, "id" | "google_etag" | "sync_status" | "starts_at" | "ends_at">,
  event: GoogleEvent | null,
) {
  if (block.sync_status !== "synced") return "skipped" as const;
  if (!event || event.status === "cancelled") {
    const { error } = await admin.from("time_blocks").delete().eq("id", block.id).eq("owner_id", ownerId);
    if (error) throw new Error(error.message);
    return "deleted" as const;
  }
  if (event.etag && event.etag === block.google_etag) return "unchanged" as const;
  const time = eventRange(event);
  const fields: Record<string, unknown> = { google_etag: event.etag ?? null };
  if (time && new Date(time.ends_at) > new Date(time.starts_at)) {
    fields.starts_at = time.starts_at;
    fields.ends_at = time.ends_at;
    fields.updated_at = new Date().toISOString();
  }
  await updateBlock(admin, ownerId, block.id, fields);
  return "updated" as const;
}

async function reconcileWeekBlocks(
  admin: AdminClient,
  ownerId: string,
  call: Caller,
  range: { start: string; end: string },
  writeCalendarId: string,
  writeEvents: Map<string, GoogleEvent>,
) {
  const { data, error } = await admin
    .from("time_blocks")
    .select("id, google_calendar_id, google_event_id, google_etag, sync_status, starts_at, ends_at")
    .eq("owner_id", ownerId)
    .eq("sync_status", "synced")
    .not("google_event_id", "is", null)
    .lt("starts_at", range.end)
    .gt("ends_at", range.start);
  if (error) throw new Error(error.message);

  for (const block of (data ?? []) as BlockRow[]) {
    const calendarId = block.google_calendar_id ?? writeCalendarId;
    let event = calendarId === writeCalendarId ? writeEvents.get(block.google_event_id!) : undefined;
    if (!event) {
      // Not in this week's listing: moved to another week, or deleted.
      try {
        event =
          (await call<GoogleEvent>("GET", eventPath(calendarId, block.google_event_id!), { allowMissing: true })) ??
          undefined;
      } catch (caught) {
        if (caught instanceof RevokedError) throw caught;
        continue;
      }
    }
    await applyEventToBlock(admin, ownerId, block, event ?? null);
  }
}

async function retryUnsyncedBlocks(admin: AdminClient, ownerId: string) {
  const { data, error } = await admin
    .from("time_blocks")
    .select("id")
    .eq("owner_id", ownerId)
    .in("sync_status", ["pending", "error"])
    .order("starts_at", { ascending: false })
    .limit(PENDING_RETRY_LIMIT);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const result = await pushBlock(admin, ownerId, row.id as string);
    if (result.error === REVOKED_MESSAGE) break;
  }
}

function calendarLabel(account: CalendarAccountRow, calendarId: string) {
  if (calendarId === account.write_calendar_id) return "Tiistai";
  return account.available_calendars.find((c) => c.id === calendarId)?.summary ?? calendarId;
}

/** Fetch the week's events from read calendars + the Tiistai calendar, update the cache, reconcile blocks. */
export async function refreshWeek(
  admin: AdminClient,
  ownerId: string,
  monday: string,
): Promise<{ connected: boolean; error?: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(monday) || weekStart(monday) !== monday) {
    throw new Error("week must be a Monday (YYYY-MM-DD).");
  }

  const connection = await loadConnection(admin, ownerId);
  if (!connection) return { connected: false };
  if (!isUsable(connection)) return { connected: false, error: connection.account.last_error || REVOKED_MESSAGE };

  const { account } = connection;
  const writeCalendarId = account.write_calendar_id!;
  const call = calendarCaller(admin, connection);
  const range = weekRangeUtc(monday);
  const errors: string[] = [];

  try {
    await retryUnsyncedBlocks(admin, ownerId);

    const writeEvents = new Map<string, GoogleEvent>();
    let writeListed = false;
    for (const calendarId of syncedCalendarIds(account)) {
      try {
        const { items } = await listAllEvents(call, calendarId, {
          timeMin: range.start,
          timeMax: range.end,
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 250,
        });
        if (calendarId === writeCalendarId) {
          for (const event of items) writeEvents.set(event.id, event);
          writeListed = true;
        }
        await replaceWeekCache(admin, ownerId, calendarId, range, items, calendarId === writeCalendarId);
      } catch (caught) {
        if (caught instanceof RevokedError) throw caught;
        errors.push(`${calendarLabel(account, calendarId)}: ${errorMessage(caught)}`);
      }
    }

    if (writeListed) await reconcileWeekBlocks(admin, ownerId, call, range, writeCalendarId, writeEvents);
  } catch (caught) {
    if (caught instanceof RevokedError) return { connected: false, error: REVOKED_MESSAGE };
    errors.push(errorMessage(caught));
  }

  const error = errors.length ? errors.join("; ").slice(0, 1000) : undefined;
  await setAccountStatus(
    admin,
    account,
    error ? "error" : "ok",
    error ?? null,
    error ? {} : { last_synced_at: new Date().toISOString() },
  );
  return error ? { connected: true, error } : { connected: true };
}
