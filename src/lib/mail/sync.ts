import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail, type MailFolder } from "@/lib/crm";
import { loadAccounts, saveSyncProgress, setAccountStatus } from "@/lib/mail/accounts";
import {
  accountFolders,
  discoverFolders,
  fetchFlagChanges,
  fetchNewMessages,
  providerMessageId,
  withImap,
} from "@/lib/mail/imap";
import { snippetOf, threadKey, uniqueAddresses } from "@/lib/mail/parse";
import type { FolderMap, LoadedAccount, ParsedMessage, SyncState } from "@/lib/mail/types";

const TIME_BUDGET_MS = 20_000;
const PER_FOLDER_CAP = 40;

type MessageRow = {
  id: string;
  folder: MailFolder;
  uid: number;
  is_seen: boolean;
  sent_at: string;
  body_text: string;
  subject: string;
  from_address: { name: string; address: string };
  to_addresses: { name: string; address: string }[];
  cc_addresses: { name: string; address: string }[];
};

export async function syncAccounts(ownerId: string, accountId?: string) {
  const accounts = await loadAccounts(ownerId, accountId);
  if (!accounts.length) return { done: true, processed: 0, accounts: 0 };

  let processed = 0;
  let done = true;
  for (const account of accounts) {
    const result = await syncOne(account);
    processed += result.processed;
    if (!result.done) done = false;
  }
  return { done, processed, accounts: accounts.length };
}

async function syncOne(account: LoadedAccount) {
  const started = Date.now();
  await setAccountStatus(account.id, account.ownerId, "syncing");
  try {
    const result = await withImap(account.config, async (client) => {
      if (!account.folders.inbox) {
        account.folders = { ...account.folders, ...(await discoverFolders(client)) };
      }
      let processed = 0;
      let done = true;
      for (const [folder, path] of accountFolders(account)) {
        if (Date.now() - started > TIME_BUDGET_MS) {
          done = false;
          break;
        }
        const firstSync = !account.syncState[folder];
        const fetched = await fetchNewMessages(
          client,
          folder,
          path,
          account.syncState[folder],
          firstSync,
          PER_FOLDER_CAP,
        );
        for (const message of fetched.messages) {
          await upsertMessage(account, message);
          processed += 1;
        }
        account.syncState[folder] = fetched.state;
        if (fetched.more) done = false;
        if (account.syncState[folder] && Date.now() - started < TIME_BUDGET_MS) {
          const flags = await fetchFlagChanges(client, path, account.syncState[folder]!);
          await applyFlagChanges(account, folder, flags.changes);
          account.syncState[folder] = flags.state;
        }
      }
      return { processed, done, folders: account.folders, syncState: account.syncState };
    });
    await saveSyncProgress(account.id, account.ownerId, result.folders, result.syncState);
    await setAccountStatus(account.id, account.ownerId, "ok", {
      lastError: null,
      lastSyncedAt: new Date().toISOString(),
    });
    return result;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    await setAccountStatus(account.id, account.ownerId, "error", { lastError: message });
    throw caught;
  }
}

async function upsertMessage(account: LoadedAccount, message: ParsedMessage) {
  const admin = createAdminClient();
  const participants = uniqueAddresses([message.from, ...message.to, ...message.cc]);
  const providerThreadId = threadKey({
    references: message.references,
    inReplyTo: message.inReplyTo,
    messageId: message.messageId,
    generatedId: !!message.generatedId,
    subject: message.subject,
    participants,
  });

  const { data: existingThread } = await admin
    .from("email_threads")
    .select("id, person_id, deal_id")
    .eq("account_id", account.id)
    .eq("provider_thread_id", providerThreadId)
    .maybeSingle();

  let threadId = existingThread?.id as string | undefined;
  if (!threadId) {
    const { data, error } = await admin
      .from("email_threads")
      .insert({
        owner_id: account.ownerId,
        account_id: account.id,
        provider_thread_id: providerThreadId,
        subject: message.subject,
        snippet: snippetOf(message.text),
        participants,
        last_message_at: message.date,
        message_count: 1,
        is_unread: !message.seen,
        folder: message.folder,
      })
      .select("id, person_id, deal_id")
      .single();
    if (error) throw new Error(error.message);
    threadId = data.id as string;
    await autoLinkThread(account, threadId, participants, data.person_id, data.deal_id);
  }
  if (!threadId) throw new Error("Could not create the email thread.");

  const { error } = await admin.from("email_messages").upsert(
    {
      owner_id: account.ownerId,
      account_id: account.id,
      thread_id: threadId,
      provider_message_id: providerMessageId(message.folder, message.uidvalidity, message.uid),
      folder: message.folder,
      uid: message.uid,
      uidvalidity: Number(message.uidvalidity),
      message_id_header: message.messageId,
      in_reply_to: message.inReplyTo,
      references: message.references,
      from_address: message.from,
      to_addresses: message.to,
      cc_addresses: message.cc,
      subject: message.subject,
      body_html: message.html,
      body_text: message.text,
      attachments: message.attachments,
      sent_at: message.date,
      is_outbound: message.from.address === normalizeEmail(account.email),
      is_seen: message.seen,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "account_id,message_id_header" },
  );
  if (error) throw new Error(error.message);
  await refreshThread(threadId);
  if (existingThread) {
    await autoLinkThread(
      account,
      threadId,
      participants,
      existingThread.person_id,
      existingThread.deal_id,
    );
  }
}

