import { redirect } from "next/navigation";
import { BoardWorkspace } from "@/components/board-workspace";
import { createClient } from "@/lib/supabase/server";

export default async function BoardPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) redirect("/auth");

  const [boards, groups, columns, items, automations] = await Promise.all([
    supabase.from("boards").select("*").order("created_at"),
    supabase.from("board_groups").select("*").order("position"),
    supabase.from("board_columns").select("*").order("position"),
    supabase.from("items").select("*").order("position"),
    supabase.from("board_automations").select("*").order("created_at"),
  ]);

  const loadError =
    boards.error ??
    groups.error ??
    columns.error ??
    items.error ??
    automations.error ??
    null;

  return (
    <BoardWorkspace
      user={{ id: authData.user.id, email: authData.user.email ?? "" }}
      initialBoards={boards.data ?? []}
      initialGroups={groups.data ?? []}
      initialColumns={columns.data ?? []}
      initialItems={items.data ?? []}
      initialAutomations={automations.data ?? []}
      initialError={loadError?.message ?? null}
    />
  );
}
