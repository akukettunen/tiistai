"use client";

import { ArrowLeft, Building2, RotateCcw, Trash2, Trophy, User, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CURRENCIES,
  daysSince,
  formatDate,
  formatMoney,
  type Deal,
  type EmailThread,
  type Note,
  type Organization,
  type Person,
  type Pipeline,
  type Stage,
} from "@/lib/crm";
import { ensureOrganization, ensurePerson } from "./deal-form";
import { LostReasonModal } from "./pipeline-board";
import { NotesPanel, ThreadList } from "./timeline";
import { Button, EntityCombo, Field, Select, TextInput, Toast, type ComboValue } from "./ui";

export function DealDetail({
  ownerId,
  initialDeal,
  pipelines,
  stages,
  initialPersons,
  initialOrganizations,
  initialNotes,
  threads,
}: {
  ownerId: string;
  initialDeal: Deal;
  pipelines: Pipeline[];
  stages: Stage[];
  initialPersons: Person[];
  initialOrganizations: Organization[];
  initialNotes: Note[];
  threads: EmailThread[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [deal, setDeal] = useState(initialDeal);
  const [persons, setPersons] = useState(initialPersons);
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [title, setTitle] = useState(initialDeal.title);
  const [value, setValue] = useState(String(initialDeal.value));
  const [askLost, setAskLost] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const person = persons.find((p) => p.id === deal.person_id);
  const organization = organizations.find((o) => o.id === deal.organization_id);
  const [personValue, setPersonValue] = useState<ComboValue>({
    id: person?.id ?? null,
    name: person?.name ?? "",
  });
  const [orgValue, setOrgValue] = useState<ComboValue>({
    id: organization?.id ?? null,
    name: organization?.name ?? "",
  });

  const pipelineStages = stages
    .filter((stage) => stage.pipeline_id === deal.pipeline_id)
    .sort((a, b) => a.position - b.position);
  const currentIndex = pipelineStages.findIndex((stage) => stage.id === deal.stage_id);

  async function patch(changes: Partial<Deal>) {
    const previous = deal;
    setDeal((current) => ({ ...current, ...changes }));
    const { error } = await supabase.from("crm_deals").update(changes).eq("id", deal.id);
    if (error) {
      setDeal(previous);
      setToast(error.message);
    }
  }

  function setStatus(status: Deal["status"], lostReason = "") {
    const now = new Date().toISOString();
    void patch({
      status,
      won_at: status === "won" ? now : null,
      lost_at: status === "lost" ? now : null,
      lost_reason: status === "lost" ? lostReason : "",
    });
  }

  async function savePerson(next: ComboValue) {
    try {
      const result = await ensurePerson(supabase, ownerId, next, deal.organization_id);
      if (result.created) setPersons((current) => [...current, result.created!]);
      setPersonValue({ id: result.id, name: result.created?.name ?? next.name });
      if (result.id !== deal.person_id) await patch({ person_id: result.id });
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function saveOrganization(next: ComboValue) {
    try {
      const result = await ensureOrganization(supabase, ownerId, next);
      if (result.created) setOrganizations((current) => [...current, result.created!]);
      setOrgValue({ id: result.id, name: result.created?.name ?? next.name });
      if (result.id !== deal.organization_id) await patch({ organization_id: result.id });
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function remove() {
    if (!confirm(`Delete deal “${deal.title}”?`)) return;
    const { error } = await supabase.from("crm_deals").delete().eq("id", deal.id);
    if (error) return setToast(error.message);
    router.push(`/putkiajo/pipelines/${deal.pipeline_id}`);
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-5">
      <Link
        href={`/putkiajo/pipelines/${deal.pipeline_id}`}
        className="inline-flex items-center gap-1.5 text-sm text-[#6b6979] hover:text-[#29283a]"
      >
        <ArrowLeft size={15} /> {pipelines.find((p) => p.id === deal.pipeline_id)?.name ?? "Pipeline"}
      </Link>

      <div className="mt-3 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <input
            aria-label="Deal title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => {
              const next = title.trim().slice(0, 240);
              if (!next) return setTitle(deal.title);
              if (next !== deal.title) void patch({ title: next });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="w-full rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-2xl font-semibold tracking-tight outline-none hover:border-[#dedde6] focus:border-[#6c63ff] focus:bg-white"
          />
          <p className="mt-1 px-1 text-sm text-[#6b6979]">
            {formatMoney(Number(deal.value), deal.currency)}
            {person && <> · {person.name}</>}
            {organization && <> · {organization.name}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {deal.status === "open" ? (
            <>
              <Button variant="success" onClick={() => setStatus("won")}>
                <Trophy size={15} /> Won
              </Button>
              <Button variant="danger" onClick={() => setAskLost(true)}>
                <X size={15} /> Lost
              </Button>
            </>
          ) : (
            <>
              <span
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                  deal.status === "won" ? "bg-[#e3f6ea] text-[#1f9d55]" : "bg-[#fde8e8] text-[#d63c41]"
                }`}
              >
                {deal.status === "won" ? "Won" : "Lost"}{" "}
                {formatDate(deal.status === "won" ? deal.won_at : deal.lost_at)}
                {deal.status === "lost" && deal.lost_reason && ` · ${deal.lost_reason}`}
              </span>
              <Button onClick={() => setStatus("open")}>
                <RotateCcw size={15} /> Reopen
              </Button>
            </>
          )}
          <Button variant="ghost" aria-label="Delete deal" onClick={remove}>
            <Trash2 size={16} />
          </Button>
        </div>
      </div>

      <div className="mt-4 flex overflow-hidden rounded-lg">
        {pipelineStages.map((stage, index) => (
          <button
            key={stage.id}
            title={stage.name}
            onClick={() => {
              if (stage.id !== deal.stage_id)
                void patch({ stage_id: stage.id, stage_changed_at: new Date().toISOString() });
            }}
            className={`relative h-9 flex-1 px-2 text-xs font-medium transition-colors ${
              index <= currentIndex
                ? "bg-[#1f9d55] text-white hover:bg-[#198a4a]"
                : "bg-[#e9e9ef] text-[#6b6979] hover:bg-[#dedde6]"
            } ${index > 0 ? "border-l-2 border-white" : ""}`}
          >
            <span className="block truncate">
              {stage.name}
              {stage.id === deal.stage_id && ` · ${daysSince(deal.stage_changed_at)}d`}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[340px_1fr]">
        <aside className="space-y-5">
          <section className="space-y-4 rounded-xl border border-[#e3e2e9] bg-white p-4">
            <h3 className="text-sm font-semibold">Summary</h3>
            <div className="grid grid-cols-[1fr_96px] gap-2">
              <Field label="Value">
                <TextInput
                  type="number"
                  min={0}
                  step="any"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  onBlur={() => {
                    const next = Math.max(0, Number(value) || 0);
                    setValue(String(next));
                    if (next !== Number(deal.value)) void patch({ value: next });
                  }}
                />
              </Field>
              <Field label="Currency">
                <Select
                  value={deal.currency}
                  onChange={(event) => void patch({ currency: event.target.value })}
                >
                  {[...new Set([...CURRENCIES, deal.currency])].map((code) => (
                    <option key={code}>{code}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Expected close date">
              <TextInput
                type="date"
                value={deal.expected_close_date ?? ""}
                onChange={(event) => void patch({ expected_close_date: event.target.value || null })}
              />
            </Field>
            <Field label="Pipeline">
              <Select
                value={deal.pipeline_id}
                onChange={(event) => {
                  const first = stages
                    .filter((stage) => stage.pipeline_id === event.target.value)
                    .sort((a, b) => a.position - b.position)[0];
                  if (!first) return setToast("That pipeline has no stages.");
                  void patch({
                    pipeline_id: event.target.value,
                    stage_id: first.id,
                    stage_changed_at: new Date().toISOString(),
                  });
                }}
              >
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </section>

          <section className="space-y-4 rounded-xl border border-[#e3e2e9] bg-white p-4">
            <h3 className="flex items-center justify-between text-sm font-semibold">
              <span className="flex items-center gap-2">
                <User size={15} /> Person
              </span>
              {person && (
                <Link href={`/putkiajo/persons/${person.id}`} className="text-xs font-medium text-[#5148df]">
                  Open
                </Link>
              )}
            </h3>
            <ComboSaver
              options={persons.map((p) => ({ id: p.id, name: p.name }))}
              value={personValue}
              onChange={setPersonValue}
              onCommit={savePerson}
              placeholder="Link a person"
            />
            <h3 className="flex items-center justify-between pt-2 text-sm font-semibold">
              <span className="flex items-center gap-2">
                <Building2 size={15} /> Organization
              </span>
              {organization && (
                <Link
                  href={`/putkiajo/organizations/${organization.id}`}
                  className="text-xs font-medium text-[#5148df]"
                >
                  Open
                </Link>
              )}
            </h3>
            <ComboSaver
              options={organizations.map((o) => ({ id: o.id, name: o.name }))}
              value={orgValue}
              onChange={setOrgValue}
              onCommit={saveOrganization}
              placeholder="Link an organization"
            />
          </section>
        </aside>

        <div className="space-y-5">
          <NotesPanel ownerId={ownerId} target={{ deal_id: deal.id }} initialNotes={initialNotes} />
          <ThreadList threads={threads} />
        </div>
      </div>

      {askLost && (
        <LostReasonModal
          deal={deal}
          onClose={() => setAskLost(false)}
          onConfirm={(reason) => {
            setAskLost(false);
            setStatus("lost", reason);
          }}
        />
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function ComboSaver({
  options,
  value,
  onChange,
  onCommit,
  placeholder,
}: {
  options: { id: string; name: string }[];
  value: ComboValue;
  onChange: (value: ComboValue) => void;
  onCommit: (value: ComboValue) => void;
  placeholder: string;
}) {
  return (
    <div className="flex gap-2">
      <div className="min-w-0 flex-1">
        <EntityCombo options={options} value={value} onChange={onChange} placeholder={placeholder} />
      </div>
      <Button onClick={() => onCommit(value)}>Save</Button>
    </div>
  );
}
