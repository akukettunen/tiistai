import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { user: null, response: Response.json({ error: "Sign in required." }, { status: 401 }) };
  }
  return { user: data.user, response: null };
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
