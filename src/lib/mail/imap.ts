import "server-only";
import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import type { MailFolder } from "@/lib/crm";
import type { FolderMap, FolderSyncState, LoadedAccount, MailConfig, ParsedMessage } from "@/lib/mail/types";
import { asAddress, normalizeMessageId, uniqueAddresses } from "@/lib/mail/parse";
import { isAllMailPath } from "@/lib/mail/providers";

const SENT_NAMES = new Set(["sent", "sent items", "sent mail", "sent messages"]);
const ARCHIVE_NAMES = new Set(["archive", "archived"]);
const FIRST_SYNC_DAYS = 30;
const FLAG_LOOKBACK = 500;

export async function withImap<T>(config: MailConfig, run: (client: ImapFlow) => Promise<T>) {
  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: { user: config.username, pass: config.password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

export async function testImap(config: MailConfig) {
  return withImap(config, async (client) => discoverFolders(client));
}

export async function discoverFolders(client: ImapFlow): Promise<FolderMap> {
  const boxes = await client.list();
  const inbox =
    boxes.find((box) => box.specialUse === "\\Inbox")?.path ??
    boxes.find((box) => box.path.toUpperCase() === "INBOX")?.path ??
    "INBOX";
  const sent =
    boxes.find((box) => box.specialUse === "\\Sent")?.path ??
    boxes.find((box) => SENT_NAMES.has(box.path.split(/[/.\]]/).pop()?.toLowerCase() ?? ""))?.path;
  const archive =
    boxes.find((box) => box.specialUse === "\\Archive")?.path ??
    boxes.find((box) => ARCHIVE_NAMES.has(box.path.split(/[/.\]]/).pop()?.toLowerCase() ?? ""))?.path;
  return { inbox, sent, archive };
}

export async function ensureArchiveFolder(client: ImapFlow, folders: FolderMap) {
  if (folders.archive) return folders.archive;
  const boxes = await client.list();
  const allMail = boxes.find((box) => box.specialUse === "\\All")?.path;
  if (allMail) {
    folders.archive = allMail;
    return allMail;
  }
  await client.mailboxCreate("Archive");
  try {
    await client.mailboxSubscribe("Archive");
  } catch {
    // Subscribe is optional; some servers reject it.
  }
  folders.archive = "Archive";
  return folders.archive;
}

function addressesFrom(value?: AddressObject | AddressObject[]) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return uniqueAddresses(
    list.flatMap((entry) =>
      (entry.value ?? []).map((item) => asAddress({ name: item.name, address: item.address })),
    ),
  );
}

function parseReferences(value: ParsedMail["references"]) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map(normalizeMessageId).filter(Boolean);
}

export async function parseRawMessage(
  folder: MailFolder,
  uid: number,
  uidvalidity: string,
  source: Buffer,
  flags: Set<string> | string[] | undefined,
): Promise<ParsedMessage> {
  const parsed = await simpleParser(source);
  const from = asAddress(parsed.from?.value[0]);
  const to = addressesFrom(parsed.to);
  const cc = addressesFrom(parsed.cc);
  const messageId = normalizeMessageId(parsed.messageId);
  const generated = !messageId;
  const attachments = (parsed.attachments ?? []).map((part) => ({
    filename: part.filename || "attachment",
    size: part.size ?? 0,
    contentType: part.contentType || "application/octet-stream",
  }));
  const flagSet = flags instanceof Set ? flags : new Set(flags ?? []);
  return {
    folder,
    uid,
    uidvalidity,
    messageId: messageId || `generated:${folder}:${uidvalidity}:${uid}`,
    inReplyTo: normalizeMessageId(parsed.inReplyTo) || null,
    references: parseReferences(parsed.references),
    from,
    to,
    cc,
    subject: parsed.subject ?? "",
    html: typeof parsed.html === "string" ? parsed.html : null,
    text: parsed.text ?? "",
    attachments,
    date: (parsed.date ?? new Date()).toISOString(),
    seen: flagSet.has("\\Seen"),
    generatedId: generated,
  };
}

