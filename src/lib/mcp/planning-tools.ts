import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { pushBlock, removeBlock } from "@/lib/calendar/blocks";
import { fail, ok, throwDb } from "@/lib/mcp/result";
import {
  ITEM_FIELDS,
  db,
  describeItem,
  fetchAll,
  isoDate,
  loadContext,
  owned,
  parseTimestamp,
  timestampInput,
  uuid,
  type ItemRow,
} from "@/lib/mcp/common";
import {
  IN_PROGRESS_LIMIT,
  WEEK_ITEM_LIMIT,
  addDays,
  blockHours,
  helsinkiDate,
  helsinkiTime,
  helsinkiToUtc,
  isDone,
  isInProgress,
  isoWeekNumber,
  todayIso,
  weekRangeUtc,
  weekStart,
  type CalendarEvent,
  type LabelOption,
  type PlanningColumn,
  type TimeBlock,
} from "@/lib/planning";

const blockKind = z.enum(["focus", "free_coding", "admin", "other"]);
const color = z.string().max(32);
const columnRole = z.enum(["status", "severity", "due_date"]);
const optionState = z.enum(["done", "in_progress"]);

const BLOCK_FIELDS =
  "id, title, kind, starts_at, ends_at, board_id, item_id, note_before, note_after, done_at, sync_status, google_event_id";

type BlockRow = Pick<
  TimeBlock,
  | "id"
  | "title"
  | "kind"
  | "starts_at"
  | "ends_at"
  | "board_id"
  | "item_id"
  | "note_before"
  | "note_after"
  | "done_at"
  | "sync_status"
  | "google_event_id"
>;

function describeBlock(block: BlockRow) {
  return {
    ...block,
    date: helsinkiDate(block.starts_at),
    start: helsinkiTime(block.starts_at),
    end: helsinkiTime(block.ends_at),
    hours: Math.round(blockHours(block) * 100) / 100,
  };
}

function describeEvent(event: Pick<CalendarEvent, "title" | "starts_at" | "ends_at" | "all_day" | "calendar_id">) {
  return {
    title: event.title,
    calendar_id: event.calendar_id,
    all_day: event.all_day,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    start: event.all_day ? null : helsinkiTime(event.starts_at),
    end: event.all_day ? null : helsinkiTime(event.ends_at),
  };
}

/** Time blocks overlapping the UTC range [start, end). */
async function blocksBetween(ownerId: string, start: string, end: string) {
  const { data, error } = await db()
    .from("time_blocks")
    .select(BLOCK_FIELDS)
    .eq("owner_id", ownerId)
    .lt("starts_at", end)
    .gt("ends_at", start)
    .order("starts_at");
  throwDb(error);
  return (data ?? []) as BlockRow[];
}

function dayRangeUtc(date: string) {
  return {
    start: helsinkiToUtc(date, "00:00").toISOString(),
    end: helsinkiToUtc(addDays(date, 1), "00:00").toISOString(),
  };
}

async function syncBlock(ownerId: string, blockId: string) {
  try {
    return await pushBlock(db(), ownerId, blockId);
  } catch (error) {
    return { sync_status: "error" as const, error: error instanceof Error ? error.message : String(error) };
  }
}

async function readBlock(ownerId: string, id: string) {
  const { data, error } = await db()
    .from("time_blocks")
    .select(BLOCK_FIELDS)
    .eq("id", id)
    .eq("owner_id", ownerId)
    .single();
  throwDb(error);
  return describeBlock(data as BlockRow);
}

/** Validates board/item ownership for a block and fills board_id from the item when missing. */
async function blockLinks(ownerId: string, boardId: string | null | undefined, itemId: string | null | undefined) {
  let board = boardId;
  if (itemId) {
    const item = await owned<{ board_id: string }>(ownerId, "items", itemId);
    if (board && board !== item.board_id) throw new Error("item_id does not belong to board_id");
    if (board === undefined) board = item.board_id;
  }
  if (board) await owned(ownerId, "boards", board);
  return { board_id: board, item_id: itemId };
}

/** Moves `id` to `position` among `rows` (sorted by position) and rewrites positions 0..n-1. */
async function reorder(table: string, ownerId: string, rows: { id: string }[], id: string, position: number) {
  const others = rows.filter((r) => r.id !== id);
  const index = Math.max(0, Math.min(position, others.length));
  const ordered = [...others.slice(0, index), { id }, ...others.slice(index)];
  await Promise.all(
    ordered.map(async (row, i) => {
      const { error } = await db().from(table).update({ position: i }).eq("id", row.id).eq("owner_id", ownerId);
      throwDb(error);
    }),
  );
}

