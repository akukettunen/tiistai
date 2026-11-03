import { notFound, redirect } from "next/navigation";
import { PipelineBoard } from "@/components/putkiajo/pipeline-board";
import { createClient } from "@/lib/supabase/server";
import type { Deal, Organization, Person, Pipeline, Stage } from "@/lib/crm";

export default async function PipelinePage({ params }: PageProps<"/putkiajo/pipelines/[pipelineId]">) {
  const { pipelineId } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/auth");

  const [pipelines, stages, deals, persons, organizations] = await Promise.all([
    supabase.from("crm_pipelines").select("*").order("position").order("created_at"),
    supabase.from("crm_stages").select("*").order("position"),
    supabase.from("crm_deals").select("*").eq("pipeline_id", pipelineId).order("position"),
    supabase.from("crm_persons").select("*").order("name"),
    supabase.from("crm_organizations").select("*").order("name"),
  ]);

  if (pipelines.error) throw new Error(pipelines.error.message);
  if (!pipelines.data.some((pipeline) => pipeline.id === pipelineId)) notFound();
  const error = stages.error ?? deals.error ?? persons.error ?? organizations.error;
  if (error) throw new Error(error.message);

  return (
    <PipelineBoard
      key={pipelineId}
      ownerId={auth.user.id}
      pipelineId={pipelineId}
      initialPipelines={pipelines.data as Pipeline[]}
      initialStages={stages.data as Stage[]}
      initialDeals={deals.data as Deal[]}
      initialPersons={persons.data as Person[]}
      initialOrganizations={organizations.data as Organization[]}
    />
  );
}
