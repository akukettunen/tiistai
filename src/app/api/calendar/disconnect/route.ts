import { disconnect } from "@/lib/calendar/connect";
import { jsonError, readJson, requireUser } from "@/lib/calendar/http";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user || response) return response;

  const { deleteCalendar } = await readJson(request);
  try {
    const { warnings } = await disconnect(createAdminClient(), user.id, deleteCalendar === true);
    return Response.json(warnings.length ? { ok: true, error: warnings.join("; ") } : { ok: true });
  } catch (caught) {
    return jsonError(caught instanceof Error ? caught.message : "Could not disconnect.", 500);
  }
}
