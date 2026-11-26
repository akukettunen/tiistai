import type { PlanningColumn, PlanningItem } from "@/lib/planning";

export type FrontBoard = {
  id: string;
  name: string;
  color: string;
  position: number;
};

export type FrontGroup = {
  id: string;
  board_id: string;
  name: string;
  position: number;
};

export type FrontItem = PlanningItem & { position: number; archived_at: string | null };

export type FrontAutomation = {
  board_id: string;
  trigger_column_id: string;
  trigger_value: string;
  target_group_id: string;
  enabled: boolean;
};

export type FrontPageData = {
  userId: string;
  today: string;
  boards: FrontBoard[];
  groups: FrontGroup[];
  columns: PlanningColumn[];
  items: FrontItem[];
  automations: FrontAutomation[];
  loadError: string | null;
};

export const ITEM_FIELDS =
  "id, board_id, group_id, title, column_values, planned_week, planned_day, completed_at, archived_at, position";

export function isInboxBoard(board: Pick<FrontBoard, "name">) {
  return board.name.trim().toLowerCase() === "inbox";
}

const WEEKDAYS_FI = ["su", "ma", "ti", "ke", "to", "pe", "la"];

/** "ke" for a YYYY-MM-DD date. */
export function weekdayFi(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAYS_FI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "2.12." for a YYYY-MM-DD date. */
export function shortDateFi(date: string) {
  const [, m, d] = date.split("-").map(Number);
  return `${d}.${m}.`;
}
