import type {
  CalendarEvent,
  PlanningColumn,
  PlanningItem,
  TimeBlock,
  TimeBlockKind,
} from "@/lib/planning";

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

export type FrontItem = PlanningItem & { position: number };

export type FrontPageData = {
  userId: string;
  today: string;
  boards: FrontBoard[];
  groups: FrontGroup[];
  columns: PlanningColumn[];
  items: FrontItem[];
  blocks: TimeBlock[];
  events: CalendarEvent[];
  calendarConnected: boolean;
  inboxOpenCount: number;
  inProgressByBoard: Record<string, number>;
  loadError: string | null;
};

export const ITEM_FIELDS =
  "id, board_id, group_id, title, column_values, planned_week, planned_day, completed_at, position";

export const BLOCK_KIND_LABEL: Record<TimeBlockKind, string> = {
  focus: "Fokus",
  free_coding: "Vapaa koodaus",
  admin: "Admin",
  other: "Muu",
};

export const BLOCK_KIND_STYLE: Record<
  TimeBlockKind,
  { bg: string; border: string; text: string }
> = {
  focus: { bg: "#6c63ff", border: "#5a52e0", text: "#ffffff" },
  free_coding: { bg: "#00a86b", border: "#008a58", text: "#ffffff" },
  admin: { bg: "#f2994a", border: "#d9802f", text: "#ffffff" },
  other: { bg: "#8b8998", border: "#6e6c7d", text: "#ffffff" },
};

export const NON_PRODUCT_BOARDS = new Set(["get-to-do", "inbox"]);

export function isInboxBoard(board: Pick<FrontBoard, "name">) {
  return board.name.trim().toLowerCase() === "inbox";
}

export function isProductBoard(board: Pick<FrontBoard, "name">) {
  return !NON_PRODUCT_BOARDS.has(board.name.trim().toLowerCase());
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

export function formatHours(hours: number) {
  const rounded = Math.round(hours * 10) / 10;
  return `${String(rounded).replace(".", ",")} h`;
}

/** "HH:MM" -> minutes since midnight. */
export function timeToMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number) {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, minutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export type BlockDraft = {
  id?: string;
  title: string;
  kind: TimeBlockKind;
  date: string;
  start: string;
  end: string;
  board_id: string | null;
  item_id: string | null;
  note_before: string;
  note_after: string;
  done_at: string | null;
};
