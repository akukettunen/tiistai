"use client";

import { CircleDollarSign, Mail, Plus, StickyNote, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  formatMailTime,
  formatMoney,
  type Deal,
  type EmailThread,
  type Note,
  type Stage,
} from "@/lib/crm";
import { Button } from "./ui";

type NoteTarget = { deal_id: string } | { person_id: string } | { organization_id: string };

export function NotesPanel({
  ownerId,
  target,
  initialNotes,
}: {
  ownerId: string;
  target: NoteTarget;
  initialNotes: Note[];
}) {
  const supabase = createClient();
  const [notes, setNotes] = useState(initialNotes);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const text = body.trim();
    if (!text) return;
    setSaving(true);
    setError(null);
    const { data, error: insertError } = await supabase
      .from("crm_notes")
      .insert({ owner_id: ownerId, body: text, ...target })
      .select()
      .single();
    setSaving(false);
    if (insertError) return setError(insertError.message);
    setNotes((current) => [data as Note, ...current]);
    setBody("");
  }

  async function remove(note: Note) {
    if (!confirm("Delete this note?")) return;
    setNotes((current) => current.filter((n) => n.id !== note.id));
    const { error: deleteError } = await supabase.from("crm_notes").delete().eq("id", note.id);
    if (deleteError) {
      setNotes((current) => [note, ...current]);
      setError(deleteError.message);
    }
  }

  return (
    <section className="rounded-xl border border-[#e3e2e9] bg-white">
      <div className="border-b border-[#ecebf1] p-4">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void add();
          }}
          placeholder="Take a note…"
          rows={3}
          className="w-full resize-y rounded-lg border border-[#f0e3a8] bg-[#fffbea] px-3 py-2 text-sm outline-none focus:border-[#e5c84a]"
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          {error && <p className="mr-auto text-xs text-[#d63c41]">{error}</p>}
          <Button variant="primary" onClick={add} disabled={saving || !body.trim()}>
            Save note
          </Button>
        </div>
      </div>
      <ul className="divide-y divide-[#f0eff4]">
        {notes.map((note) => (
          <li key={note.id} className="group flex gap-3 p-4">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#fff3c4] text-[#a37f00]">
              <StickyNote size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-[#8b8998]">
                {new Date(note.created_at).toLocaleString("fi-FI", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{note.body}</p>
            </div>
            <button
              onClick={() => remove(note)}
              aria-label="Delete note"
              className="self-start rounded-md p-1.5 text-[#aaa8b4] opacity-0 hover:bg-[#f2f2f7] hover:text-[#d63c41] group-hover:opacity-100"
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {notes.length === 0 && (
          <li className="p-6 text-center text-sm text-[#9997a5]">No notes yet.</li>
        )}
      </ul>
    </section>
  );
}

export function DealsList({
  deals,
  stages,
  onAdd,
}: {
  deals: Deal[];
  stages: Stage[];
  onAdd?: () => void;
}) {
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const sorted = [...deals].sort(
    (a, b) =>
      Number(b.status === "open") - Number(a.status === "open") ||
      b.created_at.localeCompare(a.created_at),
  );
  return (
    <section className="rounded-xl border border-[#e3e2e9] bg-white">
      <h3 className="flex items-center gap-2 border-b border-[#ecebf1] px-4 py-3 text-sm font-semibold">
        <CircleDollarSign size={15} /> Deals
        <span className="text-xs font-normal text-[#8b8998]">{deals.length}</span>
        {onAdd && (
          <button
            onClick={onAdd}
            aria-label="Add deal"
            className="ml-auto rounded-md p-1 text-[#6b6979] hover:bg-[#f2f2f7] hover:text-[#29283a]"
          >
            <Plus size={16} />
          </button>
        )}
      </h3>
      <ul className="divide-y divide-[#f0eff4]">
        {sorted.map((deal) => (
          <li key={deal.id}>
            <Link href={`/putkiajo/deals/${deal.id}`} className="block px-4 py-3 hover:bg-[#fafafd]">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{deal.title}</p>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                    deal.status === "open"
                      ? "bg-[#efeefe] text-[#5148df]"
                      : deal.status === "won"
                        ? "bg-[#e3f6ea] text-[#1f9d55]"
                        : "bg-[#fde8e8] text-[#d63c41]"
                  }`}
                >
                  {deal.status}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[#8b8998]">
                {formatMoney(Number(deal.value), deal.currency)} ·{" "}
                {stageById.get(deal.stage_id)?.name ?? ""}
              </p>
            </Link>
          </li>
        ))}
        {deals.length === 0 && (
          <li className="p-6 text-center text-sm text-[#9997a5]">No deals yet.</li>
        )}
      </ul>
    </section>
  );
}

export function ThreadList({ threads }: { threads: EmailThread[] }) {
  return (
    <section className="rounded-xl border border-[#e3e2e9] bg-white">
      <h3 className="flex items-center gap-2 border-b border-[#ecebf1] px-4 py-3 text-sm font-semibold">
        <Mail size={15} /> Email
        <span className="text-xs font-normal text-[#8b8998]">{threads.length}</span>
      </h3>
      <ul className="divide-y divide-[#f0eff4]">
        {threads.map((thread) => (
          <li key={thread.id}>
            <Link
              href={`/putkiajo/inbox?thread=${thread.id}`}
              className="block px-4 py-3 hover:bg-[#fafafd]"
            >
              <div className="flex items-baseline gap-2">
                <p
                  className={`min-w-0 flex-1 truncate text-sm ${
                    thread.is_unread ? "font-semibold" : ""
                  }`}
                >
                  {thread.subject || "(no subject)"}
                </p>
                <span className="shrink-0 text-xs text-[#8b8998]">
                  {formatMailTime(thread.last_message_at)}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-[#8b8998]">{thread.snippet}</p>
            </Link>
          </li>
        ))}
        {threads.length === 0 && (
          <li className="p-6 text-center text-sm text-[#9997a5]">No linked emails.</li>
        )}
      </ul>
    </section>
  );
}
