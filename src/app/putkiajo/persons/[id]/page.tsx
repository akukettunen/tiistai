import { notFound, redirect } from "next/navigation";
import { PersonDetail } from "@/components/putkiajo/contact-detail";
import { findThreads } from "@/lib/crm-server";
import { createClient } from "@/lib/supabase/server";
import type { Deal, Note, Organization, Person, Pipeline, Stage } from "@/lib/crm";

export default async function PersonPage({ params }: PageProps<"/putkiajo/persons/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/auth");

  const { data: person } = await supabase.from("crm_persons").select("*").eq("id", id).maybeSingle();
  if (!person) notFound();

  const [persons, organizations, pipelines, stages, deals, notes] = await Promise.all([
    supabase.from("crm_persons").select("*").order("name"),
    supabase.from("crm_organizations").select("*").order("name"),
    supabase.from("crm_pipelines").select("*").order("position"),
    supabase.from("crm_stages").select("*").order("position"),
    supabase.from("crm_deals").select("*").eq("person_id", id),
    supabase.from("crm_notes").select("*").eq("person_id", id).order("created_at", { ascending: false }),
  ]);
  const error =
    persons.error ?? organizations.error ?? pipelines.error ?? stages.error ?? deals.error ?? notes.error;
  if (error) throw new Error(error.message);

  const threads = await findThreads(supabase, {
    personIds: [id],
    emails: (person as Person).emails.map((email) => email.value),
  });

  return (
    <PersonDetail
      key={id}
      ownerId={auth.user.id}
      initialPerson={person as Person}
      persons={persons.data as Person[]}
      initialOrganizations={organizations.data as Organization[]}
      pipelines={pipelines.data as Pipeline[]}
      stages={stages.data as Stage[]}
      initialDeals={deals.data as Deal[]}
      notes={notes.data as Note[]}
      threads={threads}
    />
  );
}
