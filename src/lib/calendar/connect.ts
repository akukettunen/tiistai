import "server-only";
import { decryptSecret, encryptSecret } from "@/lib/mail/crypto";
import type { AdminClient } from "@/lib/supabase/admin";
import { TIME_ZONE } from "@/lib/planning";
import {
  TIISTAI_CALENDAR_DESCRIPTION,
  TIISTAI_CALENDAR_SUMMARY,
  cacheAccessToken,
  calendarCaller,
  errorMessage,
  forgetAccessToken,
  loadAccount,
  loadConnection,
  toAvailable,
  type CalendarAccountRow,
} from "@/lib/calendar/account";
import {
  cal,
  listCalendars,
  revokeToken,
  tokenCaller,
  type GoogleCalendarListEntry,
} from "@/lib/calendar/google";
import { ensureWatches, stopAllWatches } from "@/lib/calendar/watch";

const now = () => new Date().toISOString();

/** Clear every Google link from the owner's blocks (they become local-only). */
async function detachBlocks(admin: AdminClient, ownerId: string) {
  const { error } = await admin
    .from("time_blocks")
    .update({ sync_status: "local", google_event_id: null, google_calendar_id: null, google_etag: null })
    .eq("owner_id", ownerId);
  if (error) throw new Error(error.message);
}

/**
 * Finish the OAuth callback: store the account + encrypted refresh token, find or create the
 * dedicated "Tiistai" calendar, store the calendar list and default read calendars.
 */
export async function completeConnection(
  admin: AdminClient,
  ownerId: string,
  tokens: { accessToken: string; expiresIn?: number; refreshToken?: string; email: string },
) {
  const call = tokenCaller(tokens.accessToken);
  const previous = await loadAccount(admin, ownerId);
  const sameGoogleAccount = previous && previous.email.toLowerCase() === tokens.email.toLowerCase();

  let refreshToken = tokens.refreshToken;
  if (!refreshToken && previous && sameGoogleAccount) {
    const existing = await loadConnection(admin, ownerId);
    if (existing) refreshToken = decryptSecret(existing.secret.refresh_token);
  }
  if (!refreshToken) throw new Error("Google ei palauttanut refresh tokenia. Yritä yhdistää uudelleen.");

  if (previous && !sameGoogleAccount) {
    // A different Google account: forget everything tied to the old one.
    await admin.from("calendar_events_cache").delete().eq("owner_id", ownerId);
    await detachBlocks(admin, ownerId);
  }

  const entries = await listCalendars(call);
  let writeCalendarId = sameGoogleAccount ? previous?.write_calendar_id ?? null : null;
  if (writeCalendarId && !entries.some((e) => e.id === writeCalendarId)) {
    // The dedicated calendar was deleted in Google: its blocks must be pushed again.
    writeCalendarId = null;
  }
  if (!writeCalendarId) {
    const reusable = entries.find(
      (e) => e.accessRole === "owner" && e.description === TIISTAI_CALENDAR_DESCRIPTION,
    );
    writeCalendarId = reusable?.id ?? null;
  }
  if (!writeCalendarId) {
    const created = await call<GoogleCalendarListEntry>("POST", "/calendars", {
      body: { summary: TIISTAI_CALENDAR_SUMMARY, description: TIISTAI_CALENDAR_DESCRIPTION, timeZone: TIME_ZONE },
    });
    if (!created?.id) throw new Error("Tiistai-kalenterin luonti epäonnistui.");
    writeCalendarId = created.id;
  }

  const available = toAvailable(entries, writeCalendarId);
  const availableIds = new Set(available.map((c) => c.id));
  const keptReadIds = (sameGoogleAccount ? previous?.read_calendar_ids ?? [] : []).filter((id) => availableIds.has(id));
  const primary = available.find((c) => c.primary);
  const readIds = keptReadIds.length ? keptReadIds : primary ? [primary.id] : [];

  const { data: account, error } = await admin
    .from("calendar_accounts")
    .upsert(
      {
        owner_id: ownerId,
        email: tokens.email,
        status: "ok",
        last_error: null,
        write_calendar_id: writeCalendarId,
        read_calendar_ids: readIds,
        available_calendars: available,
        updated_at: now(),
      },
      { onConflict: "owner_id" },
    )
    .select("id")
    .single();
  if (error || !account) throw new Error(error?.message ?? "Tilin tallennus epäonnistui.");

  const secret = await admin
    .from("calendar_account_secrets")
    .upsert(
      {
        account_id: account.id,
        owner_id: ownerId,
        refresh_token: encryptSecret(refreshToken),
        // New tokens/channels are created by ensureWatches; keep old ones only for the same account.
        ...(sameGoogleAccount ? {} : { sync_tokens: {}, watch_channels: {} }),
        updated_at: now(),
      },
      { onConflict: "account_id" },
    );
  if (secret.error) throw new Error(secret.error.message);

  cacheAccessToken(account.id as string, tokens.accessToken, tokens.expiresIn);

  // Blocks that are local (never pushed) or linked to a vanished calendar get pushed by the next refresh.
  await admin
    .from("time_blocks")
    .update({ sync_status: "pending" })
    .eq("owner_id", ownerId)
    .eq("sync_status", "local")
    .gt("ends_at", now());
  await admin
    .from("time_blocks")
    .update({ sync_status: "pending", google_event_id: null, google_calendar_id: null, google_etag: null })
    .eq("owner_id", ownerId)
    .not("google_calendar_id", "is", null)
    .neq("google_calendar_id", writeCalendarId);

  await ensureWatches(admin, ownerId).catch((caught) =>
    console.error("calendar: ensureWatches after connect failed", errorMessage(caught)),
  );
}

/** Revoke at Google, optionally delete the Tiistai calendar, and remove all local calendar state. */
export async function disconnect(admin: AdminClient, ownerId: string, deleteCalendar: boolean) {
  const connection = await loadConnection(admin, ownerId);
  const account: CalendarAccountRow | null = connection?.account ?? (await loadAccount(admin, ownerId));
  const warnings: string[] = [];

  if (connection && connection.account.status !== "revoked") {
    const call = calendarCaller(admin, connection);
    try {
      await stopAllWatches(call, connection);
      if (deleteCalendar && connection.account.write_calendar_id) {
        await call("DELETE", cal(connection.account.write_calendar_id), { allowMissing: true });
      }
    } catch (caught) {
      warnings.push(errorMessage(caught));
    }
    try {
      await revokeToken(decryptSecret(connection.secret.refresh_token));
    } catch (caught) {
      warnings.push(errorMessage(caught));
    }
  }

  if (account) forgetAccessToken(account.id);
  await admin.from("calendar_account_secrets").delete().eq("owner_id", ownerId);
  await admin.from("calendar_events_cache").delete().eq("owner_id", ownerId);
  const removed = await admin.from("calendar_accounts").delete().eq("owner_id", ownerId);
  if (removed.error) throw new Error(removed.error.message);
  await detachBlocks(admin, ownerId);
  return { warnings };
}
