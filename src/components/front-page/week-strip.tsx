"use client";

import { useRef, type MouseEvent } from "react";
import { CloudOff } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  helsinkiDate,
  helsinkiTime,
  weekDays,
  type CalendarEvent,
  type TimeBlock,
} from "@/lib/planning";
import { allDayCovers, hourRange, isUnsynced, segmentForDay } from "./schedule";
import {
  BLOCK_KIND_LABEL,
  BLOCK_KIND_STYLE,
  shortDateFi,
  weekdayFi,
} from "./types";

const PX_PER_HOUR = 26;
const SNAP_MIN = 30;

type Seg = { startMin: number; endMin: number };

export function WeekStrip({
  monday,
  today,
  blocks,
  events,
  onCreate,
  onEdit,
  onMove,
}: {
  monday: string;
  today: string;
  blocks: TimeBlock[];
  events: CalendarEvent[];
  onCreate: (day: string, startMin: number) => void;
  onEdit: (block: TimeBlock) => void;
  /** Move a block to `day`, keeping its wall-clock start shifted by `deltaMin`. */
  onMove: (block: TimeBlock, day: string, deltaMin: number) => void;
}) {
  const days = weekDays(monday);
  const justDragged = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const perDay = days.map((day) => ({
    day,
    allDay: events.filter((e) => e.all_day && allDayCovers(e, day)),
    events: events
      .filter((e) => !e.all_day)
      .map((event) => ({ event, seg: segmentForDay(event.starts_at, event.ends_at, day) }))
      .filter((e): e is { event: CalendarEvent; seg: Seg } => e.seg !== null),
    blocks: blocks
      // A block belongs to the day it starts on (keeps drag simple).
      .map((block) => ({ block, seg: segmentForDay(block.starts_at, block.ends_at, day) }))
      .filter(
        (b): b is { block: TimeBlock; seg: Seg } =>
          b.seg !== null && helsinkiDate(b.block.starts_at) === day,
      ),
  }));

  const { startHour, endHour } = hourRange(
    perDay.flatMap((d) => [...d.events.map((e) => e.seg), ...d.blocks.map((b) => b.seg)]),
  );
  const height = (endHour - startHour) * PX_PER_HOUR;
  const top = (min: number) => ((min - startHour * 60) / 60) * PX_PER_HOUR;
  const maxAllDay = Math.max(0, ...perDay.map((d) => d.allDay.length));

  function handleDragEnd(event: DragEndEvent) {
    justDragged.current = true;
    window.setTimeout(() => {
      justDragged.current = false;
    }, 0);
    const block = blocks.find((b) => b.id === event.active.id);
    const day = event.over?.id;
    if (!block || typeof day !== "string") return;
    const deltaMin =
      Math.round(((event.delta.y / PX_PER_HOUR) * 60) / SNAP_MIN) * SNAP_MIN;
    onMove(block, day, deltaMin);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="overflow-x-auto">
        <div className="flex min-w-[720px]">
          <div className="w-9 shrink-0">
            <div className="h-10" />
            <div style={{ height: maxAllDay * 20 }} />
            <div className="relative" style={{ height }}>
              {Array.from({ length: endHour - startHour + 1 }, (_, i) => (
                <span
                  key={i}
                  className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-[#9997a5]"
                  style={{ top: i * PX_PER_HOUR }}
                >
                  {String(startHour + i).padStart(2, "0")}
                </span>
              ))}
            </div>
          </div>
          {perDay.map(({ day, allDay, events: dayEvents, blocks: dayBlocks }) => (
            <DayColumn
              key={day}
              day={day}
              isToday={day === today}
              height={height}
              startHour={startHour}
              allDaySlots={maxAllDay}
              onCreate={onCreate}
            >
              {allDay.length > 0 && (
                <div className="absolute inset-x-0.5 -top-0.5 -translate-y-full space-y-0.5">
                  {allDay.map((e) => (
                    <div
                      key={e.id}
                      className="h-[18px] truncate rounded bg-[#eceafd] px-1 text-[10px] font-medium leading-[18px] text-[#4b4592]"
                      title={e.title}
                    >
                      {e.title || "(ei otsikkoa)"}
                    </div>
                  ))}
                </div>
              )}
              {Array.from({ length: endHour - startHour }, (_, i) => (
                <div
                  key={i}
                  className="pointer-events-none absolute inset-x-0 border-t border-[#f0f0f5]"
                  style={{ top: i * PX_PER_HOUR }}
                />
              ))}
              {dayEvents.map(({ event, seg }) => (
                <div
                  key={event.id}
                  className="pointer-events-none absolute inset-x-0.5 overflow-hidden rounded border border-[#d9d7f5] bg-[#f3f2ff]/90 px-1 text-[10px] leading-tight text-[#4b4592]"
                  style={{
                    top: top(seg.startMin),
                    height: Math.max(12, top(seg.endMin) - top(seg.startMin) - 1),
                  }}
                  title={`${event.title} ${helsinkiTime(event.starts_at)}–${helsinkiTime(event.ends_at)}`}
                >
                  {event.title || "(ei otsikkoa)"}
                </div>
              ))}
              {dayBlocks.map(({ block, seg }) => (
                <DraggableBlock
                  key={block.id}
                  block={block}
                  top={top(seg.startMin)}
                  height={Math.max(16, top(seg.endMin) - top(seg.startMin) - 1)}
                  onClick={() => {
                    if (!justDragged.current) onEdit(block);
                  }}
                />
              ))}
            </DayColumn>
          ))}
        </div>
      </div>
    </DndContext>
  );
}

function DayColumn({
  day,
  isToday,
  height,
  startHour,
  allDaySlots,
  onCreate,
  children,
}: {
  day: string;
  isToday: boolean;
  height: number;
  startHour: number;
  allDaySlots: number;
  onCreate: (day: string, startMin: number) => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: day });

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const minutes = startHour * 60 + ((event.clientY - rect.top) / PX_PER_HOUR) * 60;
    onCreate(day, Math.floor(minutes / SNAP_MIN) * SNAP_MIN);
  }

  return (
    <div className="min-w-0 flex-1 border-l border-[#ececf2]">
      <div
        className={`flex h-10 flex-col items-center justify-center text-xs ${
          isToday ? "font-bold text-[#6c63ff]" : "font-semibold text-[#6e6c7d]"
        }`}
      >
        <span className="uppercase">{weekdayFi(day)}</span>
        <span className="text-[11px] font-medium">{shortDateFi(day)}</span>
      </div>
      <div style={{ height: allDaySlots * 20 }} />
      <div
        ref={setNodeRef}
        className={`relative cursor-copy ${isOver ? "bg-[#f3f2ff]" : isToday ? "bg-[#fafaff]" : ""}`}
        style={{ height }}
        onClick={handleClick}
      >
        {children}
      </div>
    </div>
  );
}

