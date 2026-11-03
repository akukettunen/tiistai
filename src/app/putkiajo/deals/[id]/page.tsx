import { notFound, redirect } from "next/navigation";
import { DealDetail } from "@/components/putkiajo/deal-detail";
import { createClient } from "@/lib/supabase/server";
import type {
  Deal,
  EmailThread,
  Note,
  Organization,
  Person,
  Pipeline,
  Stage,
} from "@/lib/crm";

export default async function DealPage({ params }: PageProps<"/putkiajo/deals/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/auth");

  const { data: deal } = await supabase.from("crm_deals").select("*").eq("id", id).maybeSingle();
  if (!deal) notFound();

  const [pipelines, stages, persons, organizations, notes, threads] = await Promise.all([
    supabase.from("crm_pipelines").select("*").order("position"),
    supabase.from("crm_stages").select("*").order("position"),
    supabase.from("crm_persons").select("*").order("name"),
    supabase.from("crm_organizations").select("*").order("name"),
    supabase.from("crm_notes").select("*").eq("deal_id", id).order("created_at", { ascending: false }),
    supabase
      .from("email_threads")
      .select("*")
      .eq("deal_id", id)
      .order("last_message_at", { ascending: false }),
  ]);
  const error =
    pipelines.error ?? stages.error ?? persons.error ?? organizations.error ?? notes.error ?? threads.error;
  if (error) throw new Error(error.message);

  return (
    <DealDetail
      key={deal.id}
      ownerId={auth.user.id}
      initialDeal={deal as Deal}
      pipelines={pipelines.data as Pipeline[]}
      stages={stages.data as Stage[]}
      initialPersons={persons.data as Person[]}
      initialOrganizations={organizations.data as Organization[]}
      initialNotes={notes.data as Note[]}
      threads={threads.data as EmailThread[]}
    />
  );
}
