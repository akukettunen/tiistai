import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { fail, ok, throwDb } from "@/lib/mcp/result";
import {
  ITEM_FIELDS,
  applyItemFields,
  db,
  describeItem,
  fetchAll,
  isoDate,
  loadContext,
  owned,
  severityMatches,
  statusMatches,
  uuid,
  type ItemRow,
} from "@/lib/mcp/common";
import { registerPlanningTools } from "@/lib/mcp/planning-tools";
import { weekStart } from "@/lib/planning";

const statusInput = z
  .string()
  .min(1)
  .max(80)
  .describe('Status option id (todo/working/stuck/done), label (e.g. "Working on it"), or state keyword "done" / "in_progress"');
const priorityInput = z
  .string()
  .min(1)
  .max(80)
  .describe("Severity option id or label (low/medium/high/critical)");
const dueDateInput = isoDate.nullable().describe("Due date YYYY-MM-DD (null clears)");
const plannedDayInput = isoDate.nullable().describe("Helsinki date the item is planned for; also sets planned_week");
const plannedWeekInput = isoDate.nullable().describe("Week the item is planned for (any date; normalised to its Monday)");

export function registerTiistaiTools(server: McpServer, ownerId: string) {
  server.registerTool(
    "list_boards",
    {
      title: "List boards",
      description: "List Tiistai boards (optionally include archived).",
      inputSchema: z
        .object({
          include_archived: z.boolean().default(false),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ include_archived }) => {
      let q = db().from("boards").select("*").eq("owner_id", ownerId).order("position").order("created_at");
      if (!include_archived) q = q.is("archived_at", null);
      const { data, error } = await q;
      throwDb(error);
      return ok(data ?? []);
    },
  );

  server.registerTool(
    "get_board",
    {
      title: "Get board",
      description: "Fetch one board with its groups, columns, and items.",
      inputSchema: z.object({ id: uuid }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const board = await owned(ownerId, "boards", id);
      const [groups, columns, items] = await Promise.all([
        db().from("board_groups").select("*").eq("owner_id", ownerId).eq("board_id", id).order("position"),
        db().from("board_columns").select("*").eq("owner_id", ownerId).eq("board_id", id).order("position"),
        db().from("items").select("*").eq("owner_id", ownerId).eq("board_id", id).order("position"),
      ]);
      throwDb(groups.error);
      throwDb(columns.error);
      throwDb(items.error);
      return ok({ board, groups: groups.data, columns: columns.data, items: items.data });
    },
  );

  server.registerTool(
    "list_folders",
    {
      title: "List folders",
      description: "List sidebar folders that group boards and docs.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const { data, error } = await db()
        .from("board_folders")
        .select("*")
        .eq("owner_id", ownerId)
        .order("position");
      throwDb(error);
      return ok(data ?? []);
    },
  );

  server.registerTool(
    "search_items",
    {
      title: "Search items",
      description:
        "Search board items by title, board, group, status, severity, or planning week/day (Helsinki dates). Status and severity are matched per board against its Status / Severity column options (id, label, or \"done\" / \"in_progress\").",
      inputSchema: z
        .object({
          query: z.string().default("").describe("Title substring"),
          board_id: uuid.optional(),
          group_id: uuid.optional(),
          status: statusInput.optional(),
          priority: priorityInput.optional(),
          planned_week: isoDate.optional().describe("Any date in the week (normalised to Monday)"),
          planned_day: isoDate.optional(),
          include_archived_boards: z.boolean().default(false),
          include_archived_items: z.boolean().default(false).describe("Include items that were archived"),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const ctx = await loadContext(ownerId);
      const filterInTs = Boolean(input.status || input.priority || !input.include_archived_boards);
      const build = () => {
        let q = db()
          .from("items")
          .select(ITEM_FIELDS)
          .eq("owner_id", ownerId)
          .order("updated_at", { ascending: false });
        if (!input.include_archived_items) q = q.is("archived_at", null);
        if (input.board_id) q = q.eq("board_id", input.board_id);
        if (input.group_id) q = q.eq("group_id", input.group_id);
        if (input.planned_week) q = q.eq("planned_week", weekStart(input.planned_week));
        if (input.planned_day) q = q.eq("planned_day", input.planned_day);
        if (input.query.trim()) q = q.ilike("title", `%${input.query.trim()}%`);
        return q;
      };
      const rows = filterInTs
        ? await fetchAll<ItemRow>((from, to) => build().range(from, to) as never)
        : await (async () => {
            const { data, error } = await build().limit(input.limit);
            throwDb(error);
            return (data ?? []) as unknown as ItemRow[];
          })();
      const matches = rows.filter((item) => {
        if (!input.include_archived_boards && ctx.boards.get(item.board_id)?.archived_at) return false;
        if (input.status && !statusMatches(item, ctx.columns, input.status)) return false;
        if (input.priority && !severityMatches(item, ctx.columns, input.priority)) return false;
        return true;
      });
      return ok({
        total: matches.length,
        items: matches.slice(0, input.limit).map((item) => describeItem(item, ctx)),
      });
    },
  );

  server.registerTool(
    "get_item",
    {
      title: "Get item",
      description: "Fetch one board item by id, with resolved status, severity, due date and planning fields.",
      inputSchema: z.object({ id: uuid }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const [item, ctx] = await Promise.all([owned<ItemRow>(ownerId, "items", id), loadContext(ownerId)]);
      return ok({
        ...describeItem(item, ctx),
        description: item.description ?? "",
        column_values: item.column_values,
      });
    },
  );

  server.registerTool(
    "create_item",
    {
      title: "Create item",
      description:
        "Create a board item in a group. status / priority / due_date are written to the board's Status / Severity / Due date columns. planned_day / planned_week are Helsinki dates.",
      inputSchema: z
        .object({
          board_id: uuid,
          group_id: uuid,
          title: z.string().min(1).max(240),
          description: z.string().max(10000).default(""),
          status: statusInput.default("todo"),
          priority: priorityInput.optional(),
          due_date: dueDateInput.optional(),
          planned_day: plannedDayInput.optional(),
          planned_week: plannedWeekInput.optional(),
          column_values: z.record(z.string(), z.unknown()).default({}).describe("Raw values keyed by column id"),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      await owned(ownerId, "boards", input.board_id);
      const group = await owned<{ board_id: string }>(ownerId, "board_groups", input.group_id);
      if (group.board_id !== input.board_id) throw new Error("group_id does not belong to board_id");
      const ctx = await loadContext(ownerId);
      const columnValues = applyItemFields(input.board_id, input.column_values, ctx.columns, {
        status: input.status,
        priority: input.priority,
        due_date: input.due_date,
      });

      const { data: last } = await db()
        .from("items")
        .select("position")
        .eq("owner_id", ownerId)
        .eq("group_id", input.group_id)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data, error } = await db()
        .from("items")
        .insert({
          owner_id: ownerId,
          board_id: input.board_id,
          group_id: input.group_id,
          title: input.title.trim(),
          description: input.description,
          column_values: columnValues,
          planned_day: input.planned_day ?? null,
          planned_week: input.planned_week ? weekStart(input.planned_week) : null,
          position: (last?.position ?? -1) + 1,
        })
        .select(ITEM_FIELDS)
        .single();
      throwDb(error);
      return ok(describeItem(data as unknown as ItemRow, ctx));
    },
  );

  server.registerTool(
    "update_item",
    {
      title: "Update item",
      description:
        "Update a board item. status / priority / due_date go to the board's Status / Severity / Due date columns (column_values are merged, other keys kept). planned_day sets planned_week too; clearing planned_day keeps planned_week unless you also clear it. Changing group_id moves it within the same board.",
      inputSchema: z
        .object({
          id: uuid,
          title: z.string().min(1).max(240).optional(),
          description: z.string().max(10000).optional(),
          status: statusInput.nullable().optional(),
          priority: priorityInput.nullable().optional(),
          due_date: dueDateInput.optional(),
          planned_day: plannedDayInput.optional(),
          planned_week: plannedWeekInput.optional(),
          group_id: uuid.optional(),
          archived: z.boolean().optional().describe("true archives the item (hidden from boards, Etusivu and searches), false restores it"),
          column_values: z.record(z.string(), z.unknown()).optional().describe("Raw values keyed by column id"),
          merge_column_values: z
            .boolean()
            .default(true)
            .describe("If true, merge column_values into existing; if false, replace"),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, merge_column_values, ...patch }) => {
      const item = await owned<ItemRow>(ownerId, "items", id);
      const ctx = await loadContext(ownerId);

      const values: Record<string, unknown> = {};
      if (patch.title !== undefined) values.title = patch.title.trim();
      if (patch.archived !== undefined) values.archived_at = patch.archived ? (item.archived_at ?? new Date().toISOString()) : null;
      if (patch.description !== undefined) values.description = patch.description;
      if (patch.planned_day !== undefined) values.planned_day = patch.planned_day;
      if (patch.planned_week !== undefined) {
        values.planned_week = patch.planned_week ? weekStart(patch.planned_week) : null;
      }

      const touchesFields =
        patch.status !== undefined || patch.priority !== undefined || patch.due_date !== undefined;
      if (patch.column_values !== undefined || touchesFields) {
        const base =
          patch.column_values === undefined
            ? (item.column_values ?? {})
            : merge_column_values
              ? { ...(item.column_values ?? {}), ...patch.column_values }
              : patch.column_values;
        values.column_values = applyItemFields(item.board_id, base, ctx.columns, {
          status: patch.status,
          priority: patch.priority,
          due_date: patch.due_date,
        });
      }

      if (patch.group_id !== undefined && patch.group_id !== item.group_id) {
        const group = await owned<{ board_id: string }>(ownerId, "board_groups", patch.group_id);
        if (group.board_id !== item.board_id) throw new Error("group_id must belong to the item's board");
        values.group_id = patch.group_id;
        const { data: last } = await db()
          .from("items")
          .select("position")
          .eq("owner_id", ownerId)
          .eq("group_id", patch.group_id)
          .order("position", { ascending: false })
          .limit(1)
          .maybeSingle();
        values.position = (last?.position ?? -1) + 1;
      }

      if (!Object.keys(values).length) return fail("No fields to update.");
      values.updated_at = new Date().toISOString();
      const { data, error } = await db()
        .from("items")
        .update(values)
        .eq("id", id)
        .eq("owner_id", ownerId)
        .select(ITEM_FIELDS)
        .single();
      throwDb(error);
      return ok(describeItem(data as unknown as ItemRow, ctx));
    },
  );

  server.registerTool(
    "delete_item",
    {
      title: "Delete item",
      description: "Permanently delete a board item. Requires confirm=true.",
      inputSchema: z.object({ id: uuid, confirm: z.literal(true) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      await owned(ownerId, "items", id);
      const { error } = await db().from("items").delete().eq("id", id).eq("owner_id", ownerId);
      throwDb(error);
      return ok({ deleted: id });
    },
  );

  server.registerTool(
    "list_docs",
    {
      title: "List docs",
      description: "List Tiistai docs (optionally include archived).",
      inputSchema: z
        .object({
          include_archived: z.boolean().default(false),
          folder_id: uuid.nullable().optional(),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ include_archived, folder_id }) => {
      let q = db().from("docs").select("id, owner_id, title, color, folder_id, position, archived_at, created_at, updated_at").eq("owner_id", ownerId).order("position").order("created_at");
      if (!include_archived) q = q.is("archived_at", null);
      if (folder_id !== undefined) q = folder_id === null ? q.is("folder_id", null) : q.eq("folder_id", folder_id);
      const { data, error } = await q;
      throwDb(error);
      return ok(data ?? []);
    },
  );

  server.registerTool(
    "get_doc",
    {
      title: "Get doc",
      description: "Fetch one doc including TipTap JSON content.",
      inputSchema: z.object({ id: uuid }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => ok(await owned(ownerId, "docs", id)),
  );

  server.registerTool(
    "create_doc",
    {
      title: "Create doc",
      description: "Create a Tiistai doc. Content is TipTap JSON; omit for an empty doc.",
      inputSchema: z
        .object({
          title: z.string().min(1).max(240),
          color: z.string().max(32).default("#6161ff"),
          folder_id: uuid.nullable().optional(),
          content: z.unknown().optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      if (input.folder_id) await owned(ownerId, "board_folders", input.folder_id);
      const { data: last } = await db()
        .from("docs")
        .select("position")
        .eq("owner_id", ownerId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data, error } = await db()
        .from("docs")
        .insert({
          owner_id: ownerId,
          title: input.title.trim(),
          color: input.color,
          folder_id: input.folder_id ?? null,
          content: input.content ?? { type: "doc", content: [{ type: "paragraph" }] },
          position: (last?.position ?? -1) + 1,
        })
        .select()
        .single();
      throwDb(error);
      return ok(data);
    },
  );

  server.registerTool(
    "update_doc",
    {
      title: "Update doc",
      description: "Update a doc title, color, folder, or TipTap content.",
      inputSchema: z
        .object({
          id: uuid,
          title: z.string().min(1).max(240).optional(),
          color: z.string().max(32).optional(),
          folder_id: uuid.nullable().optional(),
          content: z.unknown().optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, ...patch }) => {
      await owned(ownerId, "docs", id);
      if (patch.folder_id) await owned(ownerId, "board_folders", patch.folder_id);
      const values = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      if (typeof values.title === "string") values.title = values.title.trim();
      if (!Object.keys(values).length) return fail("No fields to update.");
      const { data, error } = await db()
        .from("docs")
        .update(values)
        .eq("id", id)
        .eq("owner_id", ownerId)
        .select()
        .single();
      throwDb(error);
      return ok(data);
    },
  );

  server.registerTool(
    "delete_doc",
    {
      title: "Delete doc",
      description: "Permanently delete a doc. Requires confirm=true.",
      inputSchema: z.object({ id: uuid, confirm: z.literal(true) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      await owned(ownerId, "docs", id);
      const { error } = await db().from("docs").delete().eq("id", id).eq("owner_id", ownerId);
      throwDb(error);
      return ok({ deleted: id });
    },
  );

  registerPlanningTools(server, ownerId);
}
