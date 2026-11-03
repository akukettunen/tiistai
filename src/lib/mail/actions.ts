import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MailFolder } from "@/lib/crm";
import { loadAccounts, saveSyncProgress } from "@/lib/mail/accounts";
import {
  ensureArchiveFolder,
  mailboxUidValidity,
  moveMessages,
  providerMessageId,
  setMessageSeen,
  withImap,
} from "@/lib/mail/imap";
import { refreshThread } from "@/lib/mail/sync";

type StoredMessage = {
  id: string;
  thread_id: string;
  folder: MailFolder;
  uid: number;
  uidvalidity: number;
};

async function loadMessages(ownerId: string, threadIds: string[]) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_messages")
    .select("id, thread_id, folder, uid, uidvalidity, account_id")
    .eq("owner_id", ownerId)
    .in("thread_id", threadIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as (StoredMessage & { account_id: string })[];
}

export async function markThreadsSeen(ownerId: string, threadIds: string[], seen: boolean) {
  const messages = await loadMessages(ownerId, threadIds);
  const byAccount = groupBy(messages, (message) => message.account_id);
  for (const [accountId, rows] of byAccount) {
    const [account] = await loadAccounts(ownerId, accountId);
    if (!account) continue;
    await withImap(account.config, async (client) => {
      const byFolder = groupBy(rows, (row) => row.folder);
      for (const [folder, folderRows] of byFolder) {
        const path = account.folders[folder as MailFolder];
        if (!path) continue;
        await setMessageSeen(
          client,
          path,
          folderRows.map((row) => row.uid),
          seen,
        );
      }
    });
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("email_messages")
    .update({ is_seen: seen, updated_at: new Date().toISOString() })
    .eq("owner_id", ownerId)
    .in("thread_id", threadIds);
  if (error) throw new Error(error.message);
  for (const threadId of threadIds) await refreshThread(threadId);
}

export async function archiveThreads(ownerId: string, threadIds: string[]) {
  const messages = await loadMessages(ownerId, threadIds);
  const byAccount = groupBy(
    messages.filter((message) => message.folder !== "archive"),
    (message) => message.account_id,
  );
  const admin = createAdminClient();

  for (const [accountId, rows] of byAccount) {
    const [account] = await loadAccounts(ownerId, accountId);
    if (!account) continue;
    await withImap(account.config, async (client) => {
      const archivePath = await ensureArchiveFolder(client, account.folders);
      const archiveUidValidity = await mailboxUidValidity(client, archivePath);
      const byFolder = groupBy(rows, (row) => row.folder);
      for (const [folder, folderRows] of byFolder) {
        const path = account.folders[folder as MailFolder];
        if (!path) continue;
        const uidMap = await moveMessages(
          client,
          path,
          archivePath,
          folderRows.map((row) => row.uid),
        );
        for (const row of folderRows) {
          const nextUid = uidMap.get(row.uid) ?? row.uid;
          const { error } = await admin
            .from("email_messages")
            .update({
              folder: "archive",
              uid: nextUid,
              uidvalidity: Number(archiveUidValidity),
              provider_message_id: providerMessageId("archive", archiveUidValidity, nextUid),
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          if (error) throw new Error(error.message);
        }
      }
      await saveSyncProgress(account.id, ownerId, account.folders, account.syncState);
    });
  }

  for (const threadId of threadIds) await refreshThread(threadId);
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(key(item)) ?? [];
    list.push(item);
    map.set(key(item), list);
  }
  return map;
}
