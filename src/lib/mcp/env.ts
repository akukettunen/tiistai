/** Dynamic lookup so Amplify/Next cannot inline empty values at build time. */
export function env(name: string) {
  return process.env[name]?.trim() || "";
}

export function mcpConfig() {
  return {
    token: env("MCP_TOKEN"),
    ownerId: env("MCP_OWNER_ID"),
    supabaseSecret: env("SUPABASE_SECRET_KEY"),
    supabaseUrl: env("NEXT_PUBLIC_SUPABASE_URL"),
  };
}
