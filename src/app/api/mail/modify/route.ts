import { archiveThreads, markThreadsSeen } from "@/lib/mail/actions";
import { jsonError, requireUser } from "@/lib/mail/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user || response) return response;

  const body = (await request.json().catch(() => null)) as {
    action?: "seen" | "unseen" | "archive";
    threadIds?: string[];
  } | null;
  if (!body?.action || !body.threadIds?.length) {
    return jsonError("Provide an action and at least one thread.");
  }

  try {
    if (body.action === "archive") await archiveThreads(user.id, body.threadIds);
    else await markThreadsSeen(user.id, body.threadIds, body.action === "seen");
    return Response.json({ ok: true });
  } catch (caught) {
    return jsonError(caught instanceof Error ? caught.message : "Could not update the messages.", 500);
  }
}
