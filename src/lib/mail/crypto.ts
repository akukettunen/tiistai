import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function key() {
  const raw = process.env.MAIL_ENCRYPTION_KEY;
  if (!raw) throw new Error("MAIL_ENCRYPTION_KEY is not set");
  const buffer = Buffer.from(raw, "base64");
  if (buffer.length !== 32) throw new Error("MAIL_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return buffer;
}

export function encryptSecret(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, encrypted]).toString("base64")}`;
}

export function decryptSecret(payload: string) {
  const [version, data] = payload.split(":");
  if (version !== VERSION || !data) throw new Error("Unsupported secret format");
  const buffer = Buffer.from(data, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), buffer.subarray(0, 12));
  decipher.setAuthTag(buffer.subarray(12, 28));
  return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString("utf8");
}
