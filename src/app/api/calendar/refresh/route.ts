import { refreshWeek } from "@/lib/calendar/blocks";
import { jsonError, readJson, requireUser } from "@/lib/calendar/http";
import { weekStart } from "@/lib/planning";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user || response) return response;

  const { week } = await readJson(request);
  if (typeof week !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(week) || weekStart(week) !== week) {
    return jsonError("week must be a Monday (YYYY-MM-DD).");
  }
  try {
    return Response.json(await refreshWeek(createAdminClient(), user.id, week));
  } catch (caught) {
    return Response.json({ connected: true, error: caught instanceof Error ? caught.message : "Sync failed." });
  }
}
