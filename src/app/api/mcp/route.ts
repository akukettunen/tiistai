import {
  createMcpHandler,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { mcpOwnerId, verifyMcpBearer } from "@/lib/mcp/auth";
import { env, mcpConfig } from "@/lib/mcp/env";
import { createCrmMcpServer } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createMcpHandler(
  (ctx) => {
    const ownerId = ctx.authInfo ? mcpOwnerId(ctx.authInfo) : mcpConfig().ownerId;
    if (!ownerId) throw new Error("MCP_OWNER_ID is not configured");
    return createCrmMcpServer(ownerId);
  },
  { responseMode: "json" },
);

function allowedOrigins() {
  const raw = env("MCP_ALLOWED_ORIGINS");
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function handle(request: Request): Promise<Response> {
  // GET without MCP Accept headers → config probe (no secrets).
  if (request.method === "GET") {
    const accept = request.headers.get("accept") ?? "";
    if (!accept.includes("text/event-stream") && !accept.includes("application/json")) {
      const cfg = mcpConfig();
      return Response.json({
        ok: Boolean(cfg.token && cfg.ownerId && cfg.supabaseSecret),
        has: {
          MCP_TOKEN: Boolean(cfg.token),
          MCP_OWNER_ID: Boolean(cfg.ownerId),
          SUPABASE_SECRET_KEY: Boolean(cfg.supabaseSecret),
          NEXT_PUBLIC_SUPABASE_URL: Boolean(cfg.supabaseUrl),
        },
      });
    }
  }

  const origins = allowedOrigins();
  if (origins.length) {
    const rejected = originValidationResponse(request, origins);
    if (rejected) return rejected;
  }

  const cfg = mcpConfig();
  const configured = Boolean(cfg.token && cfg.ownerId);
  const authInfo = verifyMcpBearer(request);
  if (!authInfo) {
    if (!configured) {
      return Response.json(
        {
          error: {
            code: "MCP_NOT_CONFIGURED",
            message:
              "MCP env missing at runtime. Set MCP_TOKEN and MCP_OWNER_ID in Amplify, then redeploy.",
            has: {
              MCP_TOKEN: Boolean(cfg.token),
              MCP_OWNER_ID: Boolean(cfg.ownerId),
              SUPABASE_SECRET_KEY: Boolean(cfg.supabaseSecret),
            },
          },
        },
        { status: 503 },
      );
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
