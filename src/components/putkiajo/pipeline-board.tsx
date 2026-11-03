"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Clock,
  Pencil,
  Plus,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  daysSince,
  formatMoney,
  isRotting,
  sumByCurrency,
  type Deal,
  type DealStatus,
  type Organization,
  type Person,
  type Pipeline,
  type Stage,
} from "@/lib/crm";
import { DealFormModal } from "./deal-form";
import { Avatar, Button, Field, Modal, TextInput, Toast } from "./ui";

type StatusFilter = DealStatus | "all";
const ZONES = ["zone:delete", "zone:lost", "zone:won"] as const;

export function PipelineBoard({
  ownerId,
  pipelineId,
  initialPipelines,
  initialStages,
  initialDeals,
  initialPersons,
  initialOrganizations,
}: {
  ownerId: string;
  pipelineId: string;
  initialPipelines: Pipeline[];
  initialStages: Stage[];
  initialDeals: Deal[];
  initialPersons: Person[];
  initialOrganizations: Organization[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pipelines, setPipelines] = useState(initialPipelines);
  const [stages, setStages] = useState(initialStages);
  const [deals, setDeals] = useState(initialDeals);
  const [persons, setPersons] = useState(initialPersons);
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [filter, setFilter] = useState<StatusFilter>("open");
  const [adding, setAdding] = useState<{ stageId?: string } | null>(null);
  const [editingPipeline, setEditingPipeline] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [lostDeal, setLostDeal] = useState<Deal | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const dragSnapshot = useRef<Deal[] | null>(null);
  const justDragged = useRef(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  const pipeline = pipelines.find((p) => p.id === pipelineId)!;
  const pipelineStages = useMemo(
    () =>
      stages
        .filter((stage) => stage.pipeline_id === pipelineId)
        .sort((a, b) => a.position - b.position),
    [stages, pipelineId],
  );
  const visibleDeals = useMemo(
    () =>
      deals
        .filter((deal) => deal.pipeline_id === pipelineId)
        .filter((deal) => filter === "all" || deal.status === filter),
    [deals, pipelineId, filter],
  );
  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const stage of pipelineStages) map.set(stage.id, []);
    for (const deal of visibleDeals) map.get(deal.stage_id)?.push(deal);
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [pipelineStages, visibleDeals]);
  const personById = useMemo(() => new Map(persons.map((p) => [p.id, p])), [persons]);
  const orgById = useMemo(() => new Map(organizations.map((o) => [o.id, o])), [organizations]);
  const activeDeal = deals.find((deal) => deal.id === activeId) ?? null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const collisionDetection: CollisionDetection = (args) => {
    const zoneHits = pointerWithin({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) =>
        String(c.id).startsWith("zone:"),
      ),
    });
    if (zoneHits.length) return zoneHits;
    return closestCorners({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (c) => !String(c.id).startsWith("zone:"),
      ),
    });
  };

  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (!switcherRef.current?.contains(event.target as Node)) setSwitcherOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function notify(message: string) {
    setToast(message);
  }

  function stageOf(id: string): string | null {
    if (dealsByStage.has(id)) return id;
    return deals.find((deal) => deal.id === id)?.stage_id ?? null;
  }

  function handleDragStart(event: DragStartEvent) {
    dragSnapshot.current = deals;
    setActiveId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || String(over.id).startsWith("zone:")) return;
    const from = stageOf(String(active.id));
    const to = stageOf(String(over.id));
    if (!from || !to || from === to) return;
    setDeals((current) =>
      current.map((deal) => (deal.id === active.id ? { ...deal, stage_id: to } : deal)),
    );
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const snapshot = dragSnapshot.current ?? deals;
    dragSnapshot.current = null;
    setActiveId(null);
    justDragged.current = true;
    setTimeout(() => (justDragged.current = false), 50);

    const dealId = String(active.id);
    const original = snapshot.find((deal) => deal.id === dealId);
    if (!original) return;

    if (!over) {
      setDeals(snapshot);
      return;
    }

    const overId = String(over.id);
    if (overId.startsWith("zone:")) {
      setDeals(snapshot);
      if (overId === "zone:won") await setStatus(original, "won");
      if (overId === "zone:lost") setLostDeal(original);
      if (overId === "zone:delete") await deleteDeal(original);
      return;
    }

    const targetStage = stageOf(overId);
    if (!targetStage) return;
    const column = (dealsByStage.get(targetStage) ?? []).map((deal) => deal.id);
    const oldIndex = column.indexOf(dealId);
    const overIndex = overId === targetStage ? column.length - 1 : column.indexOf(overId);
    const ordered =
      oldIndex === -1
        ? [...column, dealId]
        : arrayMove(column, oldIndex, overIndex === -1 ? oldIndex : overIndex);

    const stageChanged = original.stage_id !== targetStage;
    const now = new Date().toISOString();
    const updates = ordered
      .map((id, position) => {
        const deal = (id === dealId ? original : deals.find((d) => d.id === id))!;
        const patch: Partial<Deal> = {};
        if (deal.position !== position) patch.position = position;
        if (id === dealId && stageChanged) {
          patch.stage_id = targetStage;
          patch.stage_changed_at = now;
        }
        return { id, patch };
      })
      .filter(({ patch }) => Object.keys(patch).length > 0);

    setDeals((current) =>
      current.map((deal) => {
        const update = updates.find((u) => u.id === deal.id);
        return update ? { ...deal, ...update.patch, stage_id: update.patch.stage_id ?? deal.stage_id } : deal;
      }),
    );

    const results = await Promise.all(
      updates.map(({ id, patch }) => supabase.from("crm_deals").update(patch).eq("id", id)),
    );
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      setDeals(snapshot);
      notify(failed.error.message);
    }
  }

  async function setStatus(deal: Deal, status: DealStatus, lostReason = "") {
    const now = new Date().toISOString();
    const patch = {
      status,
      won_at: status === "won" ? now : null,
      lost_at: status === "lost" ? now : null,
      lost_reason: status === "lost" ? lostReason : "",
    };
    setDeals((current) => current.map((d) => (d.id === deal.id ? { ...d, ...patch } : d)));
    const { error } = await supabase.from("crm_deals").update(patch).eq("id", deal.id);
    if (error) {
      setDeals((current) => current.map((d) => (d.id === deal.id ? deal : d)));
      notify(error.message);
    } else {
      notify(status === "won" ? `“${deal.title}” marked as won` : `“${deal.title}” marked as lost`);
    }
  }

  async function deleteDeal(deal: Deal) {
    if (!confirm(`Delete deal “${deal.title}”?`)) return;
    setDeals((current) => current.filter((d) => d.id !== deal.id));
    const { error } = await supabase.from("crm_deals").delete().eq("id", deal.id);
    if (error) {
      setDeals((current) => [...current, deal]);
      notify(error.message);
    }
  }

  async function createPipeline() {
    const name = prompt("Pipeline name", "New pipeline")?.trim();
    if (!name) return;
    const { data, error } = await supabase
      .from("crm_pipelines")
      .insert({ owner_id: ownerId, name: name.slice(0, 120), position: pipelines.length })
      .select()
      .single();
    if (error) return notify(error.message);
    const { error: stageError } = await supabase.from("crm_stages").insert(
      ["Lead in", "Contact made", "Proposal made", "Negotiation"].map((stageName, position) => ({
        owner_id: ownerId,
        pipeline_id: data.id,
        name: stageName,
        position,
      })),
    );
    if (stageError) return notify(stageError.message);
    router.push(`/putkiajo/pipelines/${data.id}`);
  }

  const totalLabel = sumByCurrency(visibleDeals);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#e5e5ec] bg-white px-5 py-3">
        <Button variant="success" onClick={() => setAdding({})}>
          <Plus size={16} strokeWidth={2.4} />
          Deal
        </Button>
        <div className="text-sm text-[#6b6979]">
          <span className="font-semibold text-[#29283a]">{totalLabel}</span>
          <span className="mx-1.5">·</span>
          {visibleDeals.length} {visibleDeals.length === 1 ? "deal" : "deals"}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-lg border border-[#dedde7] p-0.5 text-xs font-medium">
            {(["open", "won", "lost", "all"] as const).map((value) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`rounded-md px-2.5 py-1.5 capitalize ${
                  filter === value ? "bg-[#efeefe] text-[#5148df]" : "text-[#6b6979] hover:text-[#29283a]"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
          <div ref={switcherRef} className="relative">
            <Button onClick={() => setSwitcherOpen((open) => !open)}>
              {pipeline.name}
              <ChevronDown size={15} />
            </Button>
            {switcherOpen && (
              <div className="absolute right-0 z-50 mt-1 w-60 rounded-xl border border-[#e2e1e8] bg-white p-1.5 text-sm shadow-lg">
                {pipelines.map((p) => (
                  <button
                    key={p.id}
                    className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left hover:bg-[#f4f4f8]"
                    onClick={() => {
                      setSwitcherOpen(false);
                      if (p.id !== pipelineId) router.push(`/putkiajo/pipelines/${p.id}`);
                    }}
                  >
                    <span className="truncate">{p.name}</span>
                    {p.id === pipelineId && <Check size={15} className="text-[#6c63ff]" />}
                  </button>
                ))}
                <div className="my-1 border-t border-[#ecebf1]" />
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-[#f4f4f8]"
                  onClick={() => {
                    setSwitcherOpen(false);
                    setEditingPipeline(true);
                  }}
                >
                  <Pencil size={14} /> Edit pipeline
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-[#f4f4f8]"
                  onClick={() => {
                    setSwitcherOpen(false);
                    void createPipeline();
                  }}
                >
                  <Plus size={14} /> New pipeline
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          if (dragSnapshot.current) setDeals(dragSnapshot.current);
          dragSnapshot.current = null;
          setActiveId(null);
        }}
      >
        <div className="flex min-h-0 flex-1 gap-0 overflow-x-auto">
          {pipelineStages.map((stage) => {
            const stageDeals = dealsByStage.get(stage.id) ?? [];
            return (
              <StageColumn
                key={stage.id}
                stage={stage}
                deals={stageDeals}
                onAdd={() => setAdding({ stageId: stage.id })}
              >
                {stageDeals.map((deal) => (
                  <SortableDealCard
                    key={deal.id}
                    deal={deal}
                    stage={stage}
                    person={deal.person_id ? personById.get(deal.person_id) : undefined}
                    organization={
                      deal.organization_id ? orgById.get(deal.organization_id) : undefined
                    }
                    onOpen={() => {
                      if (!justDragged.current) router.push(`/putkiajo/deals/${deal.id}`);
                    }}
                  />
                ))}
              </StageColumn>
            );
          })}
          {pipelineStages.length === 0 && (
            <div className="m-auto text-center text-sm text-[#6b6979]">
              This pipeline has no stages yet.
              <div className="mt-3">
                <Button onClick={() => setEditingPipeline(true)}>Add stages</Button>
              </div>
            </div>
          )}
        </div>

        {activeId && (
          <div className="grid shrink-0 grid-cols-3 gap-3 border-t border-[#e5e5ec] bg-white p-3">
            {ZONES.map((zone) => (
              <DropZone key={zone} id={zone} />
            ))}
          </div>
        )}

        <DragOverlay>
          {activeDeal && (
            <DealCard
              deal={activeDeal}
              stage={pipelineStages.find((s) => s.id === activeDeal.stage_id)}
              person={activeDeal.person_id ? personById.get(activeDeal.person_id) : undefined}
              organization={
                activeDeal.organization_id ? orgById.get(activeDeal.organization_id) : undefined
              }
              dragging
            />
          )}
        </DragOverlay>
      </DndContext>

      {adding && (
        <DealFormModal
          ownerId={ownerId}
          pipelines={pipelines}
          stages={stages}
          persons={persons}
          organizations={organizations}
          defaults={{ pipelineId, stageId: adding.stageId }}
          onClose={() => setAdding(null)}
          onCreated={({ deal, person, organization }) => {
            setAdding(null);
            if (person) setPersons((current) => [...current, person]);
            if (organization) setOrganizations((current) => [...current, organization]);
            if (deal.pipeline_id === pipelineId) setDeals((current) => [...current, deal]);
            else router.push(`/putkiajo/pipelines/${deal.pipeline_id}`);
            notify(`Deal “${deal.title}” added`);
          }}
        />
      )}

      {lostDeal && (
        <LostReasonModal
          deal={lostDeal}
          onClose={() => setLostDeal(null)}
          onConfirm={(reason) => {
            void setStatus(lostDeal, "lost", reason);
            setLostDeal(null);
          }}
        />
      )}

      {editingPipeline && (
        <PipelineEditor
          ownerId={ownerId}
          pipeline={pipeline}
          stages={pipelineStages}
          dealCounts={
            new Map(
              pipelineStages.map((stage) => [
                stage.id,
                deals.filter((deal) => deal.stage_id === stage.id).length,
              ]),
            )
          }
          canDelete={pipelines.length > 1}
          onClose={() => setEditingPipeline(false)}
          onSaved={(nextPipeline, nextStages) => {
            setPipelines((current) =>
              current.map((p) => (p.id === nextPipeline.id ? nextPipeline : p)),
            );
            setStages((current) => [
              ...current.filter((stage) => stage.pipeline_id !== pipelineId),
              ...nextStages,
            ]);
            setEditingPipeline(false);
          }}
          onDeleted={() => {
            const next = pipelines.find((p) => p.id !== pipelineId);
            router.push(next ? `/putkiajo/pipelines/${next.id}` : "/putkiajo/pipelines");
          }}
          onError={notify}
        />
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function StageColumn({
  stage,
  deals,
  onAdd,
  children,
}: {
  stage: Stage;
  deals: Deal[];
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <section className="group flex w-68 shrink-0 flex-col border-r border-[#e5e5ec] last:border-r-0">
      <header className="border-b border-[#e5e5ec] bg-white px-3 py-2.5">
        <h3 className="truncate text-sm font-semibold">{stage.name}</h3>
        <p className="mt-0.5 text-xs text-[#8b8998]">
          {sumByCurrency(deals)} · {deals.length} {deals.length === 1 ? "deal" : "deals"}
        </p>
      </header>
      <div
        ref={setNodeRef}
        className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 ${
          isOver ? "bg-[#efeefe]/60" : ""
        }`}
      >
        <SortableContext items={deals.map((deal) => deal.id)} strategy={verticalListSortingStrategy}>
          {children}
        </SortableContext>
        <button
          onClick={onAdd}
          aria-label={`Add deal to ${stage.name}`}
          className="flex h-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-transparent text-[#9997a5] hover:border-[#cfcde0] hover:bg-white hover:text-[#5f5d6e] group-hover:border-[#dedde7]"
        >
          <Plus size={16} />
        </button>
      </div>
    </section>
  );
}