function DraggableBlock({
  block,
  top,
  height,
  onClick,
}: {
  block: TimeBlock;
  top: number;
  height: number;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: block.id,
  });
  const style = BLOCK_KIND_STYLE[block.kind];
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      className={`absolute inset-x-0.5 cursor-grab touch-none overflow-hidden rounded border px-1 text-left text-[10px] leading-tight shadow-sm ${
        isDragging ? "z-20 cursor-grabbing shadow-lg" : "z-10"
      }`}
      style={{
        top,
        height,
        backgroundColor: style.bg,
        borderColor: style.border,
        color: style.text,
        opacity: block.done_at ? 0.6 : 1,
        transform: CSS.Translate.toString(transform),
      }}
      title={`${block.title || BLOCK_KIND_LABEL[block.kind]} ${helsinkiTime(block.starts_at)}–${helsinkiTime(block.ends_at)}${
        isUnsynced(block.sync_status) ? " · ei synkattu" : ""
      }`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <span className="flex items-center gap-0.5 font-semibold">
        <span className="truncate">{block.title || BLOCK_KIND_LABEL[block.kind]}</span>
        {isUnsynced(block.sync_status) && (
          <CloudOff size={9} className="ml-auto shrink-0" aria-label="ei synkattu" />
        )}
      </span>
      {height > 28 && (
        <span className="block truncate opacity-85">
          {helsinkiTime(block.starts_at)}–{helsinkiTime(block.ends_at)}
        </span>
      )}
    </button>
  );
}
