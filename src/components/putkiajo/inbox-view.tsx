"use client";

import {
  Archive,
  Inbox,
  Link2,
  Mail,
  MailPlus,
  Plus,
  RefreshCw,
  Send,
  Settings,
  UserPlus,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  formatMailTime,
  primaryValue,
  type Deal,
  type EmailMessage,
  type EmailThread,
  type MailAccount,
  type MailFolder,
  type Organization,
  type Person,
} from "@/lib/crm";
import { GOOGLE_WORKSPACE } from "@/lib/mail/providers";
import { PersonFormModal } from "./contact-forms";
import { Button, Field, Modal, Select, TextInput, Toast } from "./ui";

type ConnectKind = "google" | "custom";

type FolderFilter = MailFolder | "deals";
type DealRef = Pick<Deal, "id" | "title" | "person_id" | "organization_id" | "status">;

const FOLDERS: { id: FolderFilter; label: string; icon: typeof Inbox }[] = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "sent", label: "Sent", icon: Send },
  { id: "archive", label: "Archived", icon: Archive },
  { id: "deals", label: "Linked to deals", icon: Link2 },
];

export function InboxView({
  ownerId,
  initialAccounts,
  initialThreads,
  persons,
  organizations,
  deals,
  initialThreadId,
}: {
  ownerId: string;
  initialAccounts: MailAccount[];
  initialThreads: EmailThread[];
  persons: Person[];
  organizations: Organization[];
  deals: DealRef[];
  initialThreadId: string | null;
}) {
  const supabase = createClient();
  const [accounts, setAccounts] = useState(initialAccounts);
  const [threads, setThreads] = useState(initialThreads);
  const [people, setPeople] = useState(persons);
  const [accountId, setAccountId] = useState<string>("all");
  const [folder, setFolder] = useState<FolderFilter>("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(initialThreadId);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [compose, setCompose] = useState<null | { replyTo?: EmailMessage }>(null);
  const [settings, setSettings] = useState(false);
  const [connecting, setConnecting] = useState<ConnectKind | false>(false);
  const [reconnect, setReconnect] = useState<MailAccount | null>(null);
  const [linking, setLinking] = useState(false);
  const [creatingPerson, setCreatingPerson] = useState<{ name: string; email: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const visible = useMemo(() => {
    return threads.filter((thread) => {
      if (accountId !== "all" && thread.account_id !== accountId) return false;
      if (folder === "deals") return !!thread.deal_id;
      return thread.folder === folder;
    });
  }, [threads, accountId, folder]);

  const selected = threads.find((thread) => thread.id === selectedId) ?? null;
  const selectedAccount = accounts.find((account) => account.id === selected?.account_id);

  const loadThread = useCallback(
    async (threadId: string) => {
      setLoadingThread(true);
      const { data, error } = await supabase
        .from("email_messages")
        .select("*")
        .eq("thread_id", threadId)
        .order("sent_at");
      setLoadingThread(false);
      if (error) return setToast(error.message);
      setMessages((data ?? []) as EmailMessage[]);
    },
    [supabase],
  );

  const refreshLocal = useCallback(async () => {
    const [{ data: nextAccounts }, { data: nextThreads }] = await Promise.all([
      supabase.from("mail_accounts").select("*").order("created_at"),
      supabase.from("email_threads").select("*").order("last_message_at", { ascending: false }).limit(300),
    ]);
    if (nextAccounts) setAccounts(nextAccounts as MailAccount[]);
    if (nextThreads) setThreads(nextThreads as EmailThread[]);
  }, [supabase]);

  const runSync = useCallback(
    async (once = false) => {
      if (!accounts.length) return;
      setSyncing(true);
      try {
        let done = false;
        while (!done) {
          const response = await fetch("/api/mail/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(accountId === "all" ? {} : { accountId }),
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? "Sync failed");
          done = once || payload.done;
          await refreshLocal();
          if (once) break;
        }
      } catch (caught) {
        setToast(caught instanceof Error ? caught.message : String(caught));
        await refreshLocal();
      } finally {
        setSyncing(false);
      }
    },
    [accountId, accounts.length, refreshLocal],
  );

  useEffect(() => {
    if (!accounts.length) return;
    void runSync();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void runSync();
    }, 120_000);
    return () => clearInterval(timer);
  }, [accounts.length, runSync]);

  useEffect(() => {
    if (selectedId) void loadThread(selectedId);
    else setMessages([]);
  }, [selectedId, loadThread]);

  useEffect(() => {
    if (selectedId && !visible.some((thread) => thread.id === selectedId)) {
      setSelectedId(visible[0]?.id ?? null);
    }
  }, [visible, selectedId]);

  async function modify(action: "seen" | "unseen" | "archive", threadIds: string[]) {
    const response = await fetch("/api/mail/modify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, threadIds }),
    });
    const payload = await response.json();
    if (!response.ok) return setToast(payload.error ?? "Update failed");
    await refreshLocal();
    if (selectedId) void loadThread(selectedId);
  }

  async function openThread(thread: EmailThread) {
    setSelectedId(thread.id);
    if (thread.is_unread) void modify("seen", [thread.id]);
  }

  const sender = messages.find((message) => !message.is_outbound)?.from_address ?? messages[0]?.from_address;

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-52 shrink-0 flex-col border-r border-[#e5e5ec] bg-white">
        <div className="flex items-center gap-1 border-b border-[#ecebf1] p-3">
          <Button variant="success" className="flex-1" onClick={() => setCompose({})} disabled={!accounts.length}>
            <MailPlus size={15} /> Compose
          </Button>
          <button
            aria-label="Mailbox settings"
            className="rounded-lg p-2 text-[#6b6979] hover:bg-[#f2f2f7]"
            onClick={() => setSettings(true)}
          >
            <Settings size={16} />
          </button>
        </div>
        <select
          aria-label="Account"
          className="mx-3 mt-3 h-9 rounded-lg border border-[#dedde6] bg-white px-2 text-sm"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
        >
          <option value="all">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.display_name || account.email}
              {account.status === "error" ? " (error)" : ""}
            </option>
          ))}
        </select>
        <nav className="mt-3 space-y-0.5 px-2">
          {FOLDERS.map((item) => {
            const Icon = item.icon;
            const count =
              item.id === "deals"
                ? threads.filter((thread) => thread.deal_id && (accountId === "all" || thread.account_id === accountId))
                    .length
                : threads.filter(
                    (thread) =>
                      thread.folder === item.id &&
                      (accountId === "all" || thread.account_id === accountId),
                  ).length;
            return (
              <button
                key={item.id}
                onClick={() => setFolder(item.id)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${
                  folder === item.id ? "bg-[#efeefe] font-medium text-[#5148df]" : "text-[#5f5d6e] hover:bg-[#f4f4f8]"
                }`}
              >
                <Icon size={16} />
                <span className="flex-1">{item.label}</span>
                <span className="text-xs text-[#9997a5]">{count}</span>
              </button>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-[#ecebf1] p-3">
          <Button className="w-full" onClick={() => void runSync()} disabled={syncing || !accounts.length}>
            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing…" : "Refresh"}
          </Button>
          {accounts.some((account) => account.status === "error") && (
            <p className="mt-2 text-xs text-[#d63c41]">
              {accounts.find((account) => account.status === "error")?.last_error}
            </p>
          )}
        </div>
      </aside>

      <section className="flex w-80 shrink-0 flex-col border-r border-[#e5e5ec] bg-white">
        <div className="border-b border-[#ecebf1] px-4 py-3 text-sm font-semibold">
          {FOLDERS.find((item) => item.id === folder)?.label}{" "}
          <span className="font-normal text-[#8b8998]">{visible.length}</span>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {visible.map((thread) => (
            <li key={thread.id}>
              <button
                onClick={() => void openThread(thread)}
                className={`w-full border-b border-[#f0eff4] px-4 py-3 text-left hover:bg-[#fafafd] ${
                  selectedId === thread.id ? "bg-[#f4f3ff]" : ""
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <p className={`min-w-0 flex-1 truncate text-sm ${thread.is_unread ? "font-semibold" : ""}`}>
                    {thread.subject || "(no subject)"}
                  </p>
                  <span className="shrink-0 text-[11px] text-[#8b8998]">{formatMailTime(thread.last_message_at)}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-[#8b8998]">
                  {thread.participants.map((p) => p.name || p.address).filter(Boolean).slice(0, 3).join(", ")}
                </p>
                <p className="mt-0.5 truncate text-xs text-[#a9a7b4]">{thread.snippet}</p>
              </button>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="p-8 text-center text-sm text-[#9997a5]">
              {accounts.length ? "No messages in this folder." : "Connect a mailbox to get started."}
            </li>
          )}
        </ul>
      </section>

      <section className="flex min-w-0 flex-1 flex-col bg-[#f7f7fa]">
        {!accounts.length && (
          <div className="m-auto max-w-sm text-center">
            <Mail size={36} className="mx-auto text-[#c5c3d0]" />
            <h2 className="mt-3 text-lg font-semibold">Connect mailbox</h2>
            <p className="mt-1 text-sm text-[#6b6979]">
              Add a Google Workspace or IMAP/SMTP mailbox to sync mail and link it to deals and contacts.
            </p>
            <div className="mt-4 flex flex-col items-center gap-2">
              <Button variant="primary" onClick={() => setConnecting("google")}>
                Google Workspace
              </Button>
              <Button onClick={() => setConnecting("custom")}>Other IMAP/SMTP</Button>
            </div>
          </div>
        )}
        {accounts.length > 0 && !selected && (
          <p className="m-auto text-sm text-[#9997a5]">Select a conversation.</p>
        )}
        {selected && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-[#e5e5ec] bg-white px-5 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-semibold">{selected.subject || "(no subject)"}</h2>
                <p className="truncate text-xs text-[#8b8998]">
                  {selectedAccount?.email}
                  {selected.person_id && (
                    <>
                      {" · "}
                      <a className="text-[#5148df]" href={`/putkiajo/persons/${selected.person_id}`}>
                        {people.find((person) => person.id === selected.person_id)?.name ?? "Contact"}
                      </a>
                    </>
                  )}
                  {selected.deal_id && (
                    <>
                      {" · "}
                      <a className="text-[#5148df]" href={`/putkiajo/deals/${selected.deal_id}`}>
                        {deals.find((deal) => deal.id === selected.deal_id)?.title ?? "Deal"}
                      </a>
                    </>
                  )}
                </p>
              </div>
              <Button onClick={() => setLinking(true)}>
                <Link2 size={14} /> Link
              </Button>
              {sender && (
                <Button onClick={() => setCreatingPerson({ name: sender.name, email: sender.address })}>
                  <UserPlus size={14} /> Contact
                </Button>
              )}
              <Button onClick={() => void modify(selected.is_unread ? "seen" : "unseen", [selected.id])}>
                {selected.is_unread ? "Mark read" : "Mark unread"}
              </Button>
              <Button onClick={() => void modify("archive", [selected.id])}>
                <Archive size={14} /> Archive
              </Button>
              <Button variant="primary" onClick={() => setCompose({ replyTo: messages[messages.length - 1] })}>
                Reply
              </Button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              {loadingThread && <p className="text-sm text-[#8b8998]">Loading…</p>}
              {messages.map((message) => (
                <article key={message.id} className="rounded-xl border border-[#e3e2e9] bg-white">
                  <header className="flex items-start justify-between gap-3 border-b border-[#f0eff4] px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">
                        {message.from_address.name || message.from_address.address}
                        {message.from_address.name && (
                          <span className="ml-1 font-normal text-[#8b8998]">{message.from_address.address}</span>
                        )}
                      </p>
                      <p className="text-xs text-[#8b8998]">
                        To {message.to_addresses.map((a) => a.name || a.address).join(", ") || "—"}
                      </p>
                    </div>
                    <time className="shrink-0 text-xs text-[#8b8998]">{formatMailTime(message.sent_at)}</time>
                  </header>
                  <div className="p-4">
                    {message.body_html ? (
                      <HtmlFrame html={message.body_html} />
                    ) : (
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-6">{message.body_text}</pre>
                    )}
                    {message.attachments?.length > 0 && (
                      <ul className="mt-4 space-y-1 text-xs text-[#6b6979]">
                        {message.attachments.map((file, index) => (
                          <li key={index}>
                            {file.filename} · {Math.round(file.size / 1024)} KB
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {compose && (
        <ComposeModal
          accounts={accounts}
          defaultAccountId={selected?.account_id ?? (accountId === "all" ? accounts[0]?.id : accountId)}
          replyTo={compose.replyTo}
          onClose={() => setCompose(null)}
          onSent={() => {
            setCompose(null);
            setToast("Message sent");
            void runSync(true);
          }}
        />
      )}
      {(connecting || reconnect) && (
        <ConnectMailboxModal
          initialKind={
            connecting ||
            (reconnect?.email.endsWith("@gmail.com") || reconnect?.email.endsWith("@googlemail.com")
              ? "google"
              : "custom")
          }
          account={reconnect}
          onClose={() => {
            setConnecting(false);
            setReconnect(null);
          }}
          onSaved={async () => {
            setConnecting(false);
            setReconnect(null);
            await refreshLocal();
            void runSync();
          }}
        />
      )}
      {settings && (
        <SettingsModal
          accounts={accounts}
          onClose={() => setSettings(false)}
          onAdd={() => {
            setSettings(false);
            setConnecting("google");
          }}
          onReconnect={(account) => {
            setSettings(false);
            setReconnect(account);
          }}
          onDeleted={async (id) => {
            setAccounts((current) => current.filter((account) => account.id !== id));
            await refreshLocal();
          }}
          onError={setToast}
        />
      )}
      {linking && selected && (
        <LinkModal
          thread={selected}
          persons={people}
          deals={deals}
          onClose={() => setLinking(false)}
          onSaved={(thread) => {
            setThreads((current) => current.map((row) => (row.id === thread.id ? thread : row)));
            setLinking(false);
          }}
          onError={setToast}
        />
      )}
      {creatingPerson && (
        <PersonFormModal
          ownerId={ownerId}
          organizations={organizations}
          defaults={{ name: creatingPerson.name, email: creatingPerson.email }}
          onClose={() => setCreatingPerson(null)}
          onSaved={(person) => {
            setPeople((current) => [...current, person]);
            if (selected) {
              void supabase
                .from("email_threads")
                .update({ person_id: person.id })
                .eq("id", selected.id)
                .then(({ error }) => {
                  if (error) setToast(error.message);
                  else
                    setThreads((current) =>
                      current.map((thread) =>
                        thread.id === selected.id ? { ...thread, person_id: person.id } : thread,
                      ),
                    );
                });
            }
            setCreatingPerson(null);
          }}
        />
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function HtmlFrame({ html }: { html: string }) {
  const srcDoc = `<!doctype html><html><head><base target="_blank" rel="noreferrer"><style>html,body{margin:0;background:transparent;color:#29283a;font:14px/1.55 system-ui,sans-serif}img,video{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
  return (
    <iframe
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      title="Email"
      className="w-full border-0"
      onLoad={(event) => {
        const doc = event.currentTarget.contentDocument;
        if (doc?.documentElement) {
          event.currentTarget.style.height = `${Math.max(doc.documentElement.scrollHeight, 120)}px`;
        }
      }}
    />
  );
}

function ComposeModal({
  accounts,
  defaultAccountId,
  replyTo,
  onClose,
  onSent,
}: {
  accounts: MailAccount[];
  defaultAccountId?: string;
  replyTo?: EmailMessage;
  onClose: () => void;
  onSent: () => void;
}) {
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? "");
  const [to, setTo] = useState(replyTo && !replyTo.is_outbound ? replyTo.from_address.address : "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(
    replyTo ? (replyTo.subject.match(/^re:/i) ? replyTo.subject : `Re: ${replyTo.subject}`) : "",
  );
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const recipients = to.split(/[,;]+/).map((value) => value.trim()).filter(Boolean);
    if (!recipients.length) return setError("Add at least one recipient.");
    setSaving(true);
    setError(null);
    const response = await fetch("/api/mail/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId,
        to: recipients,
        cc: cc.split(/[,;]+/).map((value) => value.trim()).filter(Boolean),
        subject,
        text,
        inReplyTo: replyTo?.message_id_header,
        references: replyTo
          ? [...(replyTo.references ?? []), replyTo.message_id_header].filter(Boolean)
          : undefined,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setSaving(false);
      return setError(payload.error ?? "Send failed");
    }
    onSent();
  }

  return (
    <Modal
      title={replyTo ? "Reply" : "Compose"}
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="compose-form" disabled={saving}>
            {saving ? "Sending…" : "Send"}
          </Button>
        </>
      }
    >
      <form id="compose-form" onSubmit={submit} className="space-y-3">
        <Field label="From">
          <Select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.display_name || account.email}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="To">
          <TextInput value={to} onChange={(event) => setTo(event.target.value)} required />
        </Field>
        <Field label="Cc">
          <TextInput value={cc} onChange={(event) => setCc(event.target.value)} />
        </Field>
        <Field label="Subject">
          <TextInput value={subject} onChange={(event) => setSubject(event.target.value)} required />
        </Field>
        <textarea
          required
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={10}
          className="w-full rounded-lg border border-[#dedde6] px-3 py-2 text-sm outline-none focus:border-[#6c63ff]"
        />
        {error && <p className="text-sm text-[#d63c41]">{error}</p>}
      </form>
    </Modal>
  );
}

function ConnectMailboxModal({
  initialKind,
  account,
  onClose,
  onSaved,
}: {
  initialKind: ConnectKind;
  account?: MailAccount | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<ConnectKind>(initialKind);
  const [email, setEmail] = useState(account?.email ?? "");
  const [displayName, setDisplayName] = useState(account?.display_name ?? "");
  const [username, setUsername] = useState(account?.email ?? "");
  const [password, setPassword] = useState("");
  const [imapHost, setImapHost] = useState(initialKind === "google" ? GOOGLE_WORKSPACE.imap.host : "");
  const [imapPort, setImapPort] = useState(GOOGLE_WORKSPACE.imap.port);
  const [imapSecure, setImapSecure] = useState(true);
  const [smtpHost, setSmtpHost] = useState(initialKind === "google" ? GOOGLE_WORKSPACE.smtp.host : "");
  const [smtpPort, setSmtpPort] = useState(GOOGLE_WORKSPACE.smtp.port);
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyKind(next: ConnectKind) {
    setKind(next);
    if (next === "google") {
      setImapHost(GOOGLE_WORKSPACE.imap.host);
      setImapPort(GOOGLE_WORKSPACE.imap.port);
      setImapSecure(GOOGLE_WORKSPACE.imap.secure);
      setSmtpHost(GOOGLE_WORKSPACE.smtp.host);
      setSmtpPort(GOOGLE_WORKSPACE.smtp.port);
      setSmtpSecure(GOOGLE_WORKSPACE.smtp.secure);
      if (email) setUsername(email);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const response = await fetch("/api/mail/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: account?.id,
        email,
        display_name: displayName,
        username: kind === "google" ? email : username,
        password,
        imap: { host: imapHost, port: imapPort, secure: imapSecure },
        smtp: { host: smtpHost, port: smtpPort, secure: smtpSecure },
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setSaving(false);
      return setError(payload.error ?? "Could not connect");
    }
    onSaved();
  }

  return (
    <Modal
      title={account ? "Reconnect mailbox" : "Connect mailbox"}
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="mailbox-form" disabled={saving}>
            {saving ? "Testing connection…" : "Save"}
          </Button>
        </>
      }
    >
      <form id="mailbox-form" onSubmit={submit} className="space-y-4">
        <div className="flex rounded-lg border border-[#dedde7] p-0.5 text-sm font-medium">
          <button
            type="button"
            className={`flex-1 rounded-md px-3 py-1.5 ${
              kind === "google" ? "bg-[#efeefe] text-[#5148df]" : "text-[#6b6979] hover:text-[#29283a]"
            }`}
            onClick={() => applyKind("google")}
          >
            Google Workspace
          </button>
          <button
            type="button"
            className={`flex-1 rounded-md px-3 py-1.5 ${
              kind === "custom" ? "bg-[#efeefe] text-[#5148df]" : "text-[#6b6979] hover:text-[#29283a]"
            }`}
            onClick={() => applyKind("custom")}
          >
            Other IMAP/SMTP
          </button>
        </div>
        {kind === "google" && (
          <p className="text-xs leading-5 text-[#6b6979]">
            Uses Gmail IMAP/SMTP. Create an{" "}
            <a
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
              rel="noreferrer"
              className="text-[#5148df] hover:underline"
            >
              app password
            </a>{" "}
            (2-step verification must be on) and enable IMAP for the user in the Workspace admin.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <TextInput
              type="email"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (kind === "google") setUsername(event.target.value);
              }}
            />
          </Field>
          <Field label="Display name">
            <TextInput value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </Field>
        </div>
        {kind === "custom" && (
          <Field label="Username">
            <TextInput required value={username} onChange={(event) => setUsername(event.target.value)} />
          </Field>
        )}
        <Field label={kind === "google" ? "App password" : "Password"}>
          <TextInput
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={kind === "google" ? "16-character app password" : undefined}
          />
        </Field>
        {kind === "custom" && (
        <>
        <div className="grid grid-cols-[1fr_100px_110px] gap-3">
          <Field label="IMAP host">
            <TextInput required value={imapHost} onChange={(event) => setImapHost(event.target.value)} />
          </Field>
          <Field label="Port">
            <TextInput
              type="number"
              required
              value={imapPort}
              onChange={(event) => setImapPort(Number(event.target.value))}
            />
          </Field>
          <Field label="TLS">
            <Select value={imapSecure ? "1" : "0"} onChange={(event) => setImapSecure(event.target.value === "1")}>
              <option value="1">TLS</option>
              <option value="0">STARTTLS</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_100px_110px] gap-3">
          <Field label="SMTP host">
            <TextInput required value={smtpHost} onChange={(event) => setSmtpHost(event.target.value)} />
          </Field>
          <Field label="Port">
            <TextInput
              type="number"
              required
              value={smtpPort}
              onChange={(event) => setSmtpPort(Number(event.target.value))}
            />
          </Field>
          <Field label="TLS">
            <Select
              value={smtpSecure ? "1" : "0"}
              onChange={(event) => {
                const secure = event.target.value === "1";
                setSmtpSecure(secure);
                setSmtpPort(secure ? 465 : 587);
              }}
            >
              <option value="1">TLS (465)</option>
              <option value="0">STARTTLS (587)</option>
            </Select>
          </Field>
        </div>
        </>
        )}
        {error && <p className="text-sm text-[#d63c41]">{error}</p>}
      </form>
    </Modal>
  );
}

function SettingsModal({
  accounts,
  onClose,
  onAdd,
  onReconnect,
  onDeleted,
  onError,
}: {
  accounts: MailAccount[];
  onClose: () => void;
  onAdd: () => void;
  onReconnect: (account: MailAccount) => void;
  onDeleted: (id: string) => void;
  onError: (message: string) => void;
}) {
  async function remove(account: MailAccount) {
    if (!confirm(`Remove ${account.email}? Synced mail is deleted.`)) return;
    const response = await fetch(`/api/mail/accounts?id=${account.id}`, { method: "DELETE" });
    const payload = await response.json();
    if (!response.ok) return onError(payload.error ?? "Could not delete");
    onDeleted(account.id);
  }

  return (
    <Modal
      title="Mailboxes"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={onAdd}>
            <Plus size={14} /> Add mailbox
          </Button>
        </>
      }
    >
      <ul className="divide-y divide-[#f0eff4]">
        {accounts.map((account) => (
          <li key={account.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{account.display_name || account.email}</p>
              <p className="truncate text-xs text-[#8b8998]">
                {account.email}
                {account.status === "error" && ` · ${account.last_error}`}
                {account.status === "ok" && account.last_synced_at && " · synced"}
              </p>
            </div>
            {account.status === "error" && (
              <Button onClick={() => onReconnect(account)}>Reconnect</Button>
            )}
            <Button variant="ghost" className="text-[#d63c41]" onClick={() => void remove(account)}>
              Remove
            </Button>
          </li>
        ))}
        {accounts.length === 0 && <li className="py-6 text-center text-sm text-[#9997a5]">No mailboxes yet.</li>}
      </ul>
    </Modal>
  );
}

function LinkModal({
  thread,
  persons,
  deals,
  onClose,
  onSaved,
  onError,
}: {
  thread: EmailThread;
  persons: Person[];
  deals: DealRef[];
  onClose: () => void;
  onSaved: (thread: EmailThread) => void;
  onError: (message: string) => void;
}) {
  const supabase = createClient();
  const [personId, setPersonId] = useState(thread.person_id ?? "");
  const [dealId, setDealId] = useState(thread.deal_id ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const { data, error } = await supabase
      .from("email_threads")
      .update({ person_id: personId || null, deal_id: dealId || null })
      .eq("id", thread.id)
      .select()
      .single();
    if (error) {
      setSaving(false);
      return onError(error.message);
    }
    onSaved(data as EmailThread);
  }

  return (
    <Modal
      title="Link conversation"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Person">
          <Select value={personId} onChange={(event) => setPersonId(event.target.value)}>
            <option value="">None</option>
            {persons.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
                {primaryValue(person.emails) ? ` · ${primaryValue(person.emails)}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Deal">
          <Select value={dealId} onChange={(event) => setDealId(event.target.value)}>
            <option value="">None</option>
            {deals.map((deal) => (
              <option key={deal.id} value={deal.id}>
                {deal.title}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