export function registerPlanningTools(server: McpServer, ownerId: string) {
  server.registerTool(
    "get_today",
    {
      title: "Get today",
      description:
        "Today's plan (Europe/Helsinki date): items planned for today, left-over undone items (planned earlier this week or for last week), today's time blocks, and cached Google Calendar events.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const today = todayIso();
      const monday = weekStart(today);
      const lastMonday = addDays(monday, -7);
      const range = dayRangeUtc(today);
      const [ctx, planned, leftover, blocks, events] = await Promise.all([
        loadContext(ownerId),
        db().from("items").select(ITEM_FIELDS).eq("owner_id", ownerId).eq("planned_day", today).order("position"),
        db()
          .from("items")
          .select(ITEM_FIELDS)
          .eq("owner_id", ownerId)
          .or(`and(planned_day.gte.${monday},planned_day.lt.${today}),planned_week.eq.${lastMonday}`)
          .order("planned_day", { ascending: true, nullsFirst: false }),
        blocksBetween(ownerId, range.start, range.end),
        db()
          .from("calendar_events_cache")
          .select("title, calendar_id, starts_at, ends_at, all_day")
          .eq("owner_id", ownerId)
          .lt("starts_at", range.end)
          .gt("ends_at", range.start)
          .order("starts_at"),
      ]);
      throwDb(planned.error);
      throwDb(leftover.error);
      throwDb(events.error);
      const plannedItems = (planned.data ?? []) as unknown as ItemRow[];
      const leftoverItems = ((leftover.data ?? []) as unknown as ItemRow[]).filter(
        (item) => !isDone(item, ctx.columns) && item.planned_day !== today,
      );
      return ok({
        date: today,
        week: monday,
        iso_week: isoWeekNumber(today),
        planned: plannedItems.map((item) => describeItem(item, ctx)),
        leftover: leftoverItems.map((item) => describeItem(item, ctx)),
        time_blocks: blocks.map(describeBlock),
        calendar_events: ((events.data ?? []) as CalendarEvent[]).map(describeEvent),
      });
    },
  );

  server.registerTool(
    "get_week",
    {
      title: "Get week",
      description: `Week plan (Europe/Helsinki): items with planned_week = week, time blocks, in-progress counts per active board, free-coding hours (reserved vs done), open Inbox count, and warnings (> ${WEEK_ITEM_LIMIT} planned items, > ${IN_PROGRESS_LIMIT} in progress on a board).`,
      inputSchema: z
        .object({
          week: isoDate.optional().describe("Any date in the week (normalised to Monday); default this week"),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ week }) => {
      const monday = weekStart(week ?? todayIso());
      const range = weekRangeUtc(monday);
      const ctx = await loadContext(ownerId);
      const activeBoards = [...ctx.boards.values()].filter((b) => !b.archived_at);
      const activeIds = activeBoards.map((b) => b.id);

      const [planned, blocks, boardItems] = await Promise.all([
        db().from("items").select(ITEM_FIELDS).eq("owner_id", ownerId).eq("planned_week", monday).order("planned_day"),
        blocksBetween(ownerId, range.start, range.end),
        activeIds.length
          ? fetchAll<Pick<ItemRow, "id" | "board_id" | "column_values">>(
              (from, to) =>
                db()
                  .from("items")
                  .select("id, board_id, column_values")
                  .eq("owner_id", ownerId)
                  .in("board_id", activeIds)
                  .order("id")
                  .range(from, to) as never,
            )
          : Promise.resolve([]),
      ]);
      throwDb(planned.error);

      const items = ((planned.data ?? []) as unknown as ItemRow[]).map((item) => describeItem(item, ctx));
      const boards = activeBoards.map((board) => {
        const onBoard = boardItems.filter((i) => i.board_id === board.id);
        return {
          board_id: board.id,
          board_name: board.name,
          in_progress: onBoard.filter((i) => isInProgress(i, ctx.columns)).length,
          open: onBoard.filter((i) => !isDone(i, ctx.columns)).length,
        };
      });

      const freeCoding = blocks.filter((b) => b.kind === "free_coding");
      const round = (n: number) => Math.round(n * 100) / 100;
      const inbox = boards.find((b) => b.board_name.trim().toLowerCase() === "inbox");

      const warnings: string[] = [];
      if (items.length > WEEK_ITEM_LIMIT) {
        warnings.push(`${items.length} items planned for the week (limit ${WEEK_ITEM_LIMIT}).`);
      }
      for (const b of boards) {
        if (b.in_progress > IN_PROGRESS_LIMIT) {
          warnings.push(`${b.board_name}: ${b.in_progress} items in progress (limit ${IN_PROGRESS_LIMIT}).`);
        }
      }

      return ok({
        week: monday,
        iso_week: isoWeekNumber(monday),
        items,
        items_done: items.filter((i) => i.done).length,
        time_blocks: blocks.map(describeBlock),
        boards: boards.filter((b) => b.in_progress > 0 || b.open > 0),
        free_coding: {
          sessions: freeCoding.length,
          reserved_hours: round(freeCoding.reduce((sum, b) => sum + blockHours(b), 0)),
          done_hours: round(freeCoding.filter((b) => b.done_at).reduce((sum, b) => sum + blockHours(b), 0)),
        },
        inbox_open: inbox?.open ?? null,
        warnings,
      });
    },
  );

  server.registerTool(
    "plan_item",
    {
      title: "Plan item",
      description:
        "Plan an item for a Helsinki date and/or week. planned_day also sets planned_week to that day's Monday; planned_week is normalised to its Monday. null clears (clearing planned_day keeps planned_week unless you clear it too).",
      inputSchema: z
        .object({
          item_id: uuid,
          planned_day: isoDate.nullable().optional(),
          planned_week: isoDate.nullable().optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ item_id, planned_day, planned_week }) => {
      if (planned_day === undefined && planned_week === undefined) return fail("Give planned_day and/or planned_week.");
      await owned(ownerId, "items", item_id);
      const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (planned_day !== undefined) values.planned_day = planned_day;
      if (planned_week !== undefined) values.planned_week = planned_week ? weekStart(planned_week) : null;
      if (planned_day && planned_week && weekStart(planned_day) !== weekStart(planned_week)) {
        return fail(`planned_day ${planned_day} is not in the week of ${weekStart(planned_week)}.`);
      }
      if (planned_day && planned_week === null) {
        return fail("planned_week cannot be cleared while setting planned_day.");
      }
      const { data, error } = await db()
        .from("items")
        .update(values)
        .eq("id", item_id)
        .eq("owner_id", ownerId)
        .select(ITEM_FIELDS)
        .single();
      throwDb(error);
      return ok(describeItem(data as unknown as ItemRow, await loadContext(ownerId)));
    },
  );

  server.registerTool(
    "create_time_block",
    {
      title: "Create time block",
      description:
        "Create a time block (focus / free_coding / admin / other) and push it to the Tiistai Google calendar when connected. Times without an offset are Helsinki local time.",
      inputSchema: z
        .object({
          title: z.string().max(240).default(""),
          kind: blockKind.default("focus"),
          starts_at: timestampInput,
          ends_at: timestampInput,
          board_id: uuid.nullable().optional().describe("Defaults to the item's board when item_id is given"),
          item_id: uuid.nullable().optional(),
          note_before: z.string().max(10000).default(""),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) => {
      const starts = parseTimestamp(input.starts_at, "starts_at");
      const ends = parseTimestamp(input.ends_at, "ends_at");
      if (ends <= starts) return fail("ends_at must be after starts_at.");
      const links = await blockLinks(ownerId, input.board_id, input.item_id);
      const { data, error } = await db()
        .from("time_blocks")
        .insert({
          owner_id: ownerId,
          title: input.title.trim(),
          kind: input.kind,
          starts_at: starts,
          ends_at: ends,
          board_id: links.board_id ?? null,
          item_id: links.item_id ?? null,
          note_before: input.note_before,
        })
        .select("id")
        .single();
      throwDb(error);
      const { id } = data as { id: string };
      const sync = await syncBlock(ownerId, id);
      return ok({ block: await readBlock(ownerId, id), sync });
    },
  );

  server.registerTool(
    "update_time_block",
    {
      title: "Update time block",
      description:
        "Update a time block and re-sync it to Google Calendar. Times without an offset are Helsinki local time. done=true marks it done (sets done_at), done=false clears it.",
      inputSchema: z
        .object({
          block_id: uuid,
          title: z.string().max(240).optional(),
          kind: blockKind.optional(),
          starts_at: timestampInput.optional(),
          ends_at: timestampInput.optional(),
          board_id: uuid.nullable().optional(),
          item_id: uuid.nullable().optional(),
          note_before: z.string().max(10000).optional(),
          note_after: z.string().max(10000).optional(),
          done: z.boolean().optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ block_id, ...patch }) => {
      const block = await owned<TimeBlock>(ownerId, "time_blocks", block_id);
      const values: Record<string, unknown> = {};
      if (patch.title !== undefined) values.title = patch.title.trim();
      if (patch.kind !== undefined) values.kind = patch.kind;
      if (patch.note_before !== undefined) values.note_before = patch.note_before;
      if (patch.note_after !== undefined) values.note_after = patch.note_after;
      if (patch.done !== undefined) values.done_at = patch.done ? (block.done_at ?? new Date().toISOString()) : null;
      if (patch.starts_at !== undefined) values.starts_at = parseTimestamp(patch.starts_at, "starts_at");
      if (patch.ends_at !== undefined) values.ends_at = parseTimestamp(patch.ends_at, "ends_at");
      const starts = new Date((values.starts_at as string | undefined) ?? block.starts_at).getTime();
      const ends = new Date((values.ends_at as string | undefined) ?? block.ends_at).getTime();
      if (ends <= starts) return fail("ends_at must be after starts_at.");
      if (patch.board_id !== undefined || patch.item_id !== undefined) {
        const itemId = patch.item_id !== undefined ? patch.item_id : block.item_id;
        const boardId = patch.board_id !== undefined ? patch.board_id : patch.item_id ? undefined : block.board_id;
        const links = await blockLinks(ownerId, boardId, itemId);
        values.board_id = links.board_id ?? null;
        values.item_id = links.item_id ?? null;
      }
      if (!Object.keys(values).length) return fail("No fields to update.");
      values.updated_at = new Date().toISOString();
      const { error } = await db().from("time_blocks").update(values).eq("id", block_id).eq("owner_id", ownerId);
      throwDb(error);
      const sync = await syncBlock(ownerId, block_id);
      return ok({ block: await readBlock(ownerId, block_id), sync });
    },
  );

  server.registerTool(
    "delete_time_block",
    {
      title: "Delete time block",
      description: "Delete a time block and its Google Calendar event. Requires confirm=true.",
      inputSchema: z.object({ block_id: uuid, confirm: z.literal(true) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ block_id }) => {
      await owned(ownerId, "time_blocks", block_id);
      await removeBlock(db(), ownerId, block_id);
      return ok({ deleted: block_id });
    },
  );

  server.registerTool(
    "create_group",
    {
      title: "Create group",
      description: "Create a group on a board. position is a 0-based index (default: last).",
      inputSchema: z
        .object({
          board_id: uuid,
          name: z.string().min(1).max(80),
          color: color.default("#6161ff"),
          position: z.number().int().min(0).optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      await owned(ownerId, "boards", input.board_id);
      const { data: existing, error: listError } = await db()
        .from("board_groups")
        .select("id, position")
        .eq("owner_id", ownerId)
        .eq("board_id", input.board_id)
        .order("position");
      throwDb(listError);
      const rows = existing ?? [];
      const { data, error } = await db()
        .from("board_groups")
        .insert({
          owner_id: ownerId,
          board_id: input.board_id,
          name: input.name.trim(),
          color: input.color,
          position: (rows.at(-1)?.position ?? -1) + 1,
        })
        .select("id")
        .single();
      throwDb(error);
      const { id } = data as { id: string };
      if (input.position !== undefined && input.position < rows.length) {
        await reorder("board_groups", ownerId, [...rows, { id }], id, input.position);
      }
      return ok(await owned(ownerId, "board_groups", id));
    },
  );

  server.registerTool(
    "update_group",
    {
      title: "Update group",
      description: "Rename, recolor, or move a group (position is a 0-based index among the board's groups).",
      inputSchema: z
        .object({
          group_id: uuid,
          name: z.string().min(1).max(80).optional(),
          color: color.optional(),
          position: z.number().int().min(0).optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ group_id, name, color: groupColor, position }) => {
      const group = await owned<{ board_id: string }>(ownerId, "board_groups", group_id);
      const values: Record<string, unknown> = {};
      if (name !== undefined) values.name = name.trim();
      if (groupColor !== undefined) values.color = groupColor;
      if (!Object.keys(values).length && position === undefined) return fail("No fields to update.");
      if (Object.keys(values).length) {
        values.updated_at = new Date().toISOString();
        const { error } = await db().from("board_groups").update(values).eq("id", group_id).eq("owner_id", ownerId);
        throwDb(error);
      }
      if (position !== undefined) {
        const { data: rows, error } = await db()
          .from("board_groups")
          .select("id")
          .eq("owner_id", ownerId)
          .eq("board_id", group.board_id)
          .order("position");
        throwDb(error);
        await reorder("board_groups", ownerId, rows ?? [], group_id, position);
      }
      return ok(await owned(ownerId, "board_groups", group_id));
    },
  );

  server.registerTool(
    "update_column",
    {
      title: "Update column",
      description:
        "Update a board column: title, label options, and/or role (status / severity / due_date). options replaces the option list: pass an existing id to rename/recolor it (id kept), omit id for a new option (an exact label match reuses that option's id). state (done / in_progress, Status column only) marks which options count as done or in progress; null clears it. Setting role removes that role from the board's other columns; null removes this column's role.",
      inputSchema: z
        .object({
          column_id: uuid,
          title: z.string().min(1).max(80).optional(),
          options: z
            .array(
              z
                .object({
                  id: z.string().min(1).max(80).optional(),
                  label: z.string().min(1).max(80),
                  color: color.optional(),
                  state: optionState.nullable().optional(),
                })
                .strict(),
            )
            .min(1)
            .max(50)
            .optional(),
          role: columnRole.nullable().optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ column_id, title, options, role }) => {
      const column = await owned<PlanningColumn>(ownerId, "board_columns", column_id);
      const settings: Record<string, unknown> = { ...(column.settings ?? {}) };
      const values: Record<string, unknown> = {};
      const notes: string[] = [];
      if (title !== undefined) values.title = title.trim();

      if (options !== undefined) {
        if (column.type !== "label") return fail("options can only be set on label columns.");
        const current = column.settings?.options ?? [];
        const seen = new Set<string>();
        const next: LabelOption[] = options.map((input) => {
          const existing = input.id
            ? current.find((o) => o.id === input.id)
            : current.find((o) => o.label.trim().toLowerCase() === input.label.trim().toLowerCase());
          if (input.id && !existing) throw new Error(`Unknown option id "${input.id}" on column ${column.title}.`);
          const id = existing?.id ?? crypto.randomUUID();
          if (seen.has(id)) throw new Error(`Option "${existing?.label ?? id}" listed twice.`);
          seen.add(id);
          const option: LabelOption = {
            ...existing,
            id,
            label: input.label.trim(),
            color: input.color ?? existing?.color ?? "#c4c4c4",
          };
          if (input.state === null) delete option.state;
          else if (input.state !== undefined) option.state = input.state;
          return option;
        });
        const removed = current.filter((o) => !seen.has(o.id));
        if (removed.length) {
          notes.push(
            `Removed options: ${removed.map((o) => `${o.id} (${o.label})`).join(", ")}. Items still holding these values show no status.`,
          );
        }
        if (current.some((o) => o.state) || next.some((o) => o.state)) {
          notes.push("completed_at is only recomputed when an item's values change.");
        }
        settings.options = next;
      }

      if (role !== undefined) {
        if (role === null) {
          delete settings.role;
        } else {
          const needed = role === "due_date" ? "date" : "label";
          if (column.type !== needed) return fail(`role ${role} needs a ${needed} column (this is ${column.type}).`);
          settings.role = role;
          const { data: siblings, error } = await db()
            .from("board_columns")
            .select("id, settings")
            .eq("owner_id", ownerId)
            .eq("board_id", column.board_id)
            .neq("id", column_id);
          throwDb(error);
          for (const sibling of (siblings ?? []) as Pick<PlanningColumn, "id" | "settings">[]) {
            if (sibling.settings?.role !== role) continue;
            const rest: Record<string, unknown> = { ...sibling.settings };
            delete rest.role;
            const { error: clearError } = await db()
              .from("board_columns")
              .update({ settings: rest, updated_at: new Date().toISOString() })
              .eq("id", sibling.id)
              .eq("owner_id", ownerId);
            throwDb(clearError);
            notes.push(`Cleared role ${role} from column ${sibling.id}.`);
          }
        }
      }

      if (options !== undefined || role !== undefined) values.settings = settings;
      if (!Object.keys(values).length) return fail("No fields to update.");
      values.updated_at = new Date().toISOString();
      const { data, error } = await db()
        .from("board_columns")
        .update(values)
        .eq("id", column_id)
        .eq("owner_id", ownerId)
        .select("*")
        .single();
      throwDb(error);
      return ok({ column: data, notes });
    },
  );
}
