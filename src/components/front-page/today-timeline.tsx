"use client";

import type { MouseEvent } from "react";
import { CloudOff } from "lucide-react";
import { helsinkiTime, type CalendarEvent, type TimeBlock } from "@/lib/planning";
import { allDayCovers, hourRange, isUnsynced, segmentForDay } from "./schedule";
import { BLOCK_KIND_LABEL, BLOCK_KIND_STYLE, type FrontBoard } from "./types";

const PX_PER_HOUR = 44;

export function TodayTimeline({
  day,
  blocks,
  events,
  boardsById,
  onCreate,
  onEdit,
}: {
  day: string;
  blocks: TimeBlock[];
  events: CalendarEvent[];
  boardsById: Map<string, FrontBoard>;
  onCreate: (day: string, startMin: number) => void;
  onEdit: (block: TimeBlock) => void;
}) {
  const allDay = events.filter((e) => e.all_day && allDayCovers(e, day));
  const timedEvents = events
    .filter((e) => !e.all_day)
    .map((e) => ({ event: e, seg: segmentForDay(e.starts_at, e.ends_at, day) }))
    .filter((e) => e.seg !== null);
  const blockSegs = blocks
    .map((b) => ({ block: b, seg: segmentForDay(b.starts_at, b.ends_at, day) }))
    .filter((b) => b.seg !== null);

  const { startHour, endHour } = hourRange([
    ...timedEvents.map((e) => e.seg!),
    ...blockSegs.map((b) => b.seg!),
  ]);
  const height = (endHour - startHour) * PX_PER_HOUR;
  const top = (min: number) => ((min - startHour * 60) / 60) * PX_PER_HOUR;

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const minutes = startHour * 60 + ((event.clientY - rect.top) / PX_PER_HOUR) * 60;
    onCreate(day, Math.floor(minutes / 30) * 30);
  }

  return (
    <div>
      {allDay.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {allDay.map((e) => (
            <span
              key={e.id}
              className="truncate rounded-md bg-[#eceafd] px-2 py-1 text-xs font-medium text-[#4b4592]"
            >
              {e.title || "(ei otsikkoa)"}
            </span>
          ))}
        </div>
      )}
      <div className="flex">
        <div className="relative w-11 shrink-0" style={{ height }}>
          {Array.from({ length: endHour - startHour + 1 }, (_, i) => (
            <span
              key={i}
              className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-[#9997a5]"
              style={{ top: i * PX_PER_HOUR }}
            >
              {String(startHour + i).padStart(2, "0")}
            </span>
          ))}
        </div>
        <div
          className="relative flex-1 cursor-copy border-l border-[#ececf2]"
          style={{ height }}
          onClick={handleClick}
          title="Lisää aikablokki klikkaamalla"
        >
          {Array.from({ length: endHour - startHour }, (_, i) => (
            <div
              key={i}
              className="pointer-events-none absolute inset-x-0 border-t border-[#f0f0f5]"
              style={{ top: i * PX_PER_HOUR }}
            />
          ))}

          {timedEvents.map(({ event, seg }) => (
            <div
              key={event.id}
              className="pointer-events-none absolute right-1 overflow-hidden rounded-md border border-[#d9d7f5] bg-[#f3f2ff]/90 px-2 py-0.5 text-[11px] text-[#4b4592]"
              style={{
                top: top(seg!.startMin),
                height: Math.max(18, top(seg!.endMin) - top(seg!.startMin) - 2),
                left: "58%",
              }}
            >
              <span className="font-medium">{event.title || "(ei otsikkoa)"}</span>{" "}
              <span className="opacity-70">
                {helsinkiTime(event.starts_at)}–{helsinkiTime(event.ends_at)}
              </span>
            </div>
          ))}

          {blockSegs.map(({ block, seg }) => {
            const style = BLOCK_KIND_STYLE[block.kind];
            const board = block.board_id ? boardsById.get(block.board_id) : undefined;
            return (
              <button
                key={block.id}
                type="button"
                className="absolute left-1 overflow-hidden rounded-md border px-2 py-1 text-left text-xs shadow-sm hover:brightness-105"
                style={{
                  top: top(seg!.startMin),
                  height: Math.max(22, top(seg!.endMin) - top(seg!.startMin) - 2),
                  width: "calc(57% - 0.5rem)",
                  backgroundColor: style.bg,
                  borderColor: style.border,
                  color: style.text,
                  opacity: block.done_at ? 0.6 : 1,
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(block);
                }}
              >
                <div className="flex items-center gap-1 font-semibold">
                  <span className="truncate">
                    {block.title || BLOCK_KIND_LABEL[block.kind]}
                  </span>
                  {isUnsynced(block.sync_status) && (
                    <span
                      className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded bg-black/15 px-1 text-[10px] font-medium"
                      title={block.sync_status === "error" ? "Synkronointivirhe" : "Odottaa synkronointia"}
                    >
                      <CloudOff size={10} /> ei synkattu
                    </span>
                  )}
                </div>
                <div className="truncate opacity-85">
                  {helsinkiTime(block.starts_at)}–{helsinkiTime(block.ends_at)}
                  {board ? ` · ${board.name}` : ""}
                  {block.done_at ? " · käytetty" : ""}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {blockSegs.length === 0 && timedEvents.length === 0 && (
        <p className="mt-2 text-xs text-[#9997a5]">
          Ei aikablokkeja tänään. Klikkaa aikajanaa lisätäksesi.
        </p>
      )}
    </div>
  );
}
