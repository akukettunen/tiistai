// Shared planning helpers for the front page, board UI and MCP.
// Isomorphic: safe to import from client components and server code.
//
// Source of truth (see supabase/migrations/20261125124912_front_page_planning.sql):
// - status / severity / due date live in items.column_values[column.id]
// - board_columns.settings.role marks which column is which
// - settings.options[].state marks the "done" and "in_progress" Status options
// - items.completed_at is set by a DB trigger; never write it from app code
// - items.planned_week is derived from planned_day by the same trigger

export const TIME_ZONE = "Europe/Helsinki";
export const WEEK_ITEM_LIMIT = 15;
export const IN_PROGRESS_LIMIT = 3;

export type ColumnRole = "status" | "severity" | "due_date";
export type OptionState = "done" | "in_progress";

export type LabelOption = {
  id: string;
  label: string;
  color: string;
  state?: OptionState;
};

export type ColumnSettings = {
  options?: LabelOption[];
  role?: ColumnRole;
};

export type PlanningColumn = {
  id: string;
  board_id: string;
  title: string;
  type: "label" | "text" | "long_text" | "date" | "checkbox";
  settings: ColumnSettings;
  position: number;
};

export type PlanningItem = {
  id: string;
  board_id: string;
  group_id: string;
  title: string;
  column_values: Record<string, unknown>;
  planned_week: string | null;
  planned_day: string | null;
  completed_at: string | null;
};

// ---------------------------------------------------------------------------
// Columns and status
// ---------------------------------------------------------------------------

export function columnWithRole(
  columns: PlanningColumn[],
  boardId: string,
  role: ColumnRole,
): PlanningColumn | undefined {
  return columns.find((c) => c.board_id === boardId && c.settings?.role === role);
}

export function statusOption(
  item: Pick<PlanningItem, "board_id" | "column_values">,
  columns: PlanningColumn[],
): LabelOption | undefined {
  const column = columnWithRole(columns, item.board_id, "status");
  if (!column) return undefined;
  const value = item.column_values?.[column.id];
  return column.settings.options?.find((o) => o.id === value);
}

/** The selected option of the board's column with `role` (status / severity). */
export function roleOption(
  item: Pick<PlanningItem, "board_id" | "column_values">,
  columns: PlanningColumn[],
  role: "status" | "severity",
): LabelOption | undefined {
  const column = columnWithRole(columns, item.board_id, role);
  if (!column) return undefined;
  const value = item.column_values?.[column.id];
  return column.settings.options?.find((o) => o.id === value);
}

export function isDone(
  item: Pick<PlanningItem, "board_id" | "column_values">,
  columns: PlanningColumn[],
) {
  return statusOption(item, columns)?.state === "done";
}

export function isInProgress(
  item: Pick<PlanningItem, "board_id" | "column_values">,
  columns: PlanningColumn[],
) {
  return statusOption(item, columns)?.state === "in_progress";
}

/** column_values patch that marks an item done (or back to the first non-done option). */
export function doneValuePatch(
  item: Pick<PlanningItem, "board_id" | "column_values">,
  columns: PlanningColumn[],
  done: boolean,
): Record<string, unknown> | null {
  const column = columnWithRole(columns, item.board_id, "status");
  const options = column?.settings.options ?? [];
  const target = done
    ? options.find((o) => o.state === "done")
    : options.find((o) => o.state !== "done" && o.state !== "in_progress") ?? options[0];
  if (!column || !target) return null;
  return { ...item.column_values, [column.id]: target.id };
}

export function dueDate(
  item: Pick<PlanningItem, "board_id" | "column_values">,
  columns: PlanningColumn[],
): string | null {
  const column = columnWithRole(columns, item.board_id, "due_date");
  const value = column ? item.column_values?.[column.id] : null;
  return typeof value === "string" && value ? value : null;
}

// ---------------------------------------------------------------------------
// Dates (all as YYYY-MM-DD strings in Europe/Helsinki)
// ---------------------------------------------------------------------------

/** Today's date in Helsinki as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function parseIso(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatIso(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = parseIso(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatIso(d);
}

/** Monday of the ISO week containing `date`. */
export function weekStart(date: string): string {
  const d = parseIso(date);
  const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return addDays(date, 1 - isoDow);
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function isoWeekNumber(date: string): number {
  const d = parseIso(date);
  const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - isoDow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** UTC instant for a Helsinki wall-clock time, e.g. helsinkiToUtc("2026-12-02", "08:00"). */
export function helsinkiToUtc(date: string, time: string): Date {
  const [h, min] = time.split(":").map(Number);
  const guess = new Date(`${date}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00Z`);
  const offset = helsinkiOffsetMinutes(guess);
  return new Date(guess.getTime() - offset * 60000);
}

/** Helsinki UTC offset in minutes (120 or 180) at the given instant. */
export function helsinkiOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    timeZoneName: "shortOffset",
  }).formatToParts(at);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+2";
  const match = name.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!match) return 120;
  const sign = match[1].startsWith("-") ? -1 : 1;
  return Number(match[1]) * 60 + sign * Number(match[2] ?? 0);
}

/** Helsinki date (YYYY-MM-DD) of a timestamp. */
export function helsinkiDate(at: string | Date): string {
  return todayIso(typeof at === "string" ? new Date(at) : at);
}

/** Helsinki wall-clock "HH:MM" of a timestamp. */
export function helsinkiTime(at: string | Date): string {
  return new Intl.DateTimeFormat("fi-FI", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(typeof at === "string" ? new Date(at) : at)
    .replace(".", ":");
}

/** UTC range [start, end) covering the Helsinki week that starts on `monday`. */
export function weekRangeUtc(monday: string): { start: string; end: string } {
  return {
    start: helsinkiToUtc(monday, "00:00").toISOString(),
    end: helsinkiToUtc(addDays(monday, 7), "00:00").toISOString(),
  };
}

