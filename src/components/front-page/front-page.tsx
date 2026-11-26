"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Archive, ChevronRight, Eye, EyeOff, Inbox, Search, X } from "lucide-react";
import { AppTopBar } from "@/components/app-top-bar";
import { createClient } from "@/lib/supabase/client";
import {
  WEEK_ITEM_LIMIT,
  addDays,
  doneValuePatch,
  isDone,
  isoWeekNumber,
  roleOption,
  weekStart,
} from "@/lib/planning";
import { ItemPanel, type PanelPatch } from "./item-panel";
import {
  AddForm,
  DraggableCard,
  ItemCard,
  KanbanColumn,
  type ColumnId,
} from "./item-list";
import {
  ITEM_FIELDS,
  isInboxBoard,
  shortDateFi,
  weekdayFi,
  type FrontItem,
  type FrontPageData,
} from "./types";

type ItemPatch = PanelPatch;
type UndoEntry = { label: string; undo: () => Promise<void> };
type Toast = { message: string; undoable: boolean };
type Filters = { text: string; board: string; status: string; severity: string };

const UNDO_LIMIT = 30;
const EMPTY_FILTERS: Filters = { text: "", board: "", status: "", severity: "" };

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function FrontPage({ data }: { data: FrontPageData }) {
  const supabase = useMemo(() => createClient(), []);
  const { today, columns, boards, groups, userId } = data;
  const monday = weekStart(today);
  const lastMonday = addDays(monday, -7);

  const [items, setItems] = useState(data.items);
  const [busyItems, setBusyItems] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<Toast | null>(
    data.loadError ? { message: data.loadError, undoable: false } : null,
  );
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showDone, setShowDone] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState<ColumnId | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const undoStack = useRef<UndoEntry[]>([]);
  const toastTimer = useRef<number | undefined>(undefined);

  const boardsById = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards]);
  const boardOrder = useMemo(() => new Map(boards.map((b, i) => [b.id, i])), [boards]);
  const inboxBoard = boards.find(isInboxBoard);
  const defaultBoardId = inboxBoard?.id ?? boards[0]?.id ?? "";

  const dndId = useId();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  );

  // -------------------------------------------------------------------------
  // Toasts and undo
  // -------------------------------------------------------------------------

  function showToast(message: string, undoable = false) {
    setToast({ message, undoable });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), undoable ? 6000 : 4000);
  }

  function notify(message: string) {
    showToast(message, false);
  }

  function pushUndo(entry: UndoEntry) {
    undoStack.current = [...undoStack.current.slice(-(UNDO_LIMIT - 1)), entry];
    showToast(entry.label, true);
  }

  async function undoLast() {
    const entry = undoStack.current.pop();
    if (!entry) return notify("Ei kumottavaa");
    await entry.undo();
    showToast(`Kumottu: ${entry.label}`, undoStack.current.length > 0);
  }

  // Cmd+Z / Ctrl+Z undoes the latest front-page action (not while typing).
  const undoRef = useRef(undoLast);
  useEffect(() => {
    undoRef.current = undoLast;
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "z" || isTypingTarget(event.target)) return;
      event.preventDefault();
      void undoRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  function setBusy(id: string, busy: boolean) {
    setBusyItems((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function upsertLocal(item: FrontItem) {
    setItems((current) => current.map((i) => (i.id === item.id ? item : i)));
  }

  /** Adds the group move of a matching board automation when a column value changes. */
  function withAutomation(item: FrontItem, patch: ItemPatch): ItemPatch {
    if (!patch.column_values || patch.group_id) return patch;
    const next = patch.column_values;
    const rule = data.automations.find(
      (a) =>
        a.enabled &&
        a.board_id === item.board_id &&
        next[a.trigger_column_id] !== item.column_values?.[a.trigger_column_id] &&
        String(next[a.trigger_column_id] ?? "") === a.trigger_value,
    );
    if (!rule || rule.target_group_id === item.group_id) return patch;
    return { ...patch, group_id: rule.target_group_id };
  }

  /** Writes `patch` (optimistically); with `label`, records an undo entry. */
  async function updateItem(item: FrontItem, rawPatch: ItemPatch, label?: string) {
    const patch = withAutomation(item, rawPatch);
    setBusy(item.id, true);
    upsertLocal({ ...item, ...patch });
    const { data: row, error } = await supabase
      .from("items")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .select(ITEM_FIELDS)
      .single();
    setBusy(item.id, false);
    if (error || !row) {
      upsertLocal(item);
      notify(error?.message ?? "Tallennus epäonnistui");
      return null;
    }
    const saved = row as FrontItem;
    upsertLocal(saved);
    if (label) {
      const previous: ItemPatch = {};
      for (const key of Object.keys(patch) as (keyof ItemPatch)[]) {
        (previous as Record<string, unknown>)[key] = item[key];
      }
      // The DB trigger derives planned_week from planned_day, so restore both.
      if ("planned_day" in patch || "planned_week" in patch) {
        previous.planned_day = item.planned_day;
        previous.planned_week = item.planned_week;
      }
      pushUndo({ label, undo: async () => void (await updateItem(saved, previous)) });
    }
    return saved;
  }

  function toggleDone(item: FrontItem, done: boolean) {
    const patch = doneValuePatch(item, columns, done);
    if (!patch) return notify("Taululla ei ole Status-saraketta");
    void updateItem(
      item,
      { column_values: patch },
      done ? `Valmis: ${item.title}` : `Avattu: ${item.title}`,
    );
  }

  function archiveItem(item: FrontItem, archived: boolean) {
    void updateItem(
      item,
      { archived_at: archived ? new Date().toISOString() : null },
      archived ? `Arkistoitu: ${item.title}` : `Palautettu arkistosta: ${item.title}`,
    );
  }

  async function deleteItem(item: FrontItem) {
    if (!window.confirm(`Poistetaanko “${item.title}” pysyvästi? Tätä ei voi kumota.`)) return;
    const { error } = await supabase.from("items").delete().eq("id", item.id);
    if (error) return notify(error.message);
    setOpenId(null);
    setItems((current) => current.filter((i) => i.id !== item.id));
    notify(`Poistettu: ${item.title}`);
  }

  function planFor(column: ColumnId): ItemPatch {
    if (column === "today") return { planned_day: today, planned_week: monday };
    if (column === "week") return { planned_day: null, planned_week: monday };
    return { planned_day: null, planned_week: null };
  }

  async function createItem(title: string, boardId: string, column: ColumnId) {
    const group = groups
      .filter((g) => g.board_id === boardId)
      .sort((a, b) => a.position - b.position)[0];
    if (!group) {
      notify("Taululla ei ole ryhmää");
      return false;
    }
    const { data: last } = await supabase
      .from("items")
      .select("position")
      .eq("group_id", group.id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const columnValues =
      doneValuePatch({ board_id: boardId, column_values: {} }, columns, false) ?? {};
    const { data: row, error } = await supabase
      .from("items")
      .insert({
        title,
        board_id: boardId,
        group_id: group.id,
        owner_id: userId,
        position: ((last?.position as number | undefined) ?? -1) + 1,
        column_values: columnValues,
        ...planFor(column),
      })
      .select(ITEM_FIELDS)
      .single();
    if (error || !row) {
      notify(error?.message ?? "Lisäys epäonnistui");
      return false;
    }
    const created = row as FrontItem;
    setItems((current) => [...current, created]);
    pushUndo({
      label: `Lisätty: ${title}`,
      undo: async () => {
        const { error: deleteError } = await supabase.from("items").delete().eq("id", created.id);
        if (deleteError) return notify(deleteError.message);
        setItems((current) => current.filter((i) => i.id !== created.id));
      },
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // Columns, filters, drag & drop
  // -------------------------------------------------------------------------

  function columnOf(item: FrontItem): ColumnId {
    if (item.planned_day === today) return "today";
    if (item.planned_week === monday) return "week";
    if (item.planned_week === lastMonday && !isDone(item, columns)) return "week";
    return "all";
  }

  function badgeFor(item: FrontItem): { text: string; tone?: "warn" | "muted" } | undefined {
    const done = isDone(item, columns);
    if (!done && item.planned_day && item.planned_day < today && item.planned_day >= lastMonday) {
      return { text: `jäänyt · ${weekdayFi(item.planned_day)} ${shortDateFi(item.planned_day)}`, tone: "warn" };
    }
    if (!done && item.planned_week === lastMonday) {
      return { text: `jäänyt · vko ${isoWeekNumber(lastMonday)}`, tone: "warn" };
    }
    if (item.planned_day && item.planned_day !== today) {
      return { text: `${weekdayFi(item.planned_day)} ${shortDateFi(item.planned_day)}` };
    }
    if (item.planned_week && item.planned_week > monday) {
      return { text: `vko ${isoWeekNumber(item.planned_week)}` };
    }
    return undefined;
  }

  const statusLabels = useMemo(() => optionLabels(columns, "status"), [columns]);
  const severityLabels = useMemo(() => optionLabels(columns, "severity"), [columns]);

  const text = filters.text.trim().toLowerCase();
  const filtered = items.filter((item) => {
    const board = boardsById.get(item.board_id);
    if (!board) return false;
    if (!showArchived && item.archived_at) return false;
    if (!showDone && isDone(item, columns)) return false;
    if (filters.board && item.board_id !== filters.board) return false;
    if (filters.status && roleOption(item, columns, "status")?.label !== filters.status) return false;
    if (filters.severity && roleOption(item, columns, "severity")?.label !== filters.severity) return false;
    if (text && !`${item.title} ${board.name}`.toLowerCase().includes(text)) return false;
    return true;
  });

  const byColumn: Record<ColumnId, FrontItem[]> = { all: [], week: [], today: [] };
  for (const item of filtered) byColumn[columnOf(item)].push(item);
  const doneLast = (a: FrontItem, b: FrontItem) =>
    Number(isDone(a, columns)) - Number(isDone(b, columns));
  byColumn.today.sort((a, b) => doneLast(a, b) || a.position - b.position);
  byColumn.week.sort(
    (a, b) =>
      doneLast(a, b) ||
      Number(Boolean(badgeFor(b)?.tone)) - Number(Boolean(badgeFor(a)?.tone)) ||
      (a.planned_day ?? "9999").localeCompare(b.planned_day ?? "9999") ||
      a.position - b.position,
  );
  byColumn.all.sort(
    (a, b) =>
      doneLast(a, b) ||
      (boardOrder.get(a.board_id) ?? 0) - (boardOrder.get(b.board_id) ?? 0) ||
      a.position - b.position,
  );

  // Week count for the limit, independent of filters.
  const weekPlanned = items.filter(
    (i) => boardsById.has(i.board_id) && !i.archived_at && i.planned_week === monday,
  ).length;
  const inboxOpen = inboxBoard
    ? items.filter((i) => i.board_id === inboxBoard.id && !i.archived_at && !isDone(i, columns))
        .length
    : 0;
  const filtering = Boolean(filters.text || filters.board || filters.status || filters.severity);
  const activeItem = activeId ? items.find((i) => i.id === activeId) : undefined;
  const openItem = openId ? items.find((i) => i.id === openId) : undefined;

  const closePanel = useCallback(() => setOpenId(null), []);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const item = items.find((i) => i.id === event.active.id);
    const target = event.over?.id as ColumnId | undefined;
    if (!item || !target || columnOf(item) === target) return;
    const labels: Record<ColumnId, string> = {
      all: "Poistettu suunnitelmasta",
      week: "Siirretty tälle viikolle",
      today: "Siirretty tälle päivälle",
    };
    void updateItem(item, planFor(target), `${labels[target]}: ${item.title}`);
  }

  function renderCards(list: FrontItem[]) {
    if (list.length === 0) {
      return (
        <li className="list-none px-2 py-6 text-center text-xs text-[#9997a5]">
          {filtering ? "Ei osumia suodattimilla." : "Ei tehtäviä. Raahaa tähän tai lisää +."}
        </li>
      );
    }
    return list.map((item) => (
      <DraggableCard
        key={item.id}
        item={item}
        board={boardsById.get(item.board_id)}
        columns={columns}
        busy={busyItems.has(item.id)}
        badge={badgeFor(item)}
        onToggle={toggleDone}
        onArchive={archiveItem}
        onOpen={(i) => setOpenId(i.id)}
      />
    ));
  }

  function addFormFor(column: ColumnId) {
    if (adding !== column) return undefined;
    return (
      <AddForm
        boards={boards}
        defaultBoardId={filters.board || defaultBoardId}
        onCreate={(title, boardId) => createItem(title, boardId, column)}
        onClose={() => setAdding(null)}
      />
    );
  }

  const selectClass =
    "h-9 rounded-lg border border-[#e4e3eb] bg-white px-2 text-sm text-[#29283a] outline-none focus:border-[#6c63ff]";

  return (
    <div className="min-h-screen bg-[#f7f7fa] text-[#29283a]">
      <AppTopBar />
      <main className="mx-auto w-full max-w-[1500px] px-4 py-5 md:px-7">
        <header className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Etusivu</h1>
            <p className="text-sm text-[#8b8998]">
              vko {isoWeekNumber(today)} · {weekdayFi(today)} {shortDateFi(today)}
            </p>
          </div>
          {inboxBoard && (
            <Link
              href={`/board?board=${inboxBoard.id}`}
              className="ml-auto inline-flex items-center gap-2 rounded-xl border border-[#e4e3eb] bg-white px-3 py-2 text-sm hover:border-[#6c63ff]"
            >
              <Inbox size={16} className="text-[#6c63ff]" />
              <span>
                <span className="font-bold">{inboxOpen}</span> Inboxissa
              </span>
              <ChevronRight size={14} className="text-[#9997a5]" />
            </Link>
          )}
        </header>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1 sm:max-w-72">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9997a5]"
            />
            <input
              className="h-9 w-full rounded-lg border border-[#e4e3eb] bg-white pl-8 pr-3 text-sm outline-none focus:border-[#6c63ff]"
              placeholder="Suodata…"
              value={filters.text}
              onChange={(event) => setFilters({ ...filters, text: event.target.value })}
            />
          </div>
          <select
            className={selectClass}
            value={filters.board}
            onChange={(event) => setFilters({ ...filters, board: event.target.value })}
            aria-label="Taulu"
          >
            <option value="">Kaikki taulut</option>
            {boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </select>
          <select
            className={selectClass}
            value={filters.status}
            onChange={(event) => setFilters({ ...filters, status: event.target.value })}
            aria-label="Status"
          >
            <option value="">Kaikki statukset</option>
            {statusLabels.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
          <select
            className={selectClass}
            value={filters.severity}
            onChange={(event) => setFilters({ ...filters, severity: event.target.value })}
            aria-label="Prioriteetti"
          >
            <option value="">Kaikki prioriteetit</option>
            {severityLabels.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium ${
              showDone
                ? "border-[#6c63ff] bg-[#f3f2ff] text-[#5148df]"
                : "border-[#e4e3eb] bg-white text-[#6e6c7d] hover:text-[#29283a]"
            }`}
          >
            {showDone ? <Eye size={14} /> : <EyeOff size={14} />}
            {showDone ? "Valmiit näkyvissä" : "Näytä valmiit"}
          </button>
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium ${
              showArchived
                ? "border-[#6c63ff] bg-[#f3f2ff] text-[#5148df]"
                : "border-[#e4e3eb] bg-white text-[#6e6c7d] hover:text-[#29283a]"
            }`}
          >
            <Archive size={14} />
            {showArchived ? "Arkistoidut näkyvissä" : "Näytä arkistoidut"}
          </button>
          {filtering && (
            <button
              type="button"
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-medium text-[#6c63ff] hover:bg-[#f3f2ff]"
            >
              <X size={14} /> Tyhjennä
            </button>
          )}
        </div>

        <DndContext
          id={dndId}
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div className="grid items-start gap-4 lg:grid-cols-3">
            <KanbanColumn
              id="all"
              title="Kaikki"
              count={String(byColumn.all.length)}
              className="order-3 lg:order-1"
              onAdd={() => setAdding(adding === "all" ? null : "all")}
              addForm={addFormFor("all")}
            >
              {renderCards(byColumn.all)}
            </KanbanColumn>
            <KanbanColumn
              id="week"
              title="Tämä viikko"
              subtitle={`${shortDateFi(monday)}–${shortDateFi(addDays(monday, 6))}`}
              count={`${weekPlanned}/${WEEK_ITEM_LIMIT}`}
              warn={weekPlanned > WEEK_ITEM_LIMIT}
              className="order-2"
              onAdd={() => setAdding(adding === "week" ? null : "week")}
              addForm={addFormFor("week")}
            >
              {renderCards(byColumn.week)}
            </KanbanColumn>
            <KanbanColumn
              id="today"
              title="Tänään"
              count={String(byColumn.today.length)}
              className="order-1 lg:order-3"
              onAdd={() => setAdding(adding === "today" ? null : "today")}
              addForm={addFormFor("today")}
            >
              {renderCards(byColumn.today)}
            </KanbanColumn>
          </div>
          <DragOverlay>
            {activeItem ? (
              <ItemCard
                item={activeItem}
                board={boardsById.get(activeItem.board_id)}
                columns={columns}
                busy={false}
                badge={badgeFor(activeItem)}
                onToggle={() => {}}
                onArchive={() => {}}
                dragging
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </main>

      {openItem && (
        <ItemPanel
          key={openItem.id}
          item={openItem}
          board={boardsById.get(openItem.board_id)}
          columns={columns}
          groups={groups}
          today={today}
          onPatch={(patch, label) => void updateItem(openItem, patch, label)}
          onArchive={(archived) => archiveItem(openItem, archived)}
          onDelete={() => void deleteItem(openItem)}
          onClose={closePanel}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-80 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl bg-[#29283a] px-4 py-3 text-sm text-white shadow-xl"
        >
          <span className="min-w-0 flex-1 truncate">{toast.message}</span>
          {toast.undoable && (
            <button
              onClick={() => void undoLast()}
              className="shrink-0 rounded-md px-2 py-0.5 font-semibold text-[#b9b4ff] hover:bg-white/10"
            >
              Kumoa <kbd className="ml-1 text-[11px] text-white/50">⌘Z</kbd>
            </button>
          )}
          <button
            onClick={() => setToast(null)}
            aria-label="Sulje"
            className="shrink-0 text-white/60 hover:text-white"
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Distinct option labels of every column with `role`, in first-seen order. */
function optionLabels(columns: FrontPageData["columns"], role: "status" | "severity") {
  const labels: string[] = [];
  for (const column of columns) {
    if (column.settings?.role !== role) continue;
    for (const option of column.settings.options ?? []) {
      if (!labels.includes(option.label)) labels.push(option.label);
    }
  }
  return labels;
}