export async function fetchNewMessages(
  client: ImapFlow,
  folder: MailFolder,
  path: string,
  state: FolderSyncState | undefined,
  firstSync: boolean,
  limit: number,
) {
  const lock = await client.getMailboxLock(path);
  try {
    const mailbox = client.mailbox;
    if (!mailbox) return { messages: [] as ParsedMessage[], state: state ?? { uidvalidity: "0", lastUid: 0 } };
    const uidvalidity = String(mailbox.uidValidity);
    const reset = !state || state.uidvalidity !== uidvalidity;
    const lastUid = reset ? 0 : state.lastUid;
    const query: { uid: string; since?: Date } = { uid: `${lastUid + 1}:*` };
    if (firstSync || reset) {
      query.since = new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000);
    }
    const found = await client.search(query, { uid: true });
    const uids = (Array.isArray(found) ? found : []).filter((uid) => uid > lastUid).sort((a, b) => a - b);
    const batch = uids.slice(0, limit);
    const messages: ParsedMessage[] = [];
    if (batch.length) {
      for await (const msg of client.fetch(batch, { uid: true, source: true, flags: true }, { uid: true })) {
        if (!msg.source) continue;
        const source = Buffer.isBuffer(msg.source) ? msg.source : Buffer.from(msg.source);
        messages.push(await parseRawMessage(folder, msg.uid, uidvalidity, source, msg.flags));
      }
    }
    const nextLast = batch.length ? Math.max(lastUid, ...batch) : lastUid;
    return {
      messages,
      more: uids.length > batch.length,
      state: {
        uidvalidity,
        lastUid: nextLast,
        highestModseq: mailbox.highestModseq ? String(mailbox.highestModseq) : state?.highestModseq,
      },
    };
  } finally {
    lock.release();
  }
}

export async function fetchFlagChanges(
  client: ImapFlow,
  path: string,
  state: FolderSyncState,
) {
  const lock = await client.getMailboxLock(path);
  try {
    const mailbox = client.mailbox;
    if (!mailbox) return { changes: [] as { uid: number; seen: boolean }[], state };
    const changes: { uid: number; seen: boolean }[] = [];
    if (mailbox.highestModseq && state.highestModseq && !mailbox.noModseq) {
      const previous = BigInt(state.highestModseq);
      if (mailbox.highestModseq > previous) {
        for await (const msg of client.fetch("1:*", { uid: true, flags: true }, {
          uid: true,
          changedSince: previous,
        })) {
          changes.push({ uid: msg.uid, seen: !!msg.flags?.has("\\Seen") });
        }
      }
    } else {
      const min = Math.max(1, mailbox.uidNext - FLAG_LOOKBACK);
      for await (const msg of client.fetch(`${min}:*`, { uid: true, flags: true }, { uid: true })) {
        changes.push({ uid: msg.uid, seen: !!msg.flags?.has("\\Seen") });
      }
    }
    return {
      changes,
      state: {
        ...state,
        uidvalidity: String(mailbox.uidValidity),
        highestModseq: mailbox.highestModseq ? String(mailbox.highestModseq) : state.highestModseq,
      },
    };
  } finally {
    lock.release();
  }
}

export async function findSentCopy(client: ImapFlow, sentPath: string, messageId: string) {
  const lock = await client.getMailboxLock(sentPath);
  try {
    const found = await client.search({ header: { "message-id": `<${normalizeMessageId(messageId)}>` } }, { uid: true });
    return Array.isArray(found) && found.length > 0;
  } finally {
    lock.release();
  }
}

export async function appendSent(client: ImapFlow, sentPath: string, raw: string | Buffer) {
  await client.append(sentPath, raw, ["\\Seen"]);
}

export async function setMessageSeen(
  client: ImapFlow,
  path: string,
  uids: number[],
  seen: boolean,
) {
  if (!uids.length) return;
  const lock = await client.getMailboxLock(path);
  try {
    if (seen) await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
    else await client.messageFlagsRemove(uids, ["\\Seen"], { uid: true });
  } finally {
    lock.release();
  }
}

export async function moveMessages(client: ImapFlow, path: string, destination: string, uids: number[]) {
  if (!uids.length) return new Map<number, number>();
  const lock = await client.getMailboxLock(path);
  try {
    const result = await client.messageMove(uids, destination, { uid: true });
    return result ? (result.uidMap ?? new Map<number, number>()) : new Map<number, number>();
  } finally {
    lock.release();
  }
}

export async function mailboxUidValidity(client: ImapFlow, path: string) {
  const lock = await client.getMailboxLock(path);
  try {
    return client.mailbox ? String(client.mailbox.uidValidity) : "0";
  } finally {
    lock.release();
  }
}

export function providerMessageId(folder: MailFolder, uidvalidity: string, uid: number) {
  return `${folder}:${uidvalidity}:${uid}`;
}

export function accountFolders(account: LoadedAccount): [MailFolder, string][] {
  const entries: [MailFolder, string][] = [["inbox", account.folders.inbox || "INBOX"]];
  if (account.folders.sent) entries.push(["sent", account.folders.sent]);
  if (account.folders.archive && !isAllMailPath(account.folders.archive)) {
    entries.push(["archive", account.folders.archive]);
  }
  return entries;
}
