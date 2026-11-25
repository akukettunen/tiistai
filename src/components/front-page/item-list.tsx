"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Check, Plus, X } from "lucide-react";
import {
  isDone,
  statusOption,
  type PlanningColumn,
} from "@/lib/planning";
import type { FrontBoard, FrontItem } from "./types";

export function ItemRow({
  item,
  board,
  columns,
  busy,
  onToggle,
  actions,
}: {
  item: FrontItem;
  board: FrontBoard | undefined;
  columns: PlanningColumn[];
  busy: boolean;
  onToggle: (item: FrontItem, done: boolean) => void;
  actions?: ReactNode;
}) {
  const done = isDone(item, columns);
  const status = statusOption(item, columns);
  return (
    <li className="group flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl px-2 py-2 hover:bg-[#f7f7fa]">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? "Merkitse keskeneräiseksi" : "Merkitse valmiiksi"}
        disabled={busy}
        onClick={() => onToggle(item, !done)}
        className={`grid size-5 shrink-0 place-items-center rounded-md border transition-colors disabled:opacity-50 ${
          done
            ? "border-[#00a86b] bg-[#00a86b] text-white"
            : "border-[#c9c7d6] bg-white hover:border-[#6c63ff]"
        }`}
      >
        {done && <Check size={13} strokeWidth={3} />}
      </button>
      <span
        className={`min-w-0 flex-1 truncate text-sm ${
          done ? "text-[#9997a5] line-through" : "font-medium text-[#29283a]"
        }`}
        title={item.title}
      >
        {item.title || "(nimetön)"}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {board && (
          <span className="inline-flex max-w-32 items-center gap-1.5 truncate text-xs text-[#6e6c7d]">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: board.color }}
            />
            <span className="truncate">{board.name}</span>
          </span>
        )}
        {status && (
          <span
            className="rounded-md px-2 py-0.5 text-[11px] font-semibold text-white"
            style={{ backgroundColor: status.color }}
          >
            {status.label}
          </span>
        )}
      </span>
      {actions && <span className="flex w-full items-center gap-1 pl-8 sm:w-auto sm:pl-0">{actions}</span>}
    </li>
  );
}

export function QuickAction({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-[#e4e3eb] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#6e6c7d] hover:border-[#6c63ff] hover:text-[#6c63ff] disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** "+ Lisää tälle päivälle": pull from the week list, or quick-add to Inbox. */
export function AddForToday({
  candidates,
  boardsById,
  canQuickAdd,
  onPull,
  onQuickAdd,
}: {
  candidates: FrontItem[];
  boardsById: Map<string, FrontBoard>;
  canQuickAdd: boolean;
  onPull: (item: FrontItem) => void;
  onQuickAdd: (title: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (!value || adding) return;
    setAdding(true);
    const ok = await onQuickAdd(value);
    setAdding(false);
    if (ok) setTitle("");
  }

  if (!open) {
    return (
      <button
        type="button"
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-[#6c63ff] hover:bg-[#f3f2ff]"
        onClick={() => setOpen(true)}
      >
        <Plus size={16} /> Lisää tälle päivälle
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-[#e4e3eb] bg-[#fafafd] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-[#8b8998]">
          Lisää tälle päivälle
        </span>
        <button
          type="button"
          className="rounded-md p-1 text-[#8b8998] hover:bg-[#eeeef4]"
          onClick={() => setOpen(false)}
          aria-label="Sulje"
        >
          <X size={14} />
        </button>
      </div>
      {canQuickAdd && (
        <form onSubmit={submit} className="mb-3 flex gap-2">
          <input
            className="h-9 min-w-0 flex-1 rounded-lg border border-[#e4e3eb] bg-white px-3 text-sm outline-none focus:border-[#6c63ff]"
            placeholder="Uusi tehtävä Inboxiin tälle päivälle…"
            value={title}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
          />
          <button
            type="submit"
            disabled={!title.trim() || adding}
            className="rounded-lg bg-[#6c63ff] px-3 text-sm font-semibold text-white hover:bg-[#5a52e0] disabled:opacity-50"
          >
            Lisää
          </button>
        </form>
      )}
      {candidates.length > 0 ? (
        <>
          <p className="mb-1 text-xs text-[#8b8998]">Viikon listalta:</p>
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {candidates.map((item) => {
              const board = boardsById.get(item.board_id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white"
                    onClick={() => onPull(item)}
                  >
                    <Plus size={14} className="shrink-0 text-[#6c63ff]" />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {board && (
                      <span className="inline-flex items-center gap-1 text-xs text-[#8b8998]">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: board.color }}
                        />
                        {board.name}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="text-xs text-[#9997a5]">Viikon listalla ei ole muita avoimia tehtäviä.</p>
      )}
    </div>
  );
}
