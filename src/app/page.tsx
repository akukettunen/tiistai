import { redirect } from "next/navigation";
import { FrontPage } from "@/components/front-page/front-page";
import {
  ITEM_FIELDS,
  type FrontAutomation,
  type FrontBoard,
  type FrontGroup,
  type FrontItem,
} from "@/components/front-page/types";
import { todayIso, type PlanningColumn } from "@/lib/planning";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");

  const [boards, columns, groups, items, automations] = await Promise.all([
    supabase
      .from("boards")
      .select("id, name, color, position")
      .is("archived_at", null)
      .order("position")
      .order("created_at"),
    supabase.from("board_columns").select("*").order("position"),
    supabase.from("board_groups").select("id, board_id, name, position").order("position"),
    // Every item: the kanban's "Kaikki" column lists all open items across boards.
    supabase.from("items").select(ITEM_FIELDS).order("position").range(0, 4999),
    supabase
      .from("board_automations")
      .select("board_id, trigger_column_id, trigger_value, target_group_id, enabled"),
  ]);

  const loadError =
    boards.error?.message ??
    columns.error?.message ??
    groups.error?.message ??
    items.error?.message ??
    automations.error?.message ??
    null;

  return (
    <FrontPage
      data={{
        userId: authData.user.id,
        today: todayIso(),
        boards: (boards.data ?? []) as FrontBoard[],
        groups: (groups.data ?? []) as FrontGroup[],
        columns: (columns.data ?? []) as PlanningColumn[],
        items: (items.data ?? []) as FrontItem[],
        automations: (automations.data ?? []) as FrontAutomation[],
        loadError,
      }}
    />
  );
}
