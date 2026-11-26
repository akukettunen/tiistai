import * as z from "zod/v4";
import { createAdminClient } from "@/lib/supabase/admin";
import { throwDb } from "@/lib/mcp/result";
import {
  columnWithRole,
  dueDate,
  isDone,
  statusOption,
  type ColumnRole,
  type LabelOption,
  type PlanningColumn,
} from "@/lib/planning";

export const uuid = z.string().uuid();
export const isoDate = z.string().date();

export function db() {
  return createAdminClient();
}

export async function owned<T = Record<string, unknown>>(ownerId: string, table: string, id: string): Promise<T> {
  const { data, error } = await db().from(table).select("*").eq("id", id).eq("owner_id", ownerId).maybeSingle();
  throwDb(error);
  if (!data) throw new Error(`${table} not found: ${id}`);
  return data as T;
}

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Reads every row of a query in 1000-row pages. `page(from, to)` must apply `.range(from, to)`. */
export async function fetchAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const size = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    throwDb(error);
    rows.push(...(data ?? []));
    if (!data || data.length < size) return rows;
  }
}

// ---------------------------------------------------------------------------
// Board context (columns, board and group names)
// ---------------------------------------------------------------------------

export type BoardRow = { id: string; name: string; archived_at: string | null };
export type GroupRow = { id: string; board_id: string; name: string };

export type PlanningContext = {
  columns: PlanningColumn[];
  boards: Map<string, BoardRow>;
  groups: Map<string, GroupRow>;
};

export async function loadContext(ownerId: string): Promise<PlanningContext> {
  const [columns, boards, groups] = await Promise.all([
    db()
      .from("board_columns")
      .select("id, board_id, title, type, settings, position")
      .eq("owner_id", ownerId)
      .order("position"),
    db().from("boards").select("id, name, archived_at").eq("owner_id", ownerId),
    db().from("board_groups").select("id, board_id, name").eq("owner_id", ownerId),
  ]);
  throwDb(columns.error);
  throwDb(boards.error);
  throwDb(groups.error);
  return {
    columns: ((columns.data ?? []) as PlanningColumn[]).map((c) => ({ ...c, settings: c.settings ?? {} })),
    boards: new Map(((boards.data ?? []) as BoardRow[]).map((b) => [b.id, b])),
    groups: new Map(((groups.data ?? []) as GroupRow[]).map((g) => [g.id, g])),
  };
}

// ---------------------------------------------------------------------------
// Option resolution (status / severity)
// ---------------------------------------------------------------------------

function normalise(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, " ");
}

/**
 * Options of a label column matching `input`, in priority order:
 * exact id, exact label, state keyword ("done" / "in_progress", status only), label substring.
 */
export function matchOptions(column: PlanningColumn, input: string, allowStates: boolean): LabelOption[] {
  const options = column.settings.options ?? [];
  const needle = normalise(input);
  if (!needle) return [];
  const byId = options.filter((o) => o.id.toLowerCase() === input.trim().toLowerCase());
  if (byId.length) return byId;
  const byLabel = options.filter((o) => normalise(o.label) === needle);
  if (byLabel.length) return byLabel;
  if (allowStates) {
    const state = needle === "done" ? "done" : needle === "in progress" || needle === "in_progress" ? "in_progress" : null;
    if (state) {
      const byState = options.filter((o) => o.state === state);
      if (byState.length) return byState;
    }
  }
  return options.filter((o) => normalise(o.label).includes(needle));
}

function roleName(role: ColumnRole) {
  return role === "status" ? "Status" : role === "severity" ? "Severity" : "Due date";
}

/** The single option `input` resolves to on the board's column with `role`; throws with the valid choices otherwise. */
export function resolveOption(
  columns: PlanningColumn[],
  boardId: string,
  role: "status" | "severity",
  input: string,
): { column: PlanningColumn; option: LabelOption } {
  const column = columnWithRole(columns, boardId, role);
  if (!column) throw new Error(`Board ${boardId} has no ${roleName(role)} column.`);
  const matches = matchOptions(column, input, role === "status");
  const choices = (column.settings.options ?? []).map((o) => `${o.id} (${o.label})`).join(", ");
  if (!matches.length) throw new Error(`Unknown ${roleName(role)} "${input}". Options: ${choices}`);
  const states = new Set(matches.map((o) => o.state));
  // A state keyword may match several options; any of them is fine, take the first.
  if (matches.length > 1 && !(states.size === 1 && matches[0].state)) {
    throw new Error(`Ambiguous ${roleName(role)} "${input}". Options: ${choices}`);
  }
  return { column, option: matches[0] };
}

