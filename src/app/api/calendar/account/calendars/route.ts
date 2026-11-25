import {
  calendarCaller,
  errorMessage,
  isUsable,
  loadConnection,
  refreshCalendarList,
  saveSecretFields,
} from "@/lib/calendar/account";
import { accountView, jsonError, readJson, requireUser } from "@/lib/calendar/http";
import { ensureWatches } from "@/lib/calendar/watch";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user || response) return response;

  const { read_calendar_ids: requested } = await readJson(request);
  if (!Array.isArray(requested) || requested.some((id) => typeof id !== "string") || requested.length > 50) {
    return jsonError("read_calendar_ids must be an array of calendar ids.");
  }

  const admin = createAdminClient();
  const connection = await loadConnection(admin, user.id);
  if (!isUsable(connection)) return jsonError("Google Kalenteria ei ole yhdistetty.", 409);

  try {
    await refreshCalendarList(admin, connection, calendarCaller(admin, connection));
  } catch (caught) {
    return Response.json({ ...(await accountView(user.id)), error: errorMessage(caught) });
  }

  const available = new Set(connection.account.available_calendars.map((c) => c.id));
  const unknown = (requested as string[]).filter((id) => !available.has(id));
  if (unknown.length) return jsonError("Tuntematon kalenteri: " + unknown.join(", "));
  const readIds = [...new Set(requested as string[])];

  const { error } = await admin
    .from("calendar_accounts")
    .update({ read_calendar_ids: readIds, updated_at: new Date().toISOString() })
    .eq("id", connection.account.id)
    .eq("owner_id", user.id);
  if (error) return jsonError(error.message, 500);

  // Drop cached events and sync tokens of calendars that are no longer read.
  const keep = new Set([...readIds, connection.account.write_calendar_id!]);
  const dropped = Object.keys(connection.secret.sync_tokens).filter((id) => !keep.has(id));
  const cached = await admin.from("calendar_events_cache").select("calendar_id").eq("owner_id", user.id);
  const staleCalendars = [...new Set((cached.data ?? []).map((r) => r.calendar_id as string))].filter(
    (id) => !keep.has(id),
  );
  if (staleCalendars.length) {
    await admin.from("calendar_events_cache").delete().eq("owner_id", user.id).in("calendar_id", staleCalendars);
  }
  if (dropped.length) {
    const tokens = { ...connection.secret.sync_tokens };
    for (const id of dropped) delete tokens[id];
    await saveSecretFields(admin, connection.secret, { sync_tokens: tokens });
  }

  const watches = await ensureWatches(admin, user.id).catch((caught) => ({ errors: [errorMessage(caught)] }));
  const view = await accountView(user.id);
  return Response.json(watches.errors.length ? { ...view, error: watches.errors.join("; ") } : view);
}
