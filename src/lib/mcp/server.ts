import { McpServer } from "@modelcontextprotocol/server";
import { registerTiistaiTools } from "@/lib/mcp/tiistai-tools";

export function createTiistaiMcpServer(ownerId: string) {
  const server = new McpServer({
    name: "tiistai",
    version: "1.0.0",
  });
  registerTiistaiTools(server, ownerId);
  return server;
}

/** @deprecated use createTiistaiMcpServer */
export const createCrmMcpServer = createTiistaiMcpServer;
