import { notFound, redirect } from "next/navigation";
import { OrganizationDetail } from "@/components/putkiajo/contact-detail";
import { findThreads } from "@/lib/crm-server";
import { createClient } from "@/lib/supabase/server";
import type { Deal, Note, Organization, Person, Pipeline, Stage } from "@/lib/crm";

export default async function OrganizationPage({
  params,
}: PageProps<"/putkiajo/organizations/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/auth");

  const { data: organization } = await supabase
    .from("crm_organizations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!organization) notFound();

  const [persons, organizations, pipelines, stages, deals, notes] = await Promise.all([
    supabase.from("crm_persons").select("*").order("name"),
    supabase.from("crm_organizations").select("*").order("name"),
    supabase.from("crm_pipelines").select("*").order("position"),
    supabase.from("crm_stages").select("*").order("position"),
    supabase.from("crm_deals").select("*").eq("organization_id", id),
    supabase
      .from("crm_notes")
      .select("*")
      .eq("organization_id", id)
      .order("created_at", { ascending: false }),
  ]);
  const error =
    persons.error ?? organizations.error ?? pipelines.error ?? stages.error ?? deals.error ?? notes.error;
  if (error) throw new Error(error.message);

  const people = (persons.data as Person[]).filter((person) => person.organization_id === id);
  const threads = await findThreads(supabase, {
    personIds: people.map((person) => person.id),
    dealIds: (deals.data as Deal[]).map((deal) => deal.id),
  });

  return (
    <OrganizationDetail
      key={id}
      ownerId={auth.user.id}
      initialOrganization={organization as Organization}
      initialPersons={persons.data as Person[]}
      organizations={organizations.data as Organization[]}
      pipelines={pipelines.data as Pipeline[]}
      stages={stages.data as Stage[]}
      initialDeals={deals.data as Deal[]}
      notes={notes.data as Note[]}
      threads={threads}
    />
  );
}
