import { jsonError, requireUser } from "@/lib/mail/session";
import { syncAccounts } from "@/lib/mail/sync";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user || response) return response;

  const body = (await request.json().catch(() => ({}))) as { accountId?: string };
  try {
    const result = await syncAccounts(user.id, body.accountId);
    return Response.json(result);
  } catch (caught) {
    return jsonError(caught instanceof Error ? caught.message : "Sync failed.", 500);
  }
}