async function applyFlagChanges(
  account: LoadedAccount,
  folder: MailFolder,
  changes: { uid: number; seen: boolean }[],
) {
  if (!changes.length) return;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_messages")
    .select("id, uid, is_seen, thread_id")
    .eq("account_id", account.id)
    .eq("folder", folder)
    .in(
      "uid",
      changes.map((change) => change.uid),
    );
  if (error) throw new Error(error.message);
  const byUid = new Map(changes.map((change) => [change.uid, change.seen]));
  const touched = new Set<string>();
  for (const row of data ?? []) {
    const seen = byUid.get(row.uid);
    if (seen === undefined || seen === row.is_seen) continue;
    const { error: updateError } = await admin
      .from("email_messages")
      .update({ is_seen: seen, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (updateError) throw new Error(updateError.message);
    touched.add(row.thread_id);
  }
  for (const threadId of touched) await refreshThread(threadId);
}

export async function refreshThread(threadId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_messages")
    .select(
      "id, folder, uid, is_seen, sent_at, body_text, subject, from_address, to_addresses, cc_addresses",
    )
    .eq("thread_id", threadId)
    .order("sent_at");
  if (error) throw new Error(error.message);
  const messages = (data ?? []) as MessageRow[];
  if (!messages.length) return;
  const latest = messages[messages.length - 1];
  const participants = uniqueAddresses(
    messages.flatMap((message) => [message.from_address, ...message.to_addresses, ...message.cc_addresses]),
  );
  const folder = messages.some((message) => message.folder === "inbox")
    ? "inbox"
    : (latest.folder as MailFolder);
  const { error: updateError } = await admin
    .from("email_threads")
    .update({
      subject: messages.find((message) => message.subject)?.subject ?? latest.subject,
      snippet: snippetOf(latest.body_text),
      participants,
      last_message_at: latest.sent_at,
      message_count: messages.length,
      is_unread: messages.some((message) => !message.is_seen),
      folder,
      updated_at: new Date().toISOString(),
    })
    .eq("id", threadId);
  if (updateError) throw new Error(updateError.message);
}

async function autoLinkThread(
  account: LoadedAccount,
  threadId: string,
  participants: { address: string }[],
  personId: string | null,
  dealId: string | null,
) {
  if (personId && dealId) return;
  const admin = createAdminClient();
  const own = normalizeEmail(account.email);
  let nextPerson = personId;
  if (!nextPerson) {
    for (const participant of participants) {
      if (!participant.address || participant.address === own) continue;
      const { data } = await admin
        .from("crm_persons")
        .select("id")
        .eq("owner_id", account.ownerId)
        .contains("emails", [{ value: participant.address }])
        .limit(1)
        .maybeSingle();
      if (data?.id) {
        nextPerson = data.id;
        break;
      }
    }
  }
  let nextDeal = dealId;
  if (nextPerson && !nextDeal) {
    const { data } = await admin
      .from("crm_deals")
      .select("id")
      .eq("owner_id", account.ownerId)
      .eq("person_id", nextPerson)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    nextDeal = data?.id ?? null;
  }
  if (nextPerson === personId && nextDeal === dealId) return;
  const { error } = await admin
    .from("email_threads")
    .update({
      person_id: nextPerson,
      deal_id: nextDeal,
      updated_at: new Date().toISOString(),
    })
    .eq("id", threadId)
    .eq("owner_id", account.ownerId);
  if (error) throw new Error(error.message);
}

export type { SyncState };
