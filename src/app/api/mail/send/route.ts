import { loadAccounts } from "@/lib/mail/accounts";
import { appendSent, findSentCopy, withImap } from "@/lib/mail/imap";
import { isGoogleMailHost } from "@/lib/mail/providers";
import { jsonError, requireUser } from "@/lib/mail/session";
import { sendMail } from "@/lib/mail/smtp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user || response) return response;

  const body = (await request.json().catch(() => null)) as {
    accountId?: string;
    to?: string[];
    cc?: string[];
    subject?: string;
    text?: string;
    html?: string;
    inReplyTo?: string;
    references?: string[];
  } | null;
  if (!body?.accountId || !body.to?.length || !body.subject?.trim() || !body.text?.trim()) {
    return jsonError("Account, recipients, subject, and message text are required.");
  }

  const [account] = await loadAccounts(user.id, body.accountId);
  if (!account) return jsonError("Mailbox not found.", 404);

  try {
    const sent = await sendMail(account.config, {
      fromName: account.displayName,
      from: account.email,
      to: body.to,
      cc: body.cc,
      subject: body.subject.trim(),
      text: body.text,
      html: body.html,
      inReplyTo: body.inReplyTo,
      references: body.references,
    });
    if (account.folders.sent && !isGoogleMailHost(account.config.imap.host)) {
      await withImap(account.config, async (client) => {
        const alreadyThere = await findSentCopy(client, account.folders.sent!, sent.messageId);
        if (!alreadyThere) await appendSent(client, account.folders.sent!, sent.raw);
      });
    }
    return Response.json({ messageId: sent.messageId });
  } catch (caught) {
    return jsonError(caught instanceof Error ? caught.message : "Could not send the message.", 500);
  }
}
