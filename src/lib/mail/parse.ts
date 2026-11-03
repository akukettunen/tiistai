import type { MailAddress } from "@/lib/crm";
import { normalizeEmail } from "@/lib/crm";

export function normalizeMessageId(value: string | undefined | null) {
  return (value ?? "").replace(/[<>\s]/g, "").toLowerCase();
}

export function wrapMessageId(id: string) {
  const clean = normalizeMessageId(id);
  return clean ? `<${clean}>` : "";
}

export function normalizeSubject(value: string) {
  return value
    .trim()
    .replace(/^(?:(?:re|fw|fwd|sv|aw)\s*:\s*)+/i, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function asAddress(value?: { name?: string | null; address?: string | null } | null): MailAddress {
  return { name: value?.name?.trim() ?? "", address: normalizeEmail(value?.address ?? "") };
}

export function uniqueAddresses(addresses: MailAddress[]) {
  const seen = new Set<string>();
  const result: MailAddress[] = [];
  for (const address of addresses) {
    if (!address.address || seen.has(address.address)) continue;
    seen.add(address.address);
    result.push(address);
  }
  return result;
}

export function threadKey(input: {
  references: string[];
  inReplyTo: string | null;
  messageId: string;
  generatedId: boolean;
  subject: string;
  participants: MailAddress[];
}) {
  const root = input.references.map(normalizeMessageId).find(Boolean);
  if (root) return root;
  const parent = normalizeMessageId(input.inReplyTo);
  if (parent) return parent;
  if (!input.generatedId && input.messageId) return input.messageId;
  const people = input.participants
    .map((address) => address.address)
    .filter(Boolean)
    .sort()
    .join(",");
  return `subj:${normalizeSubject(input.subject) || "none"}|p:${people}`;
}

export function snippetOf(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}
