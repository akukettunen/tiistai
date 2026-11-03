import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { createAdminClient } from "@/lib/supabase/admin";
import { CURRENCIES, normalizeEmail, type ContactValue, type DealStatus } from "@/lib/crm";
import { fail, ok, throwDb } from "@/lib/mcp/result";

const uuid = z.string().uuid();
const contactValue = z.object({
  value: z.string().min(1),
  label: z.string().default("work"),
  primary: z.boolean().default(false),
});

function cleanValues(values: ContactValue[] | undefined, isEmail: boolean): ContactValue[] {
  const cleaned = (values ?? [])
    .map((v) => ({
      value: isEmail ? normalizeEmail(v.value) : v.value.trim(),
      label: v.label || "work",
      primary: !!v.primary,
    }))
    .filter((v) => v.value);
  if (cleaned.length && !cleaned.some((v) => v.primary)) cleaned[0].primary = true;
  return cleaned;
}

function db() {
  return createAdminClient();
}

async function owned<T = Record<string, unknown>>(
  ownerId: string,
  table: string,
  id: string,
): Promise<T> {
  const { data, error } = await db().from(table).select("*").eq("id", id).eq("owner_id", ownerId).maybeSingle();
  throwDb(error);
  if (!data) throw new Error(`${table} not found: ${id}`);
  return data as T;
}

