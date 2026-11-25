"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Loader2,
  X,
} from "lucide-react";
import { AppTopBar } from "@/components/app-top-bar";
import { createClient } from "@/lib/supabase/client";
import {
  IN_PROGRESS_LIMIT,
  WEEK_ITEM_LIMIT,
  addDays,
  blockHours,
  doneValuePatch,
  helsinkiDate,
  helsinkiTime,
  helsinkiToUtc,
  isDone,
  isoWeekNumber,
  weekRangeUtc,
  weekStart,
  type CalendarEvent,
  type SyncStatus,
  type TimeBlock,
} from "@/lib/planning";
import { BlockDialog } from "./block-dialog";
import { AddForToday, ItemRow, QuickAction } from "./item-list";
import { loadWeekItems, loadWeekSchedule } from "./queries";
import { TodayTimeline } from "./today-timeline";
import {
  ITEM_FIELDS,
  formatHours,
  isInboxBoard,
  isProductBoard,
  minutesToTime,
  shortDateFi,
  timeToMinutes,
  weekdayFi,
  type BlockDraft,
  type FrontItem,
  type FrontPageData,
} from "./types";
import { WeekStrip } from "./week-strip";

// ---------------------------------------------------------------------------
// Pure state helpers
// ---------------------------------------------------------------------------

function inWeek(iso: string, monday: string) {
  const { start, end } = weekRangeUtc(monday);
  const t = new Date(iso).getTime();
  return t >= new Date(start).getTime() && t < new Date(end).getTime();
}

