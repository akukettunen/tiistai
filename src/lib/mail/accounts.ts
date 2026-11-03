import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/mail/crypto";
import { normalizeMailPassword } from "@/lib/mail/providers";
import type { FolderMap, LoadedAccount, MailConfig, ServerSettings, SyncState } from "@/lib/mail/types";

type SecretRow = {
  account_id: string;
  owner_id: string;
  credentials: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  folders: FolderMap;
  sync_state: SyncState;
};

export function isServerSettings(value: unknown): value is ServerSettings {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.host === "string" &&
    row.host.trim().length > 0 &&
    Number.isInteger(row.port) &&
    (row.port as number) >= 1 &&
    (row.port as number) <= 65535 &&
    typeof row.secure === "boolean"
  );
}

export function parseMailConfig(body: unknown): MailConfig | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  if (typeof row.email !== "string" || typeof row.username !== "string" || typeof row.password !== "string") {
    return null;
  }
  if (!isServerSettings(row.imap) || !isServerSettings(row.smtp)) return null;
  const email = row.email.trim().toLowerCase();
  if (!email.includes("@") || email.length > 320) return null;
  const username = row.username.trim();
  if (!username || !row.password) return null;
  return {
    email,
    username,
    password: normalizeMailPassword(String(row.password), row.imap.host),
    imap: { host: row.imap.host.trim(), port: row.imap.port, secure: row.imap.secure },
    smtp: { host: row.smtp.host.trim(), port: row.smtp.port, secure: row.smtp.secure },
  };
}

function fromSecret(account: {
  id: string;
  owner_id: string;
  email: string;
  display_name: string;
}, secret: SecretRow): LoadedAccount {
  const credentials = JSON.parse(decryptSecret(secret.credentials)) as { username: string; password: string };
  return {
    id: account.id,
    ownerId: account.owner_id,
    email: account.email,
    displayName: account.display_name,
    config: {
      email: account.email,
      username: credentials.username,
      password: credentials.password,
      imap: { host: secret.imap_host, port: secret.imap_port, secure: secret.imap_secure },
      smtp: { host: secret.smtp_host, port: secret.smtp_port, secure: secret.smtp_secure },
    },
    folders: secret.folders ?? { inbox: "INBOX" },
    syncState: secret.sync_state ?? {},
  };
}

export async function loadAccounts(ownerId: string, accountId?: string) {
  const admin = createAdminClient();
  let query = admin.from("mail_accounts").select("*").eq("owner_id", ownerId);
  if (accountId) query = query.eq("id", accountId);
  const { data: accounts, error } = await query;
  if (error) throw new Error(error.message);
  if (!accounts?.length) return [];

  const { data: secrets, error: secretError } = await admin
    .from("mail_account_secrets")
    .select("*")
    .eq("owner_id", ownerId)
    .in(
      "account_id",
      accounts.map((account) => account.id),
    );
  if (secretError) throw new Error(secretError.message);
  const byId = new Map((secrets as SecretRow[]).map((secret) => [secret.account_id, secret]));
  return accounts
    .map((account) => {
      const secret = byId.get(account.id);
      return secret ? fromSecret(account, secret) : null;
    })
    .filter((account): account is LoadedAccount => !!account);
}

export async function setAccountStatus(
  accountId: string,
  ownerId: string,
  status: "ok" | "error" | "syncing",
  extra: { lastError?: string | null; lastSyncedAt?: string | null } = {},
) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("mail_accounts")
    .update({
      status,
      last_error: extra.lastError === undefined ? undefined : extra.lastError,
      last_synced_at: extra.lastSyncedAt === undefined ? undefined : extra.lastSyncedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId)
    .eq("owner_id", ownerId);
  if (error) throw new Error(error.message);
}

export async function saveSyncProgress(
  accountId: string,
  ownerId: string,
  folders: FolderMap,
  syncState: SyncState,
) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("mail_account_secrets")
    .update({
      folders,
      sync_state: syncState,
      updated_at: new Date().toISOString(),
    })
    .eq("account_id", accountId)
    .eq("owner_id", ownerId);
  if (error) throw new Error(error.message);
}

export async function insertAccount(
  ownerId: string,
  config: MailConfig,
  folders: FolderMap,
  displayName: string,
) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mail_accounts")
    .insert({
      owner_id: ownerId,
      email: config.email,
      display_name: displayName,
      status: "ok",
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  const { error: secretError } = await admin.from("mail_account_secrets").insert({
    account_id: data.id,
    owner_id: ownerId,
    credentials: encryptSecret(JSON.stringify({ username: config.username, password: config.password })),
    imap_host: config.imap.host,
    imap_port: config.imap.port,
    imap_secure: config.imap.secure,
    smtp_host: config.smtp.host,
    smtp_port: config.smtp.port,
    smtp_secure: config.smtp.secure,
    folders,
    sync_state: {},
  });
  if (secretError) {
    await admin.from("mail_accounts").delete().eq("id", data.id);
    throw new Error(secretError.message);
  }
  return data;
}

export async function updateAccountSecret(
  accountId: string,
  ownerId: string,
  config: MailConfig,
  folders: FolderMap,
  displayName: string,
) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("mail_accounts")
    .update({
      email: config.email,
      display_name: displayName,
      status: "ok",
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId)
    .eq("owner_id", ownerId);
  if (error) throw new Error(error.message);

  const { error: secretError } = await admin
    .from("mail_account_secrets")
    .update({
      credentials: encryptSecret(JSON.stringify({ username: config.username, password: config.password })),
      imap_host: config.imap.host,
      imap_port: config.imap.port,
      imap_secure: config.imap.secure,
      smtp_host: config.smtp.host,
      smtp_port: config.smtp.port,
      smtp_secure: config.smtp.secure,
      folders,
      sync_state: {},
      updated_at: new Date().toISOString(),
    })
    .eq("account_id", accountId)
    .eq("owner_id", ownerId);
  if (secretError) throw new Error(secretError.message);
}

export async function deleteAccount(accountId: string, ownerId: string) {
  const admin = createAdminClient();
  const { error } = await admin.from("mail_accounts").delete().eq("id", accountId).eq("owner_id", ownerId);
  if (error) throw new Error(error.message);
}
