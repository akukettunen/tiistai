import "server-only";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type { MailConfig } from "@/lib/mail/types";
import { wrapMessageId } from "@/lib/mail/parse";

export function createTransport(config: MailConfig) {
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.username, pass: config.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });
}

export async function testSmtp(config: MailConfig) {
  const transport = createTransport(config);
  await transport.verify();
  transport.close();
}

export type OutgoingMail = {
  fromName?: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
};

export async function sendMail(config: MailConfig, draft: OutgoingMail) {
  const messageId = `${crypto.randomUUID()}@putkiajo`;
  const mail = {
    from: draft.fromName ? `"${draft.fromName.replace(/"/g, "")}" <${draft.from}>` : draft.from,
    to: draft.to.join(", "),
    cc: draft.cc?.length ? draft.cc.join(", ") : undefined,
    subject: draft.subject,
    text: draft.text,
    html: draft.html,
    messageId: wrapMessageId(messageId),
    inReplyTo: draft.inReplyTo ? wrapMessageId(draft.inReplyTo) : undefined,
    references: draft.references?.length
      ? draft.references.map(wrapMessageId).filter(Boolean).join(" ")
      : undefined,
  };
  const raw = await new MailComposer(mail).compile().build();
  const transport = createTransport(config);
  await transport.sendMail({
    envelope: { from: draft.from, to: [...draft.to, ...(draft.cc ?? [])] },
    raw,
  });
  transport.close();
  return { messageId, raw };
}
