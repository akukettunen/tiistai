import type { MailAddress, MailFolder } from "@/lib/crm";

export type ServerSettings = { host: string; port: number; secure: boolean };

export type MailConfig = {
  email: string;
  username: string;
  password: string;
  imap: ServerSettings;
  smtp: ServerSettings;
};

/** IMAP paths for each folder kind we sync. */
export type FolderMap = Partial<Record<MailFolder, string>> & { inbox: string };

export type FolderSyncState = {
  uidvalidity: string;
  lastUid: number;
  highestModseq?: string;
};

export type SyncState = Partial<Record<MailFolder, FolderSyncState>>;

export type ParsedMessage = {
  folder: MailFolder;
  uid: number;
  uidvalidity: string;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  html: string | null;
  text: string;
  attachments: { filename: string; size: number; contentType: string }[];
  date: string;
  seen: boolean;
  generatedId?: boolean;
};

export type LoadedAccount = {
  id: string;
  ownerId: string;
  email: string;
  displayName: string;
  config: MailConfig;
  folders: FolderMap;
  syncState: SyncState;
};
