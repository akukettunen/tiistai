import { errorMessage } from "@/lib/calendar/account";
import { resolveNotification, syncCalendarChanges } from "@/lib/calendar/watch";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Google Calendar push notifications (events.watch). No session: authenticated by the
// per-channel token stored in calendar_account_secrets.watch_channels.
export async function POST(request: Request) {
  const channelId = request.headers.get("x-goog-channel-id") ?? "";
  const token = request.headers.get("x-goog-channel-token") ?? "";
  const state = request.headers.get("x-goog-resource-state") ?? "";

  const admin = createAdminClient();
  const target = await resolveNotification(admin, channelId, token);
  if (!target) return new Response(null, { status: 403 });
  if (state === "sync") return new Response(null, { status: 200 });

  try {
    await syncCalendarChanges(admin, target.ownerId, target.calendarId);
  } catch (caught) {
    // Acknowledge anyway; the next notification or page refresh catches up.
    console.error("calendar webhook sync failed", errorMessage(caught));
  }
  return new Response(null, { status: 200 });
}