export function registerCrmTools(server: McpServer, ownerId: string) {
  server.registerTool(
    "list_pipelines",
    {
      title: "List pipelines",
      description: "List CRM pipelines for the owner, ordered by position.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const { data, error } = await db()
        .from("crm_pipelines")
        .select("*")
        .eq("owner_id", ownerId)
        .order("position")
        .order("created_at");
      throwDb(error);
      return ok(data ?? []);
    },
  );

  server.registerTool(
    "list_stages",
    {
      title: "List stages",
      description: "List CRM stages, optionally filtered by pipeline_id.",
      inputSchema: z
        .object({
          pipeline_id: uuid.optional().describe("Limit to one pipeline"),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ pipeline_id }) => {
      let query = db().from("crm_stages").select("*").eq("owner_id", ownerId).order("position");
      if (pipeline_id) query = query.eq("pipeline_id", pipeline_id);
      const { data, error } = await query;
      throwDb(error);
      return ok(data ?? []);
    },
  );

  server.registerTool(
    "search_organizations",
    {
      title: "Search organizations",
      description: "Search organizations by name substring (case-insensitive).",
      inputSchema: z
        .object({
          query: z.string().default("").describe("Name substring; empty lists all"),
          limit: z.number().int().min(1).max(100).default(50),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      let q = db()
        .from("crm_organizations")
        .select("*")
        .eq("owner_id", ownerId)
        .order("name")
        .limit(limit);
      if (query.trim()) q = q.ilike("name", `%${query.trim()}%`);
      const { data, error } = await q;
      throwDb(error);
      return ok(data ?? []);
    },
  );

  server.registerTool(
    "get_organization",
    {
      title: "Get organization",
      description: "Fetch one organization by id, with related people, deals, and notes.",
      inputSchema: z.object({ id: uuid }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const organization = await owned(ownerId, "crm_organizations", id);
      const [people, deals, notes] = await Promise.all([
        db().from("crm_persons").select("*").eq("owner_id", ownerId).eq("organization_id", id).order("name"),
        db().from("crm_deals").select("*").eq("owner_id", ownerId).eq("organization_id", id),
        db()
          .from("crm_notes")
          .select("*")
          .eq("owner_id", ownerId)
          .eq("organization_id", id)
          .order("created_at", { ascending: false }),
      ]);
      throwDb(people.error);
      throwDb(deals.error);
      throwDb(notes.error);
      return ok({ organization, people: people.data, deals: deals.data, notes: notes.data });
    },
  );

  server.registerTool(
    "create_organization",
    {
      title: "Create organization",
      description: "Create a CRM organization.",
      inputSchema: z
        .object({
          name: z.string().min(1).max(200),
          address: z.string().max(2000).default(""),
          website: z.string().max(500).default(""),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name, address, website }) => {
      const { data, error } = await db()
        .from("crm_organizations")
        .insert({ owner_id: ownerId, name: name.trim(), address, website })
        .select()
        .single();
      throwDb(error);
      return ok(data);
    },
  );

  server.registerTool(
    "update_organization",
    {
      title: "Update organization",
      description: "Update fields on an organization.",
      inputSchema: z
        .object({
          id: uuid,
          name: z.string().min(1).max(200).optional(),
          address: z.string().max(2000).optional(),
          website: z.string().max(500).optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, ...patch }) => {
      await owned(ownerId, "crm_organizations", id);
      const values = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      );
      if (typeof values.name === "string") values.name = values.name.trim();
      if (!Object.keys(values).length) return fail("No fields to update.");
      const { data, error } = await db()
        .from("crm_organizations")
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
    "delete_organization",
    {
      title: "Delete organization",
      description: "Permanently delete an organization. Requires confirm=true.",
      inputSchema: z.object({ id: uuid, confirm: z.literal(true) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      await owned(ownerId, "crm_organizations", id);
      const { error } = await db().from("crm_organizations").delete().eq("id", id).eq("owner_id", ownerId);
      throwDb(error);
      return ok({ deleted: id });
    },
  );

  server.registerTool(
    "search_people",
    {
      title: "Search people",
      description: "Search people by name substring (case-insensitive).",
      inputSchema: z
        .object({
          query: z.string().default("").describe("Name substring; empty lists all"),
          organization_id: uuid.optional(),
          limit: z.number().int().min(1).max(100).default(50),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, organization_id, limit }) => {
      let q = db().from("crm_persons").select("*").eq("owner_id", ownerId).order("name").limit(limit);
      if (query.trim()) q = q.ilike("name", `%${query.trim()}%`);
      if (organization_id) q = q.eq("organization_id", organization_id);
      const { data, error } = await q;
      throwDb(error);
      return ok(data ?? []);
    },
  );

  server.registerTool(
    "get_person",
    {
      title: "Get person",
      description: "Fetch one person by id, with related deals and notes.",
      inputSchema: z.object({ id: uuid }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const person = await owned(ownerId, "crm_persons", id);
      const [deals, notes] = await Promise.all([
        db().from("crm_deals").select("*").eq("owner_id", ownerId).eq("person_id", id),
        db()
          .from("crm_notes")
          .select("*")
          .eq("owner_id", ownerId)
          .eq("person_id", id)
          .order("created_at", { ascending: false }),
      ]);
      throwDb(deals.error);
      throwDb(notes.error);
      return ok({ person, deals: deals.data, notes: notes.data });
    },
  );

  server.registerTool(
    "create_person",
    {
      title: "Create person",
      description: "Create a CRM person (contact).",
      inputSchema: z
        .object({
          name: z.string().min(1).max(200),
          organization_id: uuid.nullable().optional(),
          emails: z.array(contactValue).default([]),
          phones: z.array(contactValue).default([]),
          label: z.string().max(80).nullable().optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      if (input.organization_id) await owned(ownerId, "crm_organizations", input.organization_id);
      const { data, error } = await db()
        .from("crm_persons")
        .insert({
          owner_id: ownerId,
          name: input.name.trim(),
          organization_id: input.organization_id ?? null,
          emails: cleanValues(input.emails, true),
          phones: cleanValues(input.phones, false),
          label: input.label ?? null,
        })
        .select()
        .single();
      throwDb(error);
      return ok(data);
    },
  );

  server.registerTool(
    "update_person",
    {
      title: "Update person",
      description: "Update fields on a person.",
      inputSchema: z
        .object({
          id: uuid,
          name: z.string().min(1).max(200).optional(),
          organization_id: uuid.nullable().optional(),
          emails: z.array(contactValue).optional(),
          phones: z.array(contactValue).optional(),
          label: z.string().max(80).nullable().optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, ...patch }) => {
      await owned(ownerId, "crm_persons", id);
      if (patch.organization_id) await owned(ownerId, "crm_organizations", patch.organization_id);
      const values: Record<string, unknown> = {};
      if (patch.name !== undefined) values.name = patch.name.trim();
      if (patch.organization_id !== undefined) values.organization_id = patch.organization_id;
      if (patch.emails !== undefined) values.emails = cleanValues(patch.emails, true);
      if (patch.phones !== undefined) values.phones = cleanValues(patch.phones, false);
      if (patch.label !== undefined) values.label = patch.label;
      if (!Object.keys(values).length) return fail("No fields to update.");
      const { data, error } = await db()
        .from("crm_persons")
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
    "delete_person",
    {
      title: "Delete person",
      description: "Permanently delete a person. Requires confirm=true.",
      inputSchema: z.object({ id: uuid, confirm: z.literal(true) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      await owned(ownerId, "crm_persons", id);
      const { error } = await db().from("crm_persons").delete().eq("id", id).eq("owner_id", ownerId);
      throwDb(error);
      return ok({ deleted: id });
    },
  );

  server.registerTool(
    "search_deals",
    {
      title: "Search deals",
      description: "List/filter deals by pipeline, stage, status, person, or organization.",
      inputSchema: z
        .object({
          pipeline_id: uuid.optional(),
          stage_id: uuid.optional(),
          status: z.enum(["open", "won", "lost"]).optional(),
          person_id: uuid.optional(),
          organization_id: uuid.optional(),
          query: z.string().default("").describe("Title substring"),
          limit: z.number().int().min(1).max(100).default(50),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      let q = db().from("crm_deals").select("*").eq("owner_id", ownerId).order("updated_at", { ascending: false }).limit(input.limit);
      if (input.pipeline_id) q = q.eq("pipeline_id", input.pipeline_id);
      if (input.stage_id) q = q.eq("stage_id", input.stage_id);
      if (input.status) q = q.eq("status", input.status);
      if (input.person_id) q = q.eq("person_id", input.person_id);
      if (input.organization_id) q = q.eq("organization_id", input.organization_id);
      if (input.query.trim()) q = q.ilike("title", `%${input.query.trim()}%`);
      const { data, error } = await q;
      throwDb(error);
      return ok(data ?? []);
    },
  );

  server.registerTool(
    "get_deal",
    {
      title: "Get deal",
      description: "Fetch one deal by id, with notes.",
      inputSchema: z.object({ id: uuid }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const deal = await owned(ownerId, "crm_deals", id);
      const { data: notes, error } = await db()
        .from("crm_notes")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("deal_id", id)
        .order("created_at", { ascending: false });
      throwDb(error);
      return ok({ deal, notes });
    },
  );

  server.registerTool(
    "create_deal",
    {
      title: "Create deal",
      description: "Create a deal in a pipeline stage.",
      inputSchema: z
        .object({
          title: z.string().min(1).max(240),
          pipeline_id: uuid,
          stage_id: uuid,
          person_id: uuid.nullable().optional(),
          organization_id: uuid.nullable().optional(),
          value: z.number().min(0).default(0),
          currency: z.enum(CURRENCIES as [string, ...string[]]).default("EUR"),
          expected_close_date: z.string().date().nullable().optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      await owned(ownerId, "crm_pipelines", input.pipeline_id);
      const stage = await owned<{ pipeline_id: string }>(ownerId, "crm_stages", input.stage_id);
      if (stage.pipeline_id !== input.pipeline_id) throw new Error("stage_id does not belong to pipeline_id");
      if (input.person_id) await owned(ownerId, "crm_persons", input.person_id);
      if (input.organization_id) await owned(ownerId, "crm_organizations", input.organization_id);

      const { data: last } = await db()
        .from("crm_deals")
        .select("position")
        .eq("owner_id", ownerId)
        .eq("stage_id", input.stage_id)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data, error } = await db()
        .from("crm_deals")
        .insert({
          owner_id: ownerId,
          title: input.title.trim(),
          pipeline_id: input.pipeline_id,
          stage_id: input.stage_id,
          person_id: input.person_id ?? null,
          organization_id: input.organization_id ?? null,
          value: input.value,
          currency: input.currency,
          expected_close_date: input.expected_close_date ?? null,
          position: (last?.position ?? -1) + 1,
        })
        .select()
        .single();
      throwDb(error);
      return ok(data);
    },
  );

  server.registerTool(
    "update_deal",
    {
      title: "Update deal",
      description:
        "Update a deal. Changing stage_id moves it. Setting status to won/lost stamps won_at/lost_at.",
      inputSchema: z
        .object({
          id: uuid,
          title: z.string().min(1).max(240).optional(),
          pipeline_id: uuid.optional(),
          stage_id: uuid.optional(),
          person_id: uuid.nullable().optional(),
          organization_id: uuid.nullable().optional(),
          value: z.number().min(0).optional(),
          currency: z.enum(CURRENCIES as [string, ...string[]]).optional(),
          status: z.enum(["open", "won", "lost"]).optional(),
          lost_reason: z.string().max(2000).optional(),
          expected_close_date: z.string().date().nullable().optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, ...patch }) => {
      const deal = await owned<{
        pipeline_id: string;
        stage_id: string;
        status: DealStatus;
      }>(ownerId, "crm_deals", id);

      const values: Record<string, unknown> = {};
      if (patch.title !== undefined) values.title = patch.title.trim();
      if (patch.value !== undefined) values.value = patch.value;
      if (patch.currency !== undefined) values.currency = patch.currency;
      if (patch.lost_reason !== undefined) values.lost_reason = patch.lost_reason;
      if (patch.expected_close_date !== undefined) values.expected_close_date = patch.expected_close_date;
      if (patch.person_id !== undefined) {
        if (patch.person_id) await owned(ownerId, "crm_persons", patch.person_id);
        values.person_id = patch.person_id;
      }
      if (patch.organization_id !== undefined) {
        if (patch.organization_id) await owned(ownerId, "crm_organizations", patch.organization_id);
        values.organization_id = patch.organization_id;
      }

      const nextPipeline = patch.pipeline_id ?? deal.pipeline_id;
      const nextStage = patch.stage_id ?? deal.stage_id;
      if (patch.pipeline_id) await owned(ownerId, "crm_pipelines", patch.pipeline_id);
      if (patch.stage_id || patch.pipeline_id) {
        const stage = await owned<{ pipeline_id: string }>(ownerId, "crm_stages", nextStage);
        if (stage.pipeline_id !== nextPipeline) throw new Error("stage_id does not belong to pipeline_id");
        values.pipeline_id = nextPipeline;
        values.stage_id = nextStage;
        if (nextStage !== deal.stage_id) {
          values.stage_changed_at = new Date().toISOString();
          const { data: last } = await db()
            .from("crm_deals")
            .select("position")
            .eq("owner_id", ownerId)
            .eq("stage_id", nextStage)
            .order("position", { ascending: false })
            .limit(1)
            .maybeSingle();
          values.position = (last?.position ?? -1) + 1;
        }
      }

      if (patch.status !== undefined && patch.status !== deal.status) {
        values.status = patch.status;
        if (patch.status === "won") {
          values.won_at = new Date().toISOString();
          values.lost_at = null;
        } else if (patch.status === "lost") {
          values.lost_at = new Date().toISOString();
          values.won_at = null;
        } else {
          values.won_at = null;
          values.lost_at = null;
        }
      }

      if (!Object.keys(values).length) return fail("No fields to update.");
      const { data, error } = await db()
        .from("crm_deals")
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
    "delete_deal",
    {
      title: "Delete deal",
      description: "Permanently delete a deal. Requires confirm=true.",
      inputSchema: z.object({ id: uuid, confirm: z.literal(true) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      await owned(ownerId, "crm_deals", id);
      const { error } = await db().from("crm_deals").delete().eq("id", id).eq("owner_id", ownerId);
      throwDb(error);
      return ok({ deleted: id });
    },
  );

  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description: "List notes for exactly one of deal_id, person_id, or organization_id.",
      inputSchema: z
        .object({
          deal_id: uuid.optional(),
          person_id: uuid.optional(),
          organization_id: uuid.optional(),
          limit: z.number().int().min(1).max(100).default(50),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const targets = [input.deal_id, input.person_id, input.organization_id].filter(Boolean);
      if (targets.length !== 1) {
        return fail("Provide exactly one of deal_id, person_id, or organization_id");
      }
      let q = db()
        .from("crm_notes")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false })
        .limit(input.limit);
      if (input.deal_id) q = q.eq("deal_id", input.deal_id);
      if (input.person_id) q = q.eq("person_id", input.person_id);
      if (input.organization_id) q = q.eq("organization_id", input.organization_id);
      const { data, error } = await q;
      throwDb(error);
      return ok(data ?? []);
    },
  );

  server.registerTool(
    "create_note",
    {
      title: "Create note",
      description: "Add a note on exactly one of deal, person, or organization.",
      inputSchema: z
        .object({
          body: z.string().min(1).max(20000),
          deal_id: uuid.optional(),
          person_id: uuid.optional(),
          organization_id: uuid.optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      const targets = [input.deal_id, input.person_id, input.organization_id].filter(Boolean);
      if (targets.length !== 1) {
        return fail("Provide exactly one of deal_id, person_id, or organization_id");
      }
      if (input.deal_id) await owned(ownerId, "crm_deals", input.deal_id);
      if (input.person_id) await owned(ownerId, "crm_persons", input.person_id);
      if (input.organization_id) await owned(ownerId, "crm_organizations", input.organization_id);
      const { data, error } = await db()
        .from("crm_notes")
        .insert({
          owner_id: ownerId,
          body: input.body.trim(),
          deal_id: input.deal_id ?? null,
          person_id: input.person_id ?? null,
          organization_id: input.organization_id ?? null,
        })
        .select()
        .single();
      throwDb(error);
      return ok(data);
    },
  );

  server.registerTool(
    "delete_note",
    {
      title: "Delete note",
      description: "Permanently delete a note. Requires confirm=true.",
      inputSchema: z.object({ id: uuid, confirm: z.literal(true) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      await owned(ownerId, "crm_notes", id);
      const { error } = await db().from("crm_notes").delete().eq("id", id).eq("owner_id", ownerId);
      throwDb(error);
      return ok({ deleted: id });
    },
  );
}
