"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, Check, Trash2, X } from "lucide-react";
import { weekStart, type LabelOption, type PlanningColumn } from "@/lib/planning";
import { shortDateFi, weekdayFi, type FrontBoard, type FrontGroup, type FrontItem } from "./types";

export type PanelPatch = Partial<
  Pick<
    FrontItem,
    "title" | "group_id" | "column_values" | "planned_day" | "planned_week" | "archived_at"
  >
>;

type Plan = "none" | "week" | "today";

/**
 * Dialog showing one item's data. Click a value to edit it; every change saves immediately.
 * (Kept as `ItemPanel` so callers don't change.)
 */
export function ItemPanel({
  item,
  board,
  columns,
  groups,
  today,
  onPatch,
  onArchive,
  onDelete,
  onClose,
}: {
  item: FrontItem;
  board: FrontBoard | undefined;
  columns: PlanningColumn[];
  groups: FrontGroup[];
  today: string;
  onPatch: (patch: PanelPatch, label: string) => void;
  onArchive: (archived: boolean) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const monday = weekStart(today);
  const archived = Boolean(item.archived_at);
  const plan: Plan =
    item.planned_day === today ? "today" : item.planned_week === monday ? "week" : "none";
  const boardColumns = columns
    .filter((c) => c.board_id === item.board_id)
    .sort((a, b) => a.position - b.position);
  const boardGroups = groups
    .filter((g) => g.board_id === item.board_id)
    .sort((a, b) => a.position - b.position);
  const group = boardGroups.find((g) => g.id === item.group_id);

  // Esc closes the dialog (fields stop Esc themselves while editing).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function setValue(column: PlanningColumn, value: unknown) {
    const next = value === "" || value === undefined ? null : value;
    if (next === (item.column_values?.[column.id] ?? null)) return;
    onPatch(
      { column_values: { ...item.column_values, [column.id]: next } },
      `${column.title} muutettu: ${item.title}`,
    );
  }

  function setPlan(next: Plan) {
    if (next === plan) return;
    const patch: PanelPatch =
      next === "today"
        ? { planned_day: today, planned_week: monday }
        : next === "week"
          ? { planned_day: null, planned_week: monday }
          : { planned_day: null, planned_week: null };
    onPatch(patch, `Suunnitelma muutettu: ${item.title}`);
  }

  return (
    <div className="fixed inset-0 z-60 grid place-items-center overflow-y-auto bg-[#17152f]/35 p-4">
      <button className="fixed inset-0 cursor-default" onClick={onClose} aria-label="Sulje" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        className="relative w-full max-w-xl rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-[#ecebf1] px-5 py-3">
          {board && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6e6c7d]">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: board.color }} />
              {board.name}
              {group && <span className="font-normal text-[#9997a5]">/ {group.name}</span>}
            </span>
          )}
          {archived && (
            <span className="rounded bg-[#f2f2f7] px-1.5 py-px text-[11px] font-semibold text-[#6e6c7d]">
              arkistoitu
            </span>
          )}
          <button
            className="ml-auto rounded-lg p-1.5 text-[#6e6c7d] hover:bg-[#f2f2f6]"
            onClick={onClose}
            aria-label="Sulje"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pb-2 pt-4">
          <EditableText
            value={item.title}
            multiline={false}
            required
            display={(v) => <h2 className="text-xl font-semibold leading-7">{v}</h2>}
            inputClass="w-full rounded-lg border border-[#6c63ff] px-2 py-1 text-xl font-semibold leading-7 outline-none"
            onSave={(title) => onPatch({ title }, `Otsikko muutettu: ${title}`)}
          />
        </div>

        <dl className="divide-y divide-[#f0f0f5] px-5 pb-3">
          <Row label="Suunnitelma">
            <div className="inline-grid grid-cols-3 gap-1 rounded-lg bg-[#f2f2f7] p-0.5">
              {(
                [
                  ["none", "Ei"],
                  ["week", "Tämä viikko"],
                  ["today", "Tänään"],
                ] as const
              ).map(([value, text]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPlan(value)}
                  className={`h-7 rounded-md px-2.5 text-xs font-semibold ${
                    plan === value
                      ? "bg-white text-[#29283a] shadow-sm"
                      : "text-[#6e6c7d] hover:text-[#29283a]"
                  }`}
                >
                  {text}
                </button>
              ))}
            </div>
          </Row>

          <Row label="Päivä">
            <EditableDate
              value={item.planned_day}
              onSave={(day) =>
                onPatch(
                  day ? { planned_day: day, planned_week: weekStart(day) } : { planned_day: null },
                  `Päivä muutettu: ${item.title}`,
                )
              }
            />
          </Row>

          {boardGroups.length > 1 && (
            <Row label="Ryhmä">
              <EditableChoice
                value={item.group_id}
                options={boardGroups.map((g) => ({ id: g.id, label: g.name, color: "#8b8998" }))}
                plain
                allowEmpty={false}
                onSave={(id) => id && onPatch({ group_id: id }, `Ryhmä muutettu: ${item.title}`)}
              />
            </Row>
          )}

          {boardColumns.map((column) => {
            const value = item.column_values?.[column.id];
            return (
              <Row key={column.id} label={column.title} top={column.type === "long_text"}>
                {column.type === "label" ? (
                  <EditableChoice
                    value={typeof value === "string" ? value : null}
                    options={column.settings.options ?? []}
                    onSave={(id) => setValue(column, id)}
                  />
                ) : column.type === "date" ? (
                  <EditableDate
                    value={typeof value === "string" ? value : null}
                    onSave={(day) => setValue(column, day)}
                  />
                ) : column.type === "checkbox" ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={Boolean(value)}
                    onClick={() => setValue(column, !value)}
                    className={`grid size-6 place-items-center rounded-md border ${
                      value ? "border-[#6c63ff] bg-[#6c63ff] text-white" : "border-[#d3d2dc] bg-white"
                    }`}
                  >
                    {Boolean(value) && <Check size={14} />}
                  </button>
                ) : (
                  <EditableText
                    value={typeof value === "string" ? value : ""}
                    multiline={column.type === "long_text"}
                    display={(v) => (
                      <span className="whitespace-pre-wrap break-words text-sm leading-6 text-[#29283a]">
                        {v}
                      </span>
                    )}
                    inputClass={`w-full rounded-lg border border-[#6c63ff] px-2 py-1.5 text-sm leading-6 outline-none ${
                      column.type === "long_text" ? "min-h-36 resize-y" : ""
                    }`}
                    onSave={(text) => setValue(column, text)}
                  />
                )}
              </Row>
            );
          })}
        </dl>

        <div className="flex flex-wrap items-center gap-2 border-t border-[#ecebf1] px-4 py-3">
          <button
            className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[#555364] hover:bg-[#f3f2f7]"
            onClick={() => onArchive(!archived)}
          >
            {archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
            {archived ? "Palauta arkistosta" : "Arkistoi"}
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-red-600 hover:bg-red-50"
            onClick={onDelete}
          >
            <Trash2 size={15} /> Poista
          </button>
          <span className="ml-auto text-[11px] text-[#9997a5]">Klikkaa arvoa muokataksesi · ⌘Z kumoaa</span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, top, children }: { label: string; top?: boolean; children: ReactNode }) {
  return (
    <div className={`grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-2 ${top ? "items-start" : "items-center"}`}>
      <dt className={`text-xs font-semibold text-[#8b8997] ${top ? "pt-1.5" : ""}`}>{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** Shared look for a clickable value. */
function ValueButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 py-1 text-left hover:bg-[#f5f5f9]"
    >
      {children}
    </button>
  );
}

const EMPTY = <span className="text-sm text-[#b2b0bb]">—</span>;

function EditableText({
  value,
  multiline,
  required,
  display,
  inputClass,
  onSave,
}: {
  value: string;
  multiline: boolean;
  required?: boolean;
  display: (value: string) => ReactNode;
  inputClass: string;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function start() {
    setDraft(value);
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    const next = multiline ? draft : draft.trim();
    if (required && !next.trim()) return;
    if (next !== value) onSave(next);
  }

  if (!editing) {
    return <ValueButton onClick={start}>{value ? display(value) : EMPTY}</ValueButton>;
  }

  const common = {
    autoFocus: true,
    value: draft,
    className: inputClass,
    onBlur: commit,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setEditing(false);
      } else if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        commit();
      }
    },
  };
  return multiline ? <textarea rows={5} {...common} /> : <input {...common} />;
}

