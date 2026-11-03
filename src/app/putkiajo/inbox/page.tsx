import { redirect } from "next/navigation";
import { InboxView } from "@/components/putkiajo/inbox-view";
import { createClient } from "@/lib/supabase/server";
import type { Deal, EmailThread, MailAccount, Organization, Person } from "@/lib/crm";

export default async function InboxPage({ searchParams }: PageProps<"/putkiajo/inbox">) {
  const { thread: threadId } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/auth");

  const [accounts, threads, persons, organizations, deals] = await Promise.all([
    supabase.from("mail_accounts").select("*").order("created_at"),
    supabase.from("email_threads").select("*").order("last_message_at", { ascending: false }).limit(300),
    supabase.from("crm_persons").select("*").order("name"),
    supabase.from("crm_organizations").select("*").order("name"),
    supabase.from("crm_deals").select("id, title, person_id, organization_id, status").order("created_at", {
      ascending: false,
    }),
  ]);
  const error = accounts.error ?? threads.error ?? persons.error ?? organizations.error ?? deals.error;
  if (error) throw new Error(error.message);

  return (
    <InboxView
      ownerId={auth.user.id}
      initialAccounts={accounts.data as MailAccount[]}
      initialThreads={threads.data as EmailThread[]}
      persons={persons.data as Person[]}
      organizations={organizations.data as Organization[]}
      deals={deals.data as Pick<Deal, "id" | "title" | "person_id" | "organization_id" | "status">[]}
      initialThreadId={typeof threadId === "string" ? threadId : null}
    />
  );
}
