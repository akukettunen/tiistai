"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CURRENCIES,
  type Deal,
  type Organization,
  type Person,
  type Pipeline,
  type Stage,
} from "@/lib/crm";
import { Button, EntityCombo, Field, Modal, Select, TextInput, type ComboValue } from "./ui";

type SupabaseClient = ReturnType<typeof createClient>;

export async function ensureOrganization(
  supabase: SupabaseClient,
  ownerId: string,
  value: ComboValue,
): Promise<{ id: string | null; created?: Organization }> {
  if (value.id) return { id: value.id };
  const name = value.name.trim();
  if (!name) return { id: null };
  const { data, error } = await supabase
    .from("crm_organizations")
    .insert({ owner_id: ownerId, name })
    .select()
    .single();
  if (error) throw error;
  return { id: data.id, created: data as Organization };
}

export async function ensurePerson(
  supabase: SupabaseClient,
  ownerId: string,
  value: ComboValue,
  organizationId: string | null,
): Promise<{ id: string | null; created?: Person }> {
  if (value.id) return { id: value.id };
  const name = value.name.trim();
  if (!name) return { id: null };
  const { data, error } = await supabase
    .from("crm_persons")
    .insert({ owner_id: ownerId, name, organization_id: organizationId })
    .select()
    .single();
  if (error) throw error;
  return { id: data.id, created: data as Person };
}

export function DealFormModal({
  ownerId,
  pipelines,
  stages,
  persons,
  organizations,
  defaults,
  onClose,
  onCreated,
}: {
  ownerId: string;
  pipelines: Pipeline[];
  stages: Stage[];
  persons: Person[];
  organizations: Organization[];
  defaults: {
    pipelineId: string;
    stageId?: string;
    personId?: string | null;
    organizationId?: string | null;
  };
  onClose: () => void;
  onCreated: (result: { deal: Deal; person?: Person; organization?: Organization }) => void;
}) {
  const supabase = createClient();
  const defaultPerson = persons.find((person) => person.id === defaults.personId);
  const defaultOrg = organizations.find(
    (org) => org.id === (defaults.organizationId ?? defaultPerson?.organization_id),
  );
  const [title, setTitle] = useState("");
  const [person, setPerson] = useState<ComboValue>({
    id: defaultPerson?.id ?? null,
    name: defaultPerson?.name ?? "",
  });
  const [organization, setOrganization] = useState<ComboValue>({
    id: defaultOrg?.id ?? null,
    name: defaultOrg?.name ?? "",
  });
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [pipelineId, setPipelineId] = useState(defaults.pipelineId);
  const pipelineStages = stages
    .filter((stage) => stage.pipeline_id === pipelineId)
    .sort((a, b) => a.position - b.position);
  const [stageId, setStageId] = useState(defaults.stageId ?? pipelineStages[0]?.id ?? "");
  const [closeDate, setCloseDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const dealTitle =
      title.trim() ||
      (organization.name.trim() || person.name.trim()
        ? `${organization.name.trim() || person.name.trim()} deal`
        : "");
    if (!dealTitle) {
      setError("Give the deal a title, person or organization.");
      return;
    }
    if (!stageId) {
      setError("Pick a stage.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const org = await ensureOrganization(supabase, ownerId, organization);
      const per = await ensurePerson(supabase, ownerId, person, org.id);
      const { data: last } = await supabase
        .from("crm_deals")
        .select("position")
        .eq("stage_id", stageId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data, error: insertError } = await supabase
        .from("crm_deals")
        .insert({
          owner_id: ownerId,
          title: dealTitle.slice(0, 240),
          person_id: per.id,
          organization_id: org.id,
          value: Number(value) || 0,
          currency,
          pipeline_id: pipelineId,
          stage_id: stageId,
          expected_close_date: closeDate || null,
          position: (last?.position ?? -1) + 1,
        })
        .select()
        .single();
      if (insertError) throw insertError;
      onCreated({ deal: data as Deal, person: per.created, organization: org.created });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Add deal"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="deal-form" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id="deal-form" onSubmit={submit} className="space-y-4">
        <Field label="Contact person">
          <EntityCombo
            options={persons.map((p) => ({
              id: p.id,
              name: p.name,
              hint: organizations.find((o) => o.id === p.organization_id)?.name,
            }))}
            value={person}
            onChange={(next) => {
              setPerson(next);
              const picked = persons.find((p) => p.id === next.id);
              const org = organizations.find((o) => o.id === picked?.organization_id);
              if (org && !organization.name) setOrganization({ id: org.id, name: org.name });
            }}
            placeholder="Name"
          />
        </Field>
        <Field label="Organization">
          <EntityCombo
            options={organizations.map((o) => ({ id: o.id, name: o.name }))}
            value={organization}
            onChange={setOrganization}
            placeholder="Organization"
          />
        </Field>
        <Field label="Title">
          <TextInput
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={
              organization.name || person.name
                ? `${organization.name || person.name} deal`
                : "Deal title"
            }
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="Value">
            <TextInput
              type="number"
              min={0}
              step="any"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="0"
            />
          </Field>
          <Field label="Currency">
            <Select value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {CURRENCIES.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pipeline">
            <Select
              value={pipelineId}
              onChange={(event) => {
                setPipelineId(event.target.value);
                const first = stages
                  .filter((stage) => stage.pipeline_id === event.target.value)
                  .sort((a, b) => a.position - b.position)[0];
                setStageId(first?.id ?? "");
              }}
            >
              {pipelines.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Expected close date">
            <TextInput
              type="date"
              value={closeDate}
              onChange={(event) => setCloseDate(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Pipeline stage">
          <div className="flex overflow-hidden rounded-lg border border-[#dedde6]">
            {pipelineStages.map((stage, index) => {
              const reached =
                pipelineStages.findIndex((s) => s.id === stageId) >= index;
              return (
                <button
                  key={stage.id}
                  type="button"
                  title={stage.name}
                  onClick={() => setStageId(stage.id)}
                  className={`h-8 flex-1 border-r border-white text-[11px] font-medium last:border-r-0 ${
                    reached ? "bg-[#1f9d55] text-white" : "bg-[#eeeef3] text-[#6b6979]"
                  }`}
                >
                  <span className="block truncate px-1">{stage.name}</span>
                </button>
              );
            })}
          </div>
        </Field>
        {error && <p className="text-sm text-[#d63c41]">{error}</p>}
      </form>
    </Modal>
  );
}
