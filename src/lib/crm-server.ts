import type { createClient } from "@/lib/supabase/server";
import type { EmailThread } from "@/lib/crm";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Threads explicitly linked to the given people/deals, plus threads where any of the addresses took part. */
export async function findThreads(
  supabase: ServerClient,
  {
    personIds = [],
    dealIds = [],
    emails = [],
  }: { personIds?: string[]; dealIds?: string[]; emails?: string[] },
) {
  const queries = [];
  if (personIds.length)
    queries.push(supabase.from("email_threads").select("*").in("person_id", personIds));
  if (dealIds.length) queries.push(supabase.from("email_threads").select("*").in("deal_id", dealIds));
  for (const email of emails.slice(0, 20)) {
    queries.push(
      supabase.from("email_threads").select("*").contains("participants", [{ address: email }]),
    );
  }
  const results = await Promise.all(queries);
  const byId = new Map<string, EmailThread>();
  for (const result of results) {
    if (result.error) throw new Error(result.error.message);
    for (const thread of result.data as EmailThread[]) byId.set(thread.id, thread);
  }
  return [...byId.values()].sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
}