/** Replace everything that starts in `monday`'s week with `incoming`. */
function mergeWeek<T extends { id: string; starts_at: string }>(
  current: T[],
  incoming: T[],
  monday: string,
): T[] {
  const ids = new Set(incoming.map((x) => x.id));
  return [
    ...current.filter((x) => !ids.has(x.id) && !inWeek(x.starts_at, monday)),
    ...incoming,
  ].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

function mergeItems(current: FrontItem[], incoming: FrontItem[]) {
  const map = new Map(current.map((i) => [i.id, i]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

function upsertBlock(current: TimeBlock[], block: TimeBlock) {
  return [...current.filter((b) => b.id !== block.id), block].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at),
  );
}

async function postJson(url: string, body: unknown) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function draftFromBlock(block: TimeBlock): BlockDraft {
  return {
    id: block.id,
    title: block.title,
    kind: block.kind,
    date: helsinkiDate(block.starts_at),
    start: helsinkiTime(block.starts_at),
    end: helsinkiTime(block.ends_at),
    board_id: block.board_id,
    item_id: block.item_id,
    note_before: block.note_before,
    note_after: block.note_after,
    done_at: block.done_at,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FrontPage({ data }: { data: FrontPageData }) {
  const supabase = useMemo(() => createClient(), []);
  const { today, columns, boards, groups, userId } = data;
  const currentMonday = weekStart(today);
  const lastMonday = addDays(currentMonday, -7);

  const [items, setItems] = useState(data.items);
  const [blocks, setBlocks] = useState(data.blocks);
  const [events, setEvents] = useState<CalendarEvent[]>(data.events);
  const [connected, setConnected] = useState(data.calendarConnected);
  const [refreshing, setRefreshing] = useState(true);
  const [viewMonday, setViewMonday] = useState(currentMonday);
  const [inboxOpenCount, setInboxOpenCount] = useState(data.inboxOpenCount);
  const [busyItems, setBusyItems] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ key: string; draft: BlockDraft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(data.loadError);

  const boardsById = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards]);
  const inboxBoard = boards.find(isInboxBoard);
  const inboxGroup = inboxBoard
    ? groups
        .filter((g) => g.board_id === inboxBoard.id)
        .sort((a, b) => a.position - b.position)[0]
    : undefined;

  // Calendar refresh for the viewed week; the page works without it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await postJson("/api/calendar/refresh", { week: viewMonday });
      if (cancelled) return;
      if (result && typeof result.connected === "boolean") setConnected(result.connected);
      const schedule = await loadWeekSchedule(supabase, viewMonday);
      if (cancelled) return;
      if (!schedule.error) {
        setBlocks((current) => mergeWeek(current, schedule.blocks, viewMonday));
        setEvents((current) => mergeWeek(current, schedule.events, viewMonday));
      }
      setRefreshing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, viewMonday]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 4000);
  }

  function goToWeek(monday: string) {
    setViewMonday(monday);
    setRefreshing(true);
    loadWeekSchedule(supabase, monday).then((schedule) => {
      if (schedule.error) return notify(schedule.error);
      setBlocks((current) => mergeWeek(current, schedule.blocks, monday));
      setEvents((current) => mergeWeek(current, schedule.events, monday));
    });
    loadWeekItems(supabase, monday).then(({ data: loaded, error }) => {
      if (error) return notify(error);
      setItems((current) => mergeItems(current, loaded));
    });
  }

  // -------------------------------------------------------------------------
  // Items
  // -------------------------------------------------------------------------

  async function updateItem(item: FrontItem, patch: Partial<FrontItem>) {
    setBusyItems((s) => new Set(s).add(item.id));
    const { data: row, error } = await supabase
      .from("items")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .select(ITEM_FIELDS)
      .single();
    setBusyItems((s) => {
      const next = new Set(s);
      next.delete(item.id);
      return next;
    });
    if (error || !row) {
      notify(error?.message ?? "Tallennus epäonnistui");
      return null;
    }
    const saved = row as FrontItem;
    setItems((current) => current.map((i) => (i.id === saved.id ? saved : i)));
    return saved;
  }

  async function toggleDone(item: FrontItem, done: boolean) {
    const patch = doneValuePatch(item, columns, done);
    if (!patch) return notify("Taululla ei ole Status-saraketta");
    const wasDone = isDone(item, columns);
    const saved = await updateItem(item, { column_values: patch });
    if (saved && inboxBoard && saved.board_id === inboxBoard.id) {
      const nowDone = isDone(saved, columns);
      if (nowDone !== wasDone) setInboxOpenCount((n) => n + (nowDone ? -1 : 1));
    }
  }

  async function quickAdd(title: string) {
    if (!inboxBoard || !inboxGroup) {
      notify("Inbox-taulua ei löytynyt");
      return false;
    }
    const { data: last } = await supabase
      .from("items")
      .select("position")
      .eq("group_id", inboxGroup.id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const columnValues =
      doneValuePatch({ board_id: inboxBoard.id, column_values: {} }, columns, false) ?? {};
    const { data: row, error } = await supabase
      .from("items")
      .insert({
        title,
        board_id: inboxBoard.id,
        group_id: inboxGroup.id,
        owner_id: userId,
        position: ((last?.position as number | undefined) ?? -1) + 1,
        column_values: columnValues,
        planned_day: today,
      })
      .select(ITEM_FIELDS)
      .single();
    if (error || !row) {
      notify(error?.message ?? "Lisäys epäonnistui");
      return false;
    }
    setItems((current) => [...current, row as FrontItem]);
    setInboxOpenCount((n) => n + 1);
    return true;
  }

  // -------------------------------------------------------------------------
  // Blocks
  // -------------------------------------------------------------------------

  const pendingStatus: SyncStatus = connected ? "pending" : "local";

  async function pushBlock(blockId: string) {
    const result = await postJson("/api/calendar/blocks/push", { blockId });
    const status = result?.sync_status;
    if (typeof status === "string") {
      setBlocks((current) =>
        current.map((b) =>
          b.id === blockId ? { ...b, sync_status: status as SyncStatus } : b,
        ),
      );
    }
  }

  function openCreate(day: string, startMin: number) {
    const start = Math.min(startMin, 23 * 60);
    setDialog({
      key: `new-${day}-${start}-${Date.now()}`,
      draft: {
        title: "",
        kind: "focus",
        date: day,
        start: minutesToTime(start),
        end: minutesToTime(Math.min(start + 60, 24 * 60 - 1)),
        board_id: null,
        item_id: null,
        note_before: "",
        note_after: "",
        done_at: null,
      },
    });
  }

  function openEdit(block: TimeBlock) {
    setDialog({ key: block.id, draft: draftFromBlock(block) });
  }

  async function saveBlock(draft: BlockDraft) {
    setSaving(true);
    const row = {
      title: draft.title.trim(),
      kind: draft.kind,
      starts_at: helsinkiToUtc(draft.date, draft.start).toISOString(),
      ends_at: helsinkiToUtc(draft.date, draft.end).toISOString(),
      board_id: draft.board_id,
      item_id: draft.item_id,
      note_before: draft.note_before,
      note_after: draft.note_after,
      done_at: draft.done_at,
      sync_status: pendingStatus,
      updated_at: new Date().toISOString(),
    };
    const query = draft.id
      ? supabase.from("time_blocks").update(row).eq("id", draft.id)
      : supabase.from("time_blocks").insert({ ...row, owner_id: userId });
    const { data: saved, error } = await query.select().single();
    setSaving(false);
    if (error || !saved) return notify(error?.message ?? "Tallennus epäonnistui");
    setBlocks((current) => upsertBlock(current, saved as TimeBlock));
    setDialog(null);
    void pushBlock((saved as TimeBlock).id);
  }

  async function moveBlock(block: TimeBlock, day: string, deltaMin: number) {
    const durationMs =
      new Date(block.ends_at).getTime() - new Date(block.starts_at).getTime();
    const durationMin = Math.round(durationMs / 60000);
    const startMin = Math.max(
      0,
      Math.min(24 * 60 - durationMin, timeToMinutes(helsinkiTime(block.starts_at)) + deltaMin),
    );
    const start = helsinkiToUtc(day, minutesToTime(startMin));
    const starts_at = start.toISOString();
    const ends_at = new Date(start.getTime() + durationMs).toISOString();
    if (starts_at === new Date(block.starts_at).toISOString()) return;

    const optimistic = { ...block, starts_at, ends_at, sync_status: pendingStatus };
    setBlocks((current) => upsertBlock(current, optimistic));
    const { data: saved, error } = await supabase
      .from("time_blocks")
      .update({ starts_at, ends_at, sync_status: pendingStatus, updated_at: new Date().toISOString() })
      .eq("id", block.id)
      .select()
      .single();
    if (error || !saved) {
      setBlocks((current) => upsertBlock(current, block));
      return notify(error?.message ?? "Siirto epäonnistui");
    }
    setBlocks((current) => upsertBlock(current, saved as TimeBlock));
    void pushBlock(block.id);
  }

  async function deleteBlock(blockId: string) {
    setSaving(true);
    const result = await postJson("/api/calendar/blocks/remove", { blockId });
    if (!result?.ok) {
      // Endpoint unavailable: remove the row directly so the page still works.
      const { error } = await supabase.from("time_blocks").delete().eq("id", blockId);
      if (error) {
        setSaving(false);
        return notify(error.message);
      }
    }
    setSaving(false);
    setBlocks((current) => current.filter((b) => b.id !== blockId));
    setDialog(null);
  }

  // -------------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------------

  const todayItems = items.filter((i) => i.planned_day === today);
  const leftovers = items.filter(
    (i) =>
      !isDone(i, columns) &&
      i.planned_day !== today &&
      ((i.planned_day !== null && i.planned_day < today && i.planned_day >= currentMonday) ||
        i.planned_week === lastMonday),
  );
  const pullCandidates = items.filter(
    (i) => i.planned_week === currentMonday && i.planned_day !== today && !isDone(i, columns),
  );
  const weekList = items.filter((i) => i.planned_week === viewMonday);
  const weekBlocks = blocks.filter((b) => inWeek(b.starts_at, viewMonday));
  const weekEvents = events.filter(
    (e) =>
      new Date(e.ends_at).getTime() > new Date(weekRangeUtc(viewMonday).start).getTime() &&
      new Date(e.starts_at).getTime() < new Date(weekRangeUtc(viewMonday).end).getTime(),
  );
  const freeCoding = weekBlocks.filter((b) => b.kind === "free_coding");
  const freeTotal = freeCoding.reduce((sum, b) => sum + blockHours(b), 0);
  const freeUsed = freeCoding
    .filter((b) => b.done_at)
    .reduce((sum, b) => sum + blockHours(b), 0);
  const productBoards = boards.filter(isProductBoard);
  const isCurrentWeek = viewMonday === currentMonday;
  const viewWeekNumber = isoWeekNumber(viewMonday);

  return (
    <div className="min-h-screen bg-[#f7f7fa] text-[#29283a]">
      <AppTopBar />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-7">
        <header className="mb-6 flex flex-wrap items-end gap-x-4 gap-y-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Etusivu</h1>
            <p className="text-sm text-[#8b8998]">
              vko {isoWeekNumber(today)} · {weekdayFi(today)} {shortDateFi(today)}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-[#8b8998]">
            {refreshing && (
              <span className="inline-flex items-center gap-1">
                <Loader2 size={13} className="animate-spin" /> Päivitetään kalenteria…
              </span>
            )}
            {connected ? (
              <Link
                href="/settings/calendar"
                className="inline-flex items-center gap-1 hover:text-[#29283a]"
              >
                <CalendarDays size={14} /> Google Kalenteri
              </Link>
            ) : (
              <Link
                href="/settings/calendar"
                className="inline-flex items-center gap-1 text-[#6c63ff] hover:underline"
              >
                <CalendarDays size={14} /> Yhdistä Google Kalenteri
              </Link>
            )}
          </div>
        </header>

        {/* ------------------------------------------------------------ */}
        <SectionTitle>Tänään</SectionTitle>
        <div className="mb-8 grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <Card title="Aikataulu">
            <TodayTimeline
              day={today}
              blocks={blocks}
              events={events}
              boardsById={boardsById}
              onCreate={openCreate}
              onEdit={openEdit}
            />
          </Card>

          <Card title="Tehtävät" aside={`${todayItems.filter((i) => isDone(i, columns)).length}/${todayItems.length}`}>
            {todayItems.length === 0 ? (
              <p className="px-2 text-sm text-[#9997a5]">Ei tehtäviä tälle päivälle.</p>
            ) : (
              <ul className="space-y-0.5">
                {todayItems.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    board={boardsById.get(item.board_id)}
                    columns={columns}
                    busy={busyItems.has(item.id)}
                    onToggle={toggleDone}
                  />
                ))}
              </ul>
            )}

            <AddForToday
              candidates={pullCandidates}
              boardsById={boardsById}
              canQuickAdd={Boolean(inboxBoard && inboxGroup)}
              onPull={(item) => updateItem(item, { planned_day: today })}
              onQuickAdd={quickAdd}
            />

            {leftovers.length > 0 && (
              <div className="mt-5">
                <h3 className="mb-1 px-2 text-xs font-bold uppercase tracking-wide text-[#c27c0e]">
                  Jäänyt aiemmin ({leftovers.length})
                </h3>
                <ul className="space-y-0.5">
                  {leftovers.map((item) => {
                    const busy = busyItems.has(item.id);
                    return (
                      <ItemRow
                        key={item.id}
                        item={item}
                        board={boardsById.get(item.board_id)}
                        columns={columns}
                        busy={busy}
                        onToggle={toggleDone}
                        actions={
                          <>
                            <QuickAction
                              disabled={busy}
                              onClick={() => updateItem(item, { planned_day: today })}
                            >
                              Tänään
                            </QuickAction>
                            <QuickAction
                              disabled={busy}
                              onClick={() =>
                                updateItem(item, {
                                  planned_day: null,
                                  planned_week: currentMonday,
                                })
                              }
                            >
                              Tälle viikolle
                            </QuickAction>
                            <QuickAction
                              disabled={busy}
                              onClick={() =>
                                updateItem(item, { planned_day: null, planned_week: null })
                              }
                            >
                              Poista
                            </QuickAction>
                          </>
                        }
                      />
                    );
                  })}
                </ul>
              </div>
            )}
          </Card>
        </div>

        {/* ------------------------------------------------------------ */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SectionTitle inline>
            {isCurrentWeek ? "Tämä viikko" : `Viikko ${viewWeekNumber}`}
          </SectionTitle>
          <span className="text-xs text-[#9997a5]">
            {shortDateFi(viewMonday)}–{shortDateFi(addDays(viewMonday, 6))}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {!isCurrentWeek && (
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-xs font-semibold text-[#6c63ff] hover:bg-[#f3f2ff]"
                onClick={() => goToWeek(currentMonday)}
              >
                Tämä viikko
              </button>
            )}
            <button
              type="button"
              className="rounded-lg p-1.5 text-[#6e6c7d] hover:bg-white"
              aria-label="Edellinen viikko"
              onClick={() => goToWeek(addDays(viewMonday, -7))}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              className="rounded-lg p-1.5 text-[#6e6c7d] hover:bg-white"
              aria-label="Seuraava viikko"
              onClick={() => goToWeek(addDays(viewMonday, 7))}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        <Card className="mb-5">
          <WeekStrip
            monday={viewMonday}
            today={today}
            blocks={weekBlocks}
            events={weekEvents}
            onCreate={openCreate}
            onEdit={openEdit}
            onMove={moveBlock}
          />
          <p className="mt-2 text-[11px] text-[#9997a5]">
            Klikkaa tyhjää kohtaa lisätäksesi blokin, raahaa blokkia siirtääksesi sitä (30 min välein).
          </p>
        </Card>

        <div className="grid gap-5 lg:grid-cols-3">
          <Card
            title="Viikon lista"
            aside={`${weekList.length}/${WEEK_ITEM_LIMIT}`}
            warn={weekList.length > WEEK_ITEM_LIMIT}
          >
            {weekList.length > WEEK_ITEM_LIMIT && (
              <p className="mb-2 flex items-center gap-1.5 rounded-lg bg-[#fff4e5] px-2 py-1.5 text-xs font-medium text-[#a35f00]">
                <AlertTriangle size={14} /> Yli {WEEK_ITEM_LIMIT} tehtävää tälle viikolle.
              </p>
            )}
            {weekList.length === 0 ? (
              <p className="px-2 text-sm text-[#9997a5]">Viikon listalla ei ole tehtäviä.</p>
            ) : (
              <ul className="space-y-0.5">
                {[...weekList]
                  .sort((a, b) => Number(isDone(a, columns)) - Number(isDone(b, columns)))
                  .map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      board={boardsById.get(item.board_id)}
                      columns={columns}
                      busy={busyItems.has(item.id)}
                      onToggle={toggleDone}
                    />
                  ))}
              </ul>
            )}
          </Card>

          <Card title="Koodi tällä viikolla">
            <div className="mb-4 rounded-xl bg-[#e8f7f0] px-3 py-2.5">
              <div className="text-xs font-semibold text-[#00754b]">Vapaat sessiot</div>
              <div className="text-lg font-bold text-[#004d32]">
                {formatHours(freeUsed)} / {formatHours(freeTotal)}{" "}
                <span className="text-sm font-medium">käytetty</span>
              </div>
            </div>
            {productBoards.length === 0 ? (
              <p className="text-sm text-[#9997a5]">Ei tuotetauluja.</p>
            ) : (
              <ul className="space-y-2">
                {productBoards.map((board) => {
                  const inProgress = data.inProgressByBoard[board.id] ?? 0;
                  const over = inProgress > IN_PROGRESS_LIMIT;
                  const boardBlocks = freeCoding.filter((b) => b.board_id === board.id);
                  return (
                    <li key={board.id} className="flex items-center gap-2 text-sm">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: board.color }}
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">{board.name}</span>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                          over ? "bg-[#fdeef0] text-[#d83a52]" : "bg-[#f2f2f7] text-[#6e6c7d]"
                        }`}
                        title={`Kesken (raja ${IN_PROGRESS_LIMIT})`}
                      >
                        {over && <AlertTriangle size={11} className="mr-0.5 inline" />}
                        {inProgress} kesken
                      </span>
                      <span className="w-20 text-right text-xs text-[#6e6c7d]">
                        {formatBlockHours(boardBlocks)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Inbox">
            {inboxBoard ? (
              <Link
                href={`/board?board=${inboxBoard.id}`}
                className="flex items-center gap-3 rounded-xl border border-[#e4e3eb] px-3 py-3 hover:border-[#6c63ff]"
              >
                <Inbox size={20} className="text-[#6c63ff]" />
                <span className="text-sm">
                  <span className="text-lg font-bold">{inboxOpenCount}</span> käsittelemättä
                </span>
                <ChevronRight size={16} className="ml-auto text-[#9997a5]" />
              </Link>
            ) : (
              <p className="text-sm text-[#9997a5]">Inbox-taulua ei löytynyt.</p>
            )}
          </Card>
        </div>
      </main>

      {dialog && (
        <BlockDialog
          key={dialog.key}
          initial={dialog.draft}
          boards={boards}
          columns={columns}
          saving={saving}
          onClose={() => setDialog(null)}
          onSave={saveBlock}
          onDelete={deleteBlock}
        />
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-80 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl bg-[#29283a] px-4 py-3 text-sm text-white shadow-xl">
          <span className="min-w-0 flex-1">{toast}</span>
          <button onClick={() => setToast(null)} aria-label="Sulje" className="text-white/60 hover:text-white">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

/** "2 × 3 h" when all blocks are the same length, otherwise "3 kpl · 7 h". */
function formatBlockHours(blocks: TimeBlock[]) {
  if (blocks.length === 0) return "—";
  const hours = blocks.map(blockHours);
  if (hours.every((h) => h === hours[0])) return `${blocks.length} × ${formatHours(hours[0])}`;
  return `${blocks.length} kpl · ${formatHours(hours.reduce((a, b) => a + b, 0))}`;
}

function SectionTitle({ children, inline }: { children: React.ReactNode; inline?: boolean }) {
  return (
    <h2
      className={`text-xs font-bold uppercase tracking-[0.12em] text-[#8b8998] ${inline ? "" : "mb-3"}`}
    >
      {children}
    </h2>
  );
}

function Card({
  title,
  aside,
  warn,
  className = "",
  children,
}: {
  title?: string;
  aside?: string;
  warn?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`min-w-0 rounded-2xl border border-[#e5e5ec] bg-white p-4 shadow-[0_1px_2px_rgba(20,20,50,0.04)] md:p-5 ${className}`}
    >
      {title && (
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-bold">{title}</h3>
          {aside && (
            <span
              className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                warn ? "bg-[#fff4e5] text-[#a35f00]" : "bg-[#f2f2f7] text-[#6e6c7d]"
              }`}
            >
              {aside}
            </span>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