export type ItemFieldPatch = {
  status?: string | null;
  priority?: string | null;
  due_date?: string | null;
};

/** Returns column_values with status / severity / due date written into the board's role columns. */
export function applyItemFields(
  boardId: string,
  columnValues: Record<string, unknown>,
  columns: PlanningColumn[],
  patch: ItemFieldPatch,
): Record<string, unknown> {
  const next = { ...columnValues };
  if (patch.status !== undefined) {
    if (patch.status === null) {
      const column = columnWithRole(columns, boardId, "status");
      if (!column) throw new Error(`Board ${boardId} has no Status column.`);
      next[column.id] = null;
    } else {
      const { column, option } = resolveOption(columns, boardId, "status", patch.status);
      next[column.id] = option.id;
    }
  }
  if (patch.priority !== undefined) {
    if (patch.priority === null) {
      const column = columnWithRole(columns, boardId, "severity");
      if (!column) throw new Error(`Board ${boardId} has no Severity column.`);
      next[column.id] = null;
    } else {
      const { column, option } = resolveOption(columns, boardId, "severity", patch.priority);
      next[column.id] = option.id;
    }
  }
  if (patch.due_date !== undefined) {
    const column = columnWithRole(columns, boardId, "due_date");
    if (!column) throw new Error(`Board ${boardId} has no Due date column.`);
    next[column.id] = patch.due_date;
  }
  return next;
}

/** True when the item's status matches the `status` filter (empty status counts as "todo"). */
export function statusMatches(
  item: { board_id: string; column_values: Record<string, unknown> },
  columns: PlanningColumn[],
  filter: string,
): boolean {
  const column = columnWithRole(columns, item.board_id, "status");
  if (!column) return false;
  const matches = matchOptions(column, filter, true);
  const value = item.column_values?.[column.id];
  if (value === null || value === undefined || value === "") return matches.some((o) => o.id === "todo");
  return matches.some((o) => o.id === value);
}

export function severityMatches(
  item: { board_id: string; column_values: Record<string, unknown> },
  columns: PlanningColumn[],
  filter: string,
): boolean {
  const column = columnWithRole(columns, item.board_id, "severity");
  if (!column) return false;
  const value = item.column_values?.[column.id];
  return matchOptions(column, filter, false).some((o) => o.id === value);
}

export type ItemRow = {
  id: string;
  board_id: string;
  group_id: string;
  title: string;
  description?: string;
  column_values: Record<string, unknown>;
  planned_week: string | null;
  planned_day: string | null;
  completed_at: string | null;
  archived_at?: string | null;
  updated_at?: string;
};

export const ITEM_FIELDS =
  "id, board_id, group_id, title, description, column_values, planned_week, planned_day, completed_at, archived_at, position, created_at, updated_at";

/** Compact, readable view of an item with status / severity / due date resolved. */
export function describeItem(item: ItemRow, ctx: PlanningContext) {
  const status = statusOption(item, ctx.columns);
  const severityColumn = columnWithRole(ctx.columns, item.board_id, "severity");
  const severityValue = severityColumn ? item.column_values?.[severityColumn.id] : null;
  const severity = severityColumn?.settings.options?.find((o) => o.id === severityValue);
  return {
    id: item.id,
    title: item.title,
    board_id: item.board_id,
    board_name: ctx.boards.get(item.board_id)?.name ?? null,
    group_id: item.group_id,
    group_name: ctx.groups.get(item.group_id)?.name ?? null,
    status: status?.label ?? null,
    status_id: status?.id ?? null,
    state: status?.state ?? null,
    done: isDone(item, ctx.columns),
    severity: severity?.label ?? null,
    due_date: dueDate(item, ctx.columns),
    planned_week: item.planned_week,
    planned_day: item.planned_day,
    completed_at: item.completed_at,
    archived_at: item.archived_at ?? null,
    updated_at: item.updated_at,
  };
}
