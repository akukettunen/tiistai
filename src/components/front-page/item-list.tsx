"use client";

import { useState, type FormEvent } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Archive, ArchiveRestore, Check, Plus, X } from "lucide-react";
import { dueDate, isDone, roleOption, type PlanningColumn } from "@/lib/planning";
import { shortDateFi, type FrontBoard, type FrontItem } from "./types";

export type ColumnId = "all" | "week" | "today";

type CardProps = {
  item: FrontItem;
  board: FrontBoard | undefined;
  columns: PlanningColumn[];
  busy: boolean;
  badge?: { text: string; tone?: "warn" | "muted" };
  onToggle: (item: FrontItem, done: boolean) => void;
  onArchive: (item: FrontItem, archived: boolean) => void;
  onOpen?: (item: FrontItem) => void;
};

/** Visual card, shared by the draggable card and the drag overlay. */
export function ItemCard({
  item,
  board,
  columns,
  busy,
  badge,
  onToggle,
  onArchive,
  dragging = false,
}: CardProps & { dragging?: boolean }) {
  const done = isDone(item, columns);
  const status = roleOption(item, columns, "status");
  const severity = roleOption(item, columns, "severity");
  const due = dueDate(item, columns);
  const archived = Boolean(item.archived_at);
  return (
    <div
      className={`group/card flex items-start gap-2.5 rounded-xl border bg-white px-3 py-2.5 ${
        archived ? "opacity-60" : ""
      } ${
        dragging
          ? "rotate-1 border-[#6c63ff] shadow-xl"
          : "border-[#e8e8ef] shadow-[0_1px_2px_rgba(20,20,50,0.04)] hover:border-[#cfcde0]"
      }`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? "Merkitse keskeneräiseksi" : "Merkitse valmiiksi"}
        disabled={busy}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(item, !done);
        }}
        className={`mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-md border transition-colors disabled:opacity-50 ${
          done
            ? "border-[#00a86b] bg-[#00a86b] text-white"
            : "border-[#c9c7d6] bg-white hover:border-[#6c63ff]"
        }`}
      >
        {done && <Check size={12} strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`line-clamp-2 text-sm leading-snug ${
            done ? "text-[#9997a5] line-through" : "font-medium text-[#29283a]"
          }`}
          title={item.title}
        >
          {item.title || "(nimetön)"}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          {board && (
            <span className="inline-flex max-w-36 items-center gap-1 truncate text-[#6e6c7d]">
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: board.color }} />
              <span className="truncate">{board.name}</span>
            </span>
          )}
          {status && (
            <span
              className="rounded px-1.5 py-px font-semibold text-white"
              style={{ backgroundColor: status.color }}
            >
              {status.label}
            </span>
          )}
          {severity && (
            <span
              className="rounded border px-1.5 py-px font-semibold"
              style={{ borderColor: severity.color, color: severity.color }}
            >
              {severity.label}
            </span>
          )}
          {due && <span className="text-[#6e6c7d]">DL {shortDateFi(due)}</span>}
          {archived && (
            <span className="rounded bg-[#f2f2f7] px-1.5 py-px font-semibold text-[#6e6c7d]">
              arkistoitu
            </span>
          )}
          {badge && (
            <span
              className={`rounded px-1.5 py-px font-semibold ${
                badge.tone === "warn"
                  ? "bg-[#fff4e5] text-[#a35f00]"
                  : "bg-[#f2f2f7] text-[#6e6c7d]"
              }`}
            >
              {badge.text}
            </span>
          )}
        </div>
      </div>
      {!dragging && (
        <button
          type="button"
          disabled={busy}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onArchive(item, !archived);
          }}
          aria-label={archived ? "Palauta arkistosta" : "Arkistoi"}
          title={archived ? "Palauta arkistosta" : "Arkistoi"}
          className={`-mr-1 -mt-0.5 grid size-7 shrink-0 place-items-center rounded-md text-[#9997a5] hover:bg-[#f2f2f7] hover:text-[#29283a] disabled:opacity-50 ${
            archived ? "" : "sm:opacity-0 sm:group-hover/card:opacity-100 sm:focus-visible:opacity-100"
          }`}
        >
          {archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
        </button>
      )}
    </div>
  );
}

export function DraggableCard(props: CardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: props.item.id,
  });
  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => props.onOpen?.(props.item)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === "Enter") props.onOpen?.(props.item);
      }}
      className={`cursor-grab list-none outline-none focus-visible:ring-2 focus-visible:ring-[#6c63ff] rounded-xl ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <ItemCard {...props} />
    </li>
  );
}

export function KanbanColumn({
  id,
  title,
  subtitle,
  count,
  warn,
  className = "",
  onAdd,
  addForm,
  children,
}: {
  id: ColumnId;
  title: string;
  subtitle?: string;
  count: string;
  warn?: boolean;
  className?: string;
  onAdd: () => void;
  addForm?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      className={`flex min-w-0 flex-col rounded-2xl border p-3 transition-colors lg:max-h-[calc(100vh-13rem)] ${
        isOver ? "border-[#6c63ff] bg-[#f3f2ff]" : "border-[#e5e5ec] bg-[#efeff4]"
      } ${className}`}
    >
      <header className="mb-2 flex items-center gap-2 px-1">
        <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-[#4a4858]">{title}</h2>
        {subtitle && <span className="text-[11px] text-[#9997a5]">{subtitle}</span>}
        <span
          className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
            warn ? "bg-[#fff4e5] text-[#a35f00]" : "bg-white text-[#6e6c7d]"
          }`}
        >
          {count}
        </span>
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Lisää: ${title}`}
          className="ml-auto grid size-7 place-items-center rounded-lg text-[#6c63ff] hover:bg-white"
        >
          <Plus size={17} />
        </button>
      </header>
      {addForm}
      <ul className="min-h-24 flex-1 space-y-2 overflow-y-auto px-0.5 pb-1">{children}</ul>
    </section>
  );
}

export function AddForm({
  boards,
  defaultBoardId,
  onCreate,
  onClose,
}: {
  boards: FrontBoard[];
  defaultBoardId: string;
  onCreate: (title: string, boardId: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [boardId, setBoardId] = useState(defaultBoardId);
  const [adding, setAdding] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (!value || adding || !boardId) return;
    setAdding(true);
    const ok = await onCreate(value, boardId);
    setAdding(false);
    if (ok) setTitle("");
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      className="mb-2 rounded-xl border border-[#6c63ff] bg-white p-2 shadow-sm"
    >
      <input
        className="mb-2 h-8 w-full rounded-md px-1.5 text-sm outline-none"
        placeholder="Uusi tehtävä…"
        value={title}
        autoFocus
        onChange={(event) => setTitle(event.target.value)}
      />
      <div className="flex items-center gap-1.5">
        <select
          className="h-8 min-w-0 flex-1 rounded-md border border-[#e4e3eb] bg-white px-1.5 text-xs outline-none focus:border-[#6c63ff]"
          value={boardId}
          onChange={(event) => setBoardId(event.target.value)}
          aria-label="Taulu"
        >
          {boards.map((board) => (
            <option key={board.id} value={board.id}>
              {board.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!title.trim() || adding || !boardId}
          className="h-8 rounded-md bg-[#6c63ff] px-3 text-xs font-semibold text-white hover:bg-[#5a52e0] disabled:opacity-50"
        >
          Lisää
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Sulje"
          className="grid size-8 place-items-center rounded-md text-[#8b8998] hover:bg-[#f2f2f7]"
        >
          <X size={14} />
        </button>
      </div>
    </form>
  );
}
