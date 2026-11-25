import { redirect } from "next/navigation";
import { FrontPage } from "@/components/front-page/front-page";
import { loadWeekItems, loadWeekSchedule } from "@/components/front-page/queries";
import {
  isInboxBoard,
  isProductBoard,
  type FrontBoard,
  type FrontGroup,
} from "@/components/front-page/types";
import { isDone, isInProgress, todayIso, weekStart, type PlanningColumn } from "@/lib/planning";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");

  const today = todayIso();
  const monday = weekStart(today);

  const [boards, columns, groups, weekItems, schedule, account, statusItems] =
    await Promise.all([
      supabase
        .from("boards")
        .select("id, name, color, position")
        .is("archived_at", null)
        .order("position")
        .order("created_at"),
      supabase.from("board_columns").select("*").order("position"),
      supabase
        .from("board_groups")
        .select("id, board_id, name, position")
        .order("position"),
      loadWeekItems(supabase, monday),
      loadWeekSchedule(supabase, monday),
      supabase.from("calendar_accounts").select("id, status").maybeSingle(),
      // Light-weight pass over every item for the Inbox / in-progress counters.
      supabase.from("items").select("id, board_id, column_values"),
    ]);

  const boardList = (boards.data ?? []) as FrontBoard[];
  const columnList = (columns.data ?? []) as PlanningColumn[];
  const inbox = boardList.find(isInboxBoard);
  const productIds = new Set(boardList.filter(isProductBoard).map((b) => b.id));

  let inboxOpenCount = 0;
  const inProgressByBoard: Record<string, number> = {};
  for (const item of (statusItems.data ?? []) as {
    id: string;
    board_id: string;
    column_values: Record<string, unknown>;
  }[]) {
    if (inbox && item.board_id === inbox.id && !isDone(item, columnList)) {
      inboxOpenCount += 1;
    }
    if (productIds.has(item.board_id) && isInProgress(item, columnList)) {
      inProgressByBoard[item.board_id] = (inProgressByBoard[item.board_id] ?? 0) + 1;
    }
  }

  const loadError =
    boards.error?.message ??
    columns.error?.message ??
    groups.error?.message ??
    weekItems.error ??
    schedule.error ??
    statusItems.error?.message ??
    null;

  return (
    <FrontPage
      data={{
        userId: authData.user.id,
        today,
        boards: boardList,
        groups: (groups.data ?? []) as FrontGroup[],
        columns: columnList,
        items: weekItems.data,
        blocks: schedule.blocks,
        events: schedule.events,
        calendarConnected: Boolean(account.data) && account.data?.status !== "revoked",
        inboxOpenCount,
        inProgressByBoard,
        loadError,
      }}
    />
  );
}
