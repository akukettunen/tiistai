import { McpServer } from "@modelcontextprotocol/server";
import { registerCrmTools } from "@/lib/mcp/crm-tools";

export function createCrmMcpServer(ownerId: string) {
  const server = new McpServer({
    name: "tiistai-crm",
    version: "1.0.0",
  });
  registerCrmTools(server, ownerId);
  return server;
}