function SortableDealCard(props: {
  deal: Deal;
  stage: Stage;
  person?: Person;
  organization?: Organization;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.deal.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? "opacity-30" : ""}
      {...attributes}
      {...listeners}
    >
      <DealCard {...props} />
    </div>
  );
}

function DealCard({
  deal,
  stage,
  person,
  organization,
  onOpen,
  dragging,
}: {
  deal: Deal;
  stage?: Stage;
  person?: Person;
  organization?: Organization;
  onOpen?: () => void;
  dragging?: boolean;
}) {
  const rotting = isRotting(deal, stage);
  const subtitle = [organization?.name, person?.name].filter(Boolean).join(", ");
  return (
    <div
      role="button"
      tabIndex={-1}
      onClick={onOpen}
      className={`cursor-grab rounded-lg border bg-white p-3 text-left shadow-[0_1px_2px_rgba(30,27,60,0.06)] hover:border-[#c9c6f5] ${
        rotting ? "border-[#f3b4b6] bg-[#fff6f6]" : "border-[#e3e2e9]"
      } ${dragging ? "rotate-2 cursor-grabbing shadow-xl" : ""}`}
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{deal.title}</p>
        {deal.status !== "open" && (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
              deal.status === "won" ? "bg-[#e3f6ea] text-[#1f9d55]" : "bg-[#fde8e8] text-[#d63c41]"
            }`}
          >
            {deal.status}
          </span>
        )}
      </div>
      {subtitle && <p className="mt-0.5 truncate text-xs text-[#8b8998]">{subtitle}</p>}
      <div className="mt-2 flex items-center gap-2 text-xs text-[#5f5d6e]">
        {person && <Avatar name={person.name} size={20} />}
        <span className="font-medium">{formatMoney(Number(deal.value), deal.currency)}</span>
        {rotting && (
          <span className="ml-auto inline-flex items-center gap-1 text-[#d63c41]">
            <Clock size={12} /> {daysSince(deal.stage_changed_at)}d
          </span>
        )}
      </div>
    </div>
  );
}

function DropZone({ id }: { id: (typeof ZONES)[number] }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const config = {
    "zone:delete": { label: "Delete", icon: Trash2, color: "#6b6979", bg: "#f2f2f6" },
    "zone:lost": { label: "Lost", icon: X, color: "#d63c41", bg: "#fde8e8" },
    "zone:won": { label: "Won", icon: Trophy, color: "#1f9d55", bg: "#e3f6ea" },
  }[id];
  const Icon = config.icon;
  return (
    <div
      ref={setNodeRef}
      className="flex h-14 items-center justify-center gap-2 rounded-xl border-2 border-dashed text-sm font-semibold uppercase tracking-wide transition-all"
      style={{
        color: config.color,
        borderColor: isOver ? config.color : `${config.color}55`,
        background: isOver ? config.bg : "transparent",
      }}
    >
      <Icon size={18} />
      {config.label}
    </div>
  );
}

export function LostReasonModal({
  deal,
  onClose,
  onConfirm,
}: {
  deal: Deal;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      title={`Mark “${deal.title}” as lost`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={() => onConfirm(reason.trim())}>
            Mark as lost
          </Button>
        </>
      }
    >
      <Field label="Lost reason">
        <TextInput
          autoFocus
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onConfirm(reason.trim());
          }}
          placeholder="e.g. Went with a competitor"
        />
      </Field>
    </Modal>
  );
}

type DraftStage = {
  id: string | null;
  key: string;
  name: string;
  probability: number;
  rotting_days: number | null;
};

function PipelineEditor({
  ownerId,
  pipeline,
  stages,
  dealCounts,
  canDelete,
  onClose,
  onSaved,
  onDeleted,
  onError,
}: {
  ownerId: string;
  pipeline: Pipeline;
  stages: Stage[];
  dealCounts: Map<string, number>;
  canDelete: boolean;
  onClose: () => void;
  onSaved: (pipeline: Pipeline, stages: Stage[]) => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState(pipeline.name);
  const [draft, setDraft] = useState<DraftStage[]>(
    stages.map((stage) => ({
      id: stage.id,
      key: stage.id,
      name: stage.name,
      probability: stage.probability,
      rotting_days: stage.rotting_days,
    })),
  );
  const [saving, setSaving] = useState(false);

  function update(key: string, patch: Partial<DraftStage>) {
    setDraft((current) => current.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  function move(index: number, delta: number) {
    setDraft((current) => arrayMove(current, index, index + delta));
  }

  async function save() {
    if (!name.trim() || draft.some((stage) => !stage.name.trim())) {
      onError("Pipeline and stage names can't be empty.");
      return;
    }
    setSaving(true);
    try {
      const { error: pipelineError } = await supabase
        .from("crm_pipelines")
        .update({ name: name.trim().slice(0, 120) })
        .eq("id", pipeline.id);
      if (pipelineError) throw pipelineError;

      const removed = stages.filter((stage) => !draft.some((d) => d.id === stage.id));
      for (const stage of removed) {
        const { error } = await supabase.from("crm_stages").delete().eq("id", stage.id);
        if (error) throw error;
      }

      const saved: Stage[] = [];
      for (const [position, stage] of draft.entries()) {
        const values = {
          name: stage.name.trim().slice(0, 80),
          probability: Math.min(100, Math.max(0, Math.round(stage.probability))),
          rotting_days: stage.rotting_days && stage.rotting_days > 0 ? stage.rotting_days : null,
          position,
        };
        const query = stage.id
          ? supabase.from("crm_stages").update(values).eq("id", stage.id).select().single()
          : supabase
              .from("crm_stages")
              .insert({ ...values, owner_id: ownerId, pipeline_id: pipeline.id })
              .select()
              .single();
        const { data, error } = await query;
        if (error) throw error;
        saved.push(data as Stage);
      }
      onSaved({ ...pipeline, name: name.trim() }, saved);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
      setSaving(false);
    }
  }

  async function removePipeline() {
    if (!confirm(`Delete pipeline “${pipeline.name}” and all of its deals?`)) return;
    const { error } = await supabase.from("crm_pipelines").delete().eq("id", pipeline.id);
    if (error) return onError(error.message);
    onDeleted();
  }

  return (
    <Modal
      title="Edit pipeline"
      wide
      onClose={onClose}
      footer={
        <>
          {canDelete && (
            <Button variant="ghost" className="mr-auto text-[#d63c41]" onClick={removePipeline}>
              <Trash2 size={15} /> Delete pipeline
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <Field label="Pipeline name">
        <TextInput value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <div className="mt-5">
        <div className="mb-2 grid grid-cols-[1fr_96px_96px_100px] gap-2 px-1 text-xs font-medium text-[#6b6979]">
          <span>Stage</span>
          <span>Probability %</span>
          <span>Rotting (days)</span>
          <span />
        </div>
        <div className="space-y-2">
          {draft.map((stage, index) => {
            const count = stage.id ? dealCounts.get(stage.id) ?? 0 : 0;
            return (
              <div key={stage.key} className="grid grid-cols-[1fr_96px_96px_100px] items-center gap-2">
                <TextInput
                  value={stage.name}
                  onChange={(event) => update(stage.key, { name: event.target.value })}
                />
                <TextInput
                  type="number"
                  min={0}
                  max={100}
                  value={stage.probability}
                  onChange={(event) => update(stage.key, { probability: Number(event.target.value) })}
                />
                <TextInput
                  type="number"
                  min={1}
                  placeholder="Off"
                  value={stage.rotting_days ?? ""}
                  onChange={(event) =>
                    update(stage.key, {
                      rotting_days: event.target.value ? Number(event.target.value) : null,
                    })
                  }
                />
                <div className="flex items-center justify-end gap-0.5">
                  <IconButton label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp size={15} />
                  </IconButton>
                  <IconButton
                    label="Move down"
                    disabled={index === draft.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={15} />
                  </IconButton>
                  <IconButton
                    label={count ? `Move its ${count} deals before deleting` : "Delete stage"}
                    disabled={count > 0}
                    onClick={() =>
                      setDraft((current) => current.filter((s) => s.key !== stage.key))
                    }
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </div>
              </div>
            );
          })}
        </div>
        <Button
          className="mt-3"
          onClick={() =>
            setDraft((current) => [
              ...current,
              {
                id: null,
                key: crypto.randomUUID(),
                name: "New stage",
                probability: 100,
                rotting_days: null,
              },
            ])
          }
        >
          <Plus size={15} /> Add stage
        </Button>
      </div>
    </Modal>
  );
}

function IconButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="rounded-md p-1.5 text-[#8b8998] hover:bg-[#f2f2f7] hover:text-[#29283a] disabled:opacity-30 disabled:hover:bg-transparent"
      {...props}
    >
      {children}
    </button>
  );
}
