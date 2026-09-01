"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { ArrowLeft, Check, Layers3, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Board = {
  id: string;
  name: string;
  color: string;
};

type Group = {
  id: string;
  board_id: string;
  name: string;
  color: string;
  position: number;
};

type LabelOption = { id: string; label: string; color: string };

type BoardColumn = {
  id: string;
  board_id: string;
  title: string;
  type: "label" | "text" | "long_text" | "date" | "checkbox";
  settings: { options?: LabelOption[] };
  position: number;
};

type Automation = {
  board_id: string;
  trigger_column_id: string;
  trigger_value: string;
  target_group_id: string;
  enabled: boolean;
};

type Props = {
  userId: string;
  boards: Board[];
  groups: Group[];
  columns: BoardColumn[];
  automations: Automation[];
  initialError: string | null;
};

export function QuickAdd({
  userId,
  boards,
  groups,
  columns,
  automations,
  initialError,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [boardId, setBoardId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [title, setTitle] = useState("");
  const [values, setValues] = useState<Record<string, string | boolean | null>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [savedTitle, setSavedTitle] = useState<string | null>(null);

  const board = boards.find((entry) => entry.id === boardId);
  const boardGroups = groups.filter((group) => group.board_id === boardId);
  const boardColumns = columns.filter((column) => column.board_id === boardId);

  function selectBoard(nextBoardId: string) {
    const firstGroup = groups
      .filter((group) => group.board_id === nextBoardId)
      .sort((a, b) => a.position - b.position)[0];
    setBoardId(nextBoardId);
    setGroupId(firstGroup?.id ?? "");
    setValues({});
    setSavedTitle(null);
    setError(null);
  }

  function setColumnValue(columnId: string, value: string | boolean | null) {
    setValues((current) => ({ ...current, [columnId]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle || !boardId || !groupId) return;
    setSaving(true);
    setError(null);
    const matchingAutomation = automations.find(
      (automation) =>
        automation.enabled &&
        automation.board_id === boardId &&
        String(values[automation.trigger_column_id]) === automation.trigger_value,
    );
    const destinationGroupId = matchingAutomation?.target_group_id ?? groupId;

    const { data: lastItems, error: positionError } = await supabase
      .from("items")
      .select("position")
      .eq("group_id", destinationGroupId)
      .order("position", { ascending: false })
      .limit(1);

    if (positionError) {
      setError(positionError.message);
      setSaving(false);
      return;
    }

    const position = (lastItems?.[0]?.position ?? -1) + 1;
    const { error: insertError } = await supabase.from("items").insert({
      owner_id: userId,
      board_id: boardId,
      group_id: destinationGroupId,
      title: cleanTitle,
      position,
      column_values: values,
    });

    if (insertError) {
      setError(insertError.message);
    } else {
      setSavedTitle(cleanTitle);
      setTitle("");
      setValues({});
    }
    setSaving(false);
  }

  if (savedTitle) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#f7f7fa] p-5">
        <div className="w-full max-w-md rounded-2xl border border-[#e2e1e8] bg-white p-7 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <Check size={23} />
          </span>
          <h1 className="mt-5 text-xl font-semibold">Item added</h1>
          <p className="mt-1 truncate text-sm text-[#777584]">{savedTitle}</p>
          <button
            className="mt-6 h-11 w-full rounded-lg bg-[#6c63ff] text-sm font-semibold text-white"
            onClick={() => setSavedTitle(null)}
          >
            Add another
          </button>
          <Link
            href="/board"
            className="mt-2 block rounded-lg py-3 text-sm font-medium text-[#656273]"
          >
            Open board
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#f7f7fa]">
      <header className="sticky top-0 z-10 border-b border-[#e4e3e9] bg-white">
        <div className="mx-auto flex h-14 max-w-2xl items-center px-4">
          <Link
            href="/board"
            aria-label="Back to boards"
            className="rounded-lg p-2 text-[#6e6c7d] hover:bg-[#f2f2f6]"
          >
            <ArrowLeft size={20} />
          </Link>
          <div className="ml-2 flex items-center gap-2 text-sm font-semibold">
            <Layers3 size={17} className="text-[#6c63ff]" />
            Quick add
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
        <section>
          <h1 className="text-sm font-semibold text-[#302e40]">Board</h1>
          {boards.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-[#d8d7df] bg-white p-6 text-center text-sm text-[#7d7b89]">
              Create a board in the main app first.
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {boards.map((entry) => (
                <button
                  key={entry.id}
                  className={`inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition ${
                    boardId === entry.id
                      ? "border-[#6c63ff] bg-[#efedff] text-[#5148df]"
                      : "border-[#dedde5] bg-white text-[#595767]"
                  }`}
                  onClick={() => selectBoard(entry.id)}
                >
                  <span
                    className="size-2.5 rounded-sm"
                    style={{ backgroundColor: entry.color }}
                  />
                  {entry.name}
                </button>
              ))}
            </div>
          )}
        </section>

        {board && (
          <form className="mt-8 space-y-6" onSubmit={submit}>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[#302e40]">
                Item title
              </span>
              <input
                autoFocus
                className="h-12 w-full rounded-xl border border-[#dedde5] bg-white px-4 text-base outline-none focus:border-[#6c63ff]"
                placeholder="What needs to be done?"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </label>

            {boardGroups.length > 1 && (
              <div>
                <p className="mb-2 text-sm font-semibold text-[#302e40]">Group</p>
                <div className="flex flex-wrap gap-2">
                  {boardGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm ${
                        groupId === group.id
                          ? "border-[#6c63ff] bg-[#efedff] text-[#5148df]"
                          : "border-[#dedde5] bg-white"
                      }`}
                      onClick={() => setGroupId(group.id)}
                    >
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: group.color }}
                      />
                      {group.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {boardColumns.map((column) => (
              <QuickColumnField
                key={column.id}
                column={column}
                value={values[column.id]}
                onChange={(value) => setColumnValue(column.id, value)}
              />
            ))}

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
                {error}
              </p>
            )}

            <button
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#6c63ff] text-sm font-semibold text-white disabled:opacity-50"
              disabled={saving || !title.trim() || !groupId}
            >
              <Plus size={18} />
              {saving ? "Adding…" : "Add item"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

function QuickColumnField({
  column,
  value,
  onChange,
}: {
  column: BoardColumn;
  value: string | boolean | null | undefined;
  onChange: (value: string | boolean | null) => void;
}) {
  if (column.type === "label") {
    return (
      <div>
        <p className="mb-2 text-sm font-semibold text-[#302e40]">{column.title}</p>
        <div className="flex flex-wrap gap-2">
          {(column.settings.options ?? []).map((option) => {
            const selected = value === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className="rounded-full border px-3 py-2 text-sm font-medium transition"
                style={{
                  borderColor: selected ? option.color : "#dedde5",
                  backgroundColor: selected ? `${option.color}18` : "#fff",
                  color: selected ? option.color : "#595767",
                }}
                onClick={() => onChange(selected ? null : option.id)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (column.type === "checkbox") {
    return (
      <label className="flex items-center gap-3 text-sm font-semibold text-[#302e40]">
        <input
          className="size-5 accent-[#6c63ff]"
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        {column.title}
      </label>
    );
  }

  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-[#302e40]">
        {column.title}
      </span>
      {column.type === "long_text" ? (
        <textarea
          className="min-h-28 w-full resize-y rounded-xl border border-[#dedde5] bg-white p-3 text-sm outline-none focus:border-[#6c63ff]"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className="h-11 w-full rounded-xl border border-[#dedde5] bg-white px-3 text-sm outline-none focus:border-[#6c63ff]"
          type={column.type === "date" ? "date" : "text"}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value || null)}
        />
      )}
    </label>
  );
}
