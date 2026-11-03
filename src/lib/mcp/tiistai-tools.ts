import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, throwDb } from "@/lib/mcp/result";

const uuid = z.string().uuid();
const itemStatus = z.enum(["todo", "working", "stuck", "done"]);
const itemPriority = z.enum(["low", "medium", "high", "critical"]);

function db() {
  return createAdminClient();
}

async function owned<T = Record<string, unknown>>(ownerId: string, table: string, id: string): Promise<T> {
  const { data, error } = await db().from(table).select("*").eq("id", id).eq("owner_id", ownerId).maybeSingle();
  throwDb(error);
  if (!data) throw new Error(`${table} not found: ${id}`);
  return data as T;
}

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
      description: "Search Tiistai board items by title, board, group, status, or priority.",
      inputSchema: z
        .object({
          query: z.string().default("").describe("Title substring"),
          board_id: uuid.optional(),
          group_id: uuid.optional(),
          status: itemStatus.optional(),
          priority: itemPriority.optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      let q = db()
        .from("items")
        .select("*")
        .eq("owner_id", ownerId)
        .order("updated_at", { ascending: false })
        .limit(input.limit);
      if (input.board_id) q = q.eq("board_id", input.board_id);
      if (input.group_id) q = q.eq("group_id", input.group_id);
      if (input.status) q = q.eq("status", input.status);
      if (input.priority) q = q.eq("priority", input.priority);
      if (input.query.trim()) q = q.ilike("title", `%${input.query.trim()}%`);
      const { data, error } = await q;
      throwDb(error);
      return ok(data ?? []);
    },
  );

  server.registerTool(
    "get_item",
    {
      title: "Get item",
      description: "Fetch one board item by id.",
      inputSchema: z.object({ id: uuid }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => ok(await owned(ownerId, "items", id)),
  );

  server.registerTool(
    "create_item",
    {
      title: "Create item",
      description: "Create a Tiistai board item in a group.",
      inputSchema: z
        .object({
          board_id: uuid,
          group_id: uuid,
          title: z.string().min(1).max(240),
          description: z.string().max(10000).default(""),
          status: itemStatus.default("todo"),
          priority: itemPriority.default("medium"),
          due_date: z.string().date().nullable().optional(),
          column_values: z.record(z.string(), z.unknown()).default({}),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      await owned(ownerId, "boards", input.board_id);
      const group = await owned<{ board_id: string }>(ownerId, "board_groups", input.group_id);
      if (group.board_id !== input.board_id) throw new Error("group_id does not belong to board_id");

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
          status: input.status,
          priority: input.priority,
          due_date: input.due_date ?? null,
          column_values: input.column_values,
          position: (last?.position ?? -1) + 1,
        })
        .select()
        .single();
      throwDb(error);
      return ok(data);
    },
  );

  server.registerTool(
    "update_item",
    {
      title: "Update item",
      description: "Update a board item. Changing group_id moves it within/across groups on the same board.",
      inputSchema: z
        .object({
          id: uuid,
          title: z.string().min(1).max(240).optional(),
          description: z.string().max(10000).optional(),
          status: itemStatus.optional(),
          priority: itemPriority.optional(),
          due_date: z.string().date().nullable().optional(),
          group_id: uuid.optional(),
          column_values: z.record(z.string(), z.unknown()).optional(),
          merge_column_values: z
            .boolean()
            .default(true)
            .describe("If true, merge column_values into existing; if false, replace"),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, merge_column_values, ...patch }) => {
      const item = await owned<{
        board_id: string;
        group_id: string;
        column_values: Record<string, unknown>;
      }>(ownerId, "items", id);

      const values: Record<string, unknown> = {};
      if (patch.title !== undefined) values.title = patch.title.trim();
      if (patch.description !== undefined) values.description = patch.description;
      if (patch.status !== undefined) values.status = patch.status;
      if (patch.priority !== undefined) values.priority = patch.priority;
      if (patch.due_date !== undefined) values.due_date = patch.due_date;
      if (patch.column_values !== undefined) {
        values.column_values = merge_column_values
          ? { ...(item.column_values ?? {}), ...patch.column_values }
          : patch.column_values;
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
      const { data, error } = await db()
        .from("items")
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
}
