import { redirect } from "next/navigation";
import { QuickAdd } from "@/components/quick-add";
import { createClient } from "@/lib/supabase/server";

export default async function QuickAddPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) redirect("/auth?next=/quick-add");

  const [boards, groups, columns, automations] = await Promise.all([
    supabase
      .from("boards")
      .select("*")
      .is("archived_at", null)
      .order("position")
      .order("created_at"),
    supabase.from("board_groups").select("*").order("position"),
    supabase.from("board_columns").select("*").order("position"),
    supabase
      .from("board_automations")
      .select("*")
      .eq("enabled", true)
      .order("created_at"),
  ]);

  return (
    <QuickAdd
      userId={authData.user.id}
      boards={boards.data ?? []}
      groups={groups.data ?? []}
      columns={columns.data ?? []}
      automations={automations.data ?? []}
      initialError={
        boards.error?.message ??
        groups.error?.message ??
        columns.error?.message ??
        automations.error?.message ??
        null
      }
    />
  );
}