function EditableDate({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (value: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <ValueButton onClick={() => setEditing(true)}>
        {value ? (
          <span className="text-sm text-[#29283a]">
            {weekdayFi(value)} {shortDateFi(value)}
            {value.slice(0, 4) !== new Date().getFullYear().toString() ? value.slice(0, 4) : ""}
          </span>
        ) : (
          EMPTY
        )}
      </ValueButton>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <input
        type="date"
        autoFocus
        defaultValue={value ?? ""}
        className="h-8 rounded-lg border border-[#6c63ff] px-2 text-sm outline-none"
        onChange={(event) => {
          if (event.target.value) {
            onSave(event.target.value);
            setEditing(false);
          }
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setEditing(false);
          }
        }}
      />
      {value && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onSave(null);
            setEditing(false);
          }}
          className="rounded-md px-2 py-1 text-xs font-semibold text-[#6e6c7d] hover:bg-[#f2f2f7]"
        >
          Tyhjennä
        </button>
      )}
    </span>
  );
}

function EditableChoice({
  value,
  options,
  plain,
  allowEmpty = true,
  onSave,
}: {
  value: string | null;
  options: LabelOption[];
  plain?: boolean;
  allowEmpty?: boolean;
  onSave: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);

  const chip = (option: LabelOption | undefined) =>
    !option ? (
      EMPTY
    ) : plain ? (
      <span className="text-sm text-[#29283a]">{option.label}</span>
    ) : (
      <span
        className="inline-block rounded-md px-2.5 py-0.5 text-xs font-semibold text-white"
        style={{ backgroundColor: option.color }}
      >
        {option.label}
      </span>
    );

  if (!open) return <ValueButton onClick={() => setOpen(true)}>{chip(selected)}</ValueButton>;

  return (
    <div
      className="-mx-2 flex flex-wrap gap-1.5 rounded-lg bg-[#f5f5f9] p-2"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      {options.map((option, index) => (
        <button
          key={option.id}
          type="button"
          autoFocus={option.id === value || (!value && index === 0)}
          onClick={() => {
            setOpen(false);
            if (option.id !== value) onSave(option.id);
          }}
          className={`rounded-md px-2.5 py-1 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[#6c63ff] ${
            plain ? "border border-[#e1e0e8] bg-white text-[#29283a]" : "text-white"
          } ${option.id === value ? "ring-2 ring-[#29283a]/40" : ""}`}
          style={plain ? undefined : { backgroundColor: option.color }}
        >
          {option.label}
        </button>
      ))}
      {allowEmpty && value && (
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onSave(null);
          }}
          className="rounded-md border border-dashed border-[#c9c7d6] px-2.5 py-1 text-xs font-semibold text-[#6e6c7d]"
        >
          Tyhjennä
        </button>
      )}
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Peruuta"
        className="ml-auto grid size-7 place-items-center rounded-md text-[#8b8998] hover:bg-white"
      >
        <X size={14} />
      </button>
    </div>
  );
}
