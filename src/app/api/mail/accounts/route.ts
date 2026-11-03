import { deleteAccount, insertAccount, parseMailConfig, updateAccountSecret } from "@/lib/mail/accounts";
import { testImap } from "@/lib/mail/imap";
import { googleConnectHint, isGoogleMailHost } from "@/lib/mail/providers";
import { jsonError, requireUser } from "@/lib/mail/session";
import { testSmtp } from "@/lib/mail/smtp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user || response) return response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const config = parseMailConfig(body);
  if (!config) return jsonError("Provide email, username, password, and IMAP/SMTP host, port, and TLS.");

  try {
    const folders = await testImap(config);
    await testSmtp(config);
    const displayName =
      typeof body?.display_name === "string" && body.display_name.trim()
        ? body.display_name.trim().slice(0, 120)
        : config.email;
    const id = typeof body?.id === "string" ? body.id : null;
    if (id) {
      await updateAccountSecret(id, user.id, config, folders, displayName);
      return Response.json({ id });
    }
    const account = await insertAccount(user.id, config, folders, displayName);
    return Response.json({ id: account.id });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Could not connect to the mailbox.";
    return jsonError(
      config && isGoogleMailHost(config.imap.host) ? googleConnectHint(message) : message,
      422,
    );
  }
}

export async function DELETE(request: Request) {
  const { user, response } = await requireUser();
  if (!user || response) return response;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return jsonError("Missing account id.");
  try {
    await deleteAccount(id, user.id);
    return Response.json({ ok: true });
  } catch (caught) {
    return jsonError(caught instanceof Error ? caught.message : "Could not delete the account.");
  }
}
