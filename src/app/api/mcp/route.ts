import {
  createMcpHandler,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { mcpOwnerId, verifyMcpBearer } from "@/lib/mcp/auth";
import { createCrmMcpServer } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createMcpHandler(
  (ctx) => {
    const ownerId = ctx.authInfo
      ? mcpOwnerId(ctx.authInfo)
      : process.env.MCP_OWNER_ID?.trim();
    if (!ownerId) throw new Error("MCP_OWNER_ID is not configured");
    return createCrmMcpServer(ownerId);
  },
  { responseMode: "json" },
);

function allowedOrigins() {
  const raw = process.env.MCP_ALLOWED_ORIGINS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function handle(request: Request): Promise<Response> {
  const origins = allowedOrigins();
  if (origins.length) {
    const rejected = originValidationResponse(request, origins);
    if (rejected) return rejected;
  }

  const authInfo = verifyMcpBearer(request);
  if (!authInfo) {
    // Missing MCP_TOKEN / MCP_OWNER_ID disables the endpoint instead of failing open.
    const configured = Boolean(process.env.MCP_TOKEN?.trim() && process.env.MCP_OWNER_ID?.trim());
    if (!configured) {
      return new Response("Not Found", { status: 404 });
    }
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid or missing bearer token" } },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="tiistai-crm"' } },
    );
  }

  const response = await handler.fetch(request, { authInfo });
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

export { handle as GET, handle as POST, handle as DELETE };
