"use client";

import type { MouseEvent } from "react";
import { helsinkiTime, type TimeBlock } from "@/lib/planning";
import { hourRange, segmentForDay } from "./schedule";
import { BLOCK_KIND_LABEL, BLOCK_KIND_STYLE, type FrontBoard } from "./types";

const PX_PER_HOUR = 44;

export function TodayTimeline({
  day,
  blocks,
  boardsById,
  onCreate,
  onEdit,
}: {
  day: string;
  blocks: TimeBlock[];
  boardsById: Map<string, FrontBoard>;
  onCreate: (day: string, startMin: number) => void;
  onEdit: (block: TimeBlock) => void;
}) {
  const blockSegs = blocks
    .map((b) => ({ block: b, seg: segmentForDay(b.starts_at, b.ends_at, day) }))
    .filter((b) => b.seg !== null);

  const { startHour, endHour } = hourRange(blockSegs.map((b) => b.seg!));
  const height = (endHour - startHour) * PX_PER_HOUR;
  const top = (min: number) => ((min - startHour * 60) / 60) * PX_PER_HOUR;

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const minutes = startHour * 60 + ((event.clientY - rect.top) / PX_PER_HOUR) * 60;
    onCreate(day, Math.floor(minutes / 30) * 30);
  }

  return (
    <div>
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
      {blockSegs.length === 0 && (
        <p className="mt-2 text-xs text-[#9997a5]">
          Ei aikablokkeja tänään. Klikkaa aikajanaa lisätäksesi.
        </p>
      )}
    </div>
  );
}
