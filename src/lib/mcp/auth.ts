import { createHash, timingSafeEqual } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/server";

function sameToken(a: string, b: string) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Bearer auth for the CRM MCP. Returns null when the endpoint is disabled or the token is wrong. */
export function verifyMcpBearer(request: Request): AuthInfo | null {
  const expected = process.env.MCP_TOKEN?.trim();
  const ownerId = process.env.MCP_OWNER_ID?.trim();
  if (!expected || !ownerId) return null;

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match || !sameToken(match[1], expected)) return null;

  return {
    token: match[1],
    clientId: ownerId,
    scopes: ["crm"],
  };
}

export function mcpOwnerId(authInfo: AuthInfo) {
  return authInfo.clientId;
}
