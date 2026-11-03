export type Pipeline = {
  id: string;
  owner_id: string;
  name: string;
  position: number;
};

export type Stage = {
  id: string;
  pipeline_id: string;
  owner_id: string;
  name: string;
  position: number;
  probability: number;
  rotting_days: number | null;
};

export type Organization = {
  id: string;
  owner_id: string;
  name: string;
  address: string;
  website: string;
  created_at: string;
};

export type ContactValue = { value: string; label: string; primary: boolean };

export type Person = {
  id: string;
  owner_id: string;
  organization_id: string | null;
  name: string;
  emails: ContactValue[];
  phones: ContactValue[];
  label: string | null;
  created_at: string;
};

export type DealStatus = "open" | "won" | "lost";

export type Deal = {
  id: string;
  owner_id: string;
  pipeline_id: string;
  stage_id: string;
  person_id: string | null;
  organization_id: string | null;
  title: string;
  value: number;
  currency: string;
  status: DealStatus;
  lost_reason: string;
  expected_close_date: string | null;
  won_at: string | null;
  lost_at: string | null;
  stage_changed_at: string;
  position: number;
  created_at: string;
};

export type Note = {
  id: string;
  owner_id: string;
  deal_id: string | null;
  person_id: string | null;
  organization_id: string | null;
  body: string;
  created_at: string;
};

export type EmailThread = {
  id: string;
  account_id: string;
  subject: string;
  snippet: string;
  participants: MailAddress[];
  last_message_at: string;
  message_count: number;
  is_unread: boolean;
  folder: MailFolder;
  deal_id: string | null;
  person_id: string | null;
};

export type MailFolder = "inbox" | "sent" | "archive";
export type MailAddress = { name: string; address: string };

export type MailAccount = {
  id: string;
  email: string;
  display_name: string;
  status: "ok" | "error" | "syncing";
  last_error: string | null;
  last_synced_at: string | null;
};

export type EmailMessage = {
  id: string;
  thread_id: string;
  account_id: string;
  folder: MailFolder;
  message_id_header: string;
  from_address: MailAddress;
  to_addresses: MailAddress[];
  cc_addresses: MailAddress[];
  references: string[];
  subject: string;
  body_html: string | null;
  body_text: string;
  attachments: { filename: string; size: number; contentType: string }[];
  sent_at: string;
  is_outbound: boolean;
  is_seen: boolean;
};

export const CURRENCIES = ["EUR", "USD", "GBP", "SEK", "NOK", "DKK"];

export function formatMoney(value: number, currency = "EUR") {
  try {
    return new Intl.NumberFormat("fi-FI", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${Math.round(value)} ${currency}`;
  }
}

export function sumByCurrency(deals: Pick<Deal, "value" | "currency">[]) {
  const totals = new Map<string, number>();
  for (const deal of deals) {
    totals.set(deal.currency, (totals.get(deal.currency) ?? 0) + Number(deal.value));
  }
  if (totals.size === 0) return formatMoney(0);
  return [...totals].map(([currency, total]) => formatMoney(total, currency)).join(" + ");
}

export function primaryValue(values: ContactValue[]) {
  return (values.find((value) => value.primary) ?? values[0])?.value ?? "";
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function isRotting(deal: Deal, stage: Stage | undefined) {
  return (
    deal.status === "open" &&
    !!stage?.rotting_days &&
    daysSince(deal.stage_changed_at) > stage.rotting_days
  );
}

export function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fi-FI", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

export function formatMailTime(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("fi-FI", {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
