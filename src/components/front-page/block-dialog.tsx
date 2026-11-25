"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isDone, type PlanningColumn, type TimeBlockKind } from "@/lib/planning";
import {
  BLOCK_KIND_LABEL,
  BLOCK_KIND_STYLE,
  timeToMinutes,
  type BlockDraft,
  type FrontBoard,
} from "./types";

type ItemOption = {
  id: string;
  title: string;
  board_id: string;
  column_values: Record<string, unknown>;
};

const inputClass =
  "h-10 w-full rounded-xl border border-[#e4e3eb] bg-[#fafafd] px-3 text-sm outline-none focus:border-[#6c63ff]";
const labelClass = "mb-1 block text-xs font-semibold text-[#6e6c7d]";

export function BlockDialog({
  initial,
  boards,
  columns,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  initial: BlockDraft;
  boards: FrontBoard[];
  columns: PlanningColumn[];
  saving: boolean;
  onClose: () => void;
  onSave: (draft: BlockDraft) => void;
  onDelete: (blockId: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [boardItems, setBoardItems] = useState<{ boardId: string; items: ItemOption[] }>({
    boardId: "",
    items: [],
  });
  const editing = Boolean(initial.id);
  const invalid = timeToMinutes(draft.end) <= timeToMinutes(draft.start);

  useEffect(() => {
    if (!draft.board_id) return;
    const boardId = draft.board_id;
    let cancelled = false;
    createClient()
      .from("items")
      .select("id, title, board_id, column_values")
      .eq("board_id", boardId)
      .order("position")
      .limit(500)
      .then(({ data }) => {
        if (!cancelled) setBoardItems({ boardId, items: (data ?? []) as ItemOption[] });
      });
    return () => {
      cancelled = true;
    };
  }, [draft.board_id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const itemOptions =
    boardItems.boardId === draft.board_id
      ? boardItems.items.filter(
          (item) => item.id === draft.item_id || !isDone(item, columns),
        )
      : [];

  function update(patch: Partial<BlockDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (invalid || saving) return;
    onSave(draft);
  }

  return (
    <div className="fixed inset-0 z-70 grid place-items-center bg-[#17152f]/45 p-4 backdrop-blur-[2px]">
      <button className="absolute inset-0" onClick={onClose} aria-label="Sulje" />
      <form
        onSubmit={submit}
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#29283a]">
            {editing ? "Muokkaa aikablokkia" : "Uusi aikablokki"}
          </h2>
          <button
            type="button"
            className="rounded-lg p-1.5 text-[#8b8998] hover:bg-[#f2f2f7]"
            onClick={onClose}
            aria-label="Sulje"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="block-title">
              Otsikko
            </label>
            <input
              id="block-title"
              className={inputClass}
              value={draft.title}
              maxLength={240}
              autoFocus
              placeholder={BLOCK_KIND_LABEL[draft.kind]}
              onChange={(event) => update({ title: event.target.value })}
            />
          </div>

          <div>
            <span className={labelClass}>Tyyppi</span>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(BLOCK_KIND_LABEL) as TimeBlockKind[]).map((kind) => {
                const active = draft.kind === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                      active ? "text-white" : "border-[#e4e3eb] text-[#6e6c7d] hover:bg-[#f7f7fa]"
                    }`}
                    style={
                      active
                        ? {
                            backgroundColor: BLOCK_KIND_STYLE[kind].bg,
                            borderColor: BLOCK_KIND_STYLE[kind].border,
                          }
                        : undefined
                    }
                    onClick={() => update({ kind })}
                  >
                    {BLOCK_KIND_LABEL[kind]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelClass} htmlFor="block-date">
                Päivä
              </label>
              <input
                id="block-date"
                type="date"
                required
                className={inputClass}
                value={draft.date}
                onChange={(event) => update({ date: event.target.value })}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="block-start">
                Alkaa
              </label>
              <input
                id="block-start"
                type="time"
                step={900}
                required
                className={inputClass}
                value={draft.start}
                onChange={(event) => update({ start: event.target.value })}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="block-end">
                Päättyy
              </label>
              <input
                id="block-end"
                type="time"
                step={900}
                required
                className={inputClass}
                value={draft.end}
                onChange={(event) => update({ end: event.target.value })}
              />
            </div>
          </div>
          {invalid && (
            <p className="-mt-2 text-xs text-[#d83a52]">Päättymisajan pitää olla alkamisajan jälkeen.</p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="block-board">
                Taulu (valinnainen)
              </label>
              <select
                id="block-board"
                className={inputClass}
                value={draft.board_id ?? ""}
                onChange={(event) =>
                  update({ board_id: event.target.value || null, item_id: null })
                }
              >
                <option value="">—</option>
                {boards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="block-item">
                Tehtävä (valinnainen)
              </label>
              <select
                id="block-item"
                className={inputClass}
                value={draft.item_id ?? ""}
                disabled={!draft.board_id}
                onChange={(event) => update({ item_id: event.target.value || null })}
              >
                <option value="">—</option>
                {itemOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="block-note-before">
              Muistiinpano etukäteen
            </label>
            <textarea
              id="block-note-before"
              rows={2}
              className={`${inputClass} h-auto py-2`}
              value={draft.note_before}
              placeholder="Mitä tässä blokissa on tarkoitus tehdä?"
              onChange={(event) => update({ note_before: event.target.value })}
            />
          </div>

          {editing && (
            <div>
              <label className={labelClass} htmlFor="block-note-after">
                Muistiinpano jälkikäteen
              </label>
              <textarea
                id="block-note-after"
                rows={2}
                className={`${inputClass} h-auto py-2`}
                value={draft.note_after}
                placeholder="Mitä tuli tehtyä?"
                onChange={(event) => update({ note_after: event.target.value })}
              />
            </div>
          )}

          {editing && (
            <button
              type="button"
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${
                draft.done_at
                  ? "border-[#00a86b] bg-[#e8f7f0] text-[#00754b]"
                  : "border-[#e4e3eb] text-[#6e6c7d] hover:bg-[#f7f7fa]"
              }`}
              onClick={() =>
                update({ done_at: draft.done_at ? null : new Date().toISOString() })
              }
            >
              <Check size={15} />
              {draft.done_at ? "Käytetty (peru)" : "Merkitse käytetyksi"}
            </button>
          )}
        </div>

        <div className="mt-6 flex items-center gap-2">
          {editing && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-[#d83a52] hover:bg-[#fdeef0]"
              disabled={saving}
              onClick={() => initial.id && onDelete(initial.id)}
            >
              <Trash2 size={15} /> Poista
            </button>
          )}
          <button
            type="button"
            className="ml-auto rounded-lg px-4 py-2 text-sm font-semibold text-[#6e6c7d] hover:bg-[#f2f2f7]"
            onClick={onClose}
          >
            Peruuta
          </button>
          <button
            type="submit"
            disabled={invalid || saving}
            className="rounded-lg bg-[#6c63ff] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5a52e0] disabled:opacity-50"
          >
            {saving ? "Tallennetaan…" : "Tallenna"}
          </button>
        </div>
      </form>
    </div>
  );
}
