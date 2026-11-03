import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function PipelinesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_ensure_default_pipeline");
  if (error || !data) throw new Error(error?.message ?? "Could not load pipelines");
  redirect(`/putkiajo/pipelines/${data}`);
}
