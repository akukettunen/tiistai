import { addDays, helsinkiDate, helsinkiToUtc } from "@/lib/planning";

export const DEFAULT_START_HOUR = 7;
export const DEFAULT_END_HOUR = 22;

/** Minutes since Helsinki midnight of `day` for the part of [start, end) on that day. */
export function segmentForDay(
  startIso: string,
  endIso: string,
  day: string,
): { startMin: number; endMin: number } | null {
  const dayStart = helsinkiToUtc(day, "00:00").getTime();
  const dayEnd = helsinkiToUtc(addDays(day, 1), "00:00").getTime();
  const start = Math.max(new Date(startIso).getTime(), dayStart);
  const end = Math.min(new Date(endIso).getTime(), dayEnd);
  if (end <= start) return null;
  return {
    startMin: Math.round((start - dayStart) / 60000),
    endMin: Math.round((end - dayStart) / 60000),
  };
}

/** Visible hour range: 07–22 by default, widened to fit anything outside it. */
export function hourRange(
  segments: { startMin: number; endMin: number }[],
): { startHour: number; endHour: number } {
  let startHour = DEFAULT_START_HOUR;
  let endHour = DEFAULT_END_HOUR;
  for (const s of segments) {
    startHour = Math.min(startHour, Math.floor(s.startMin / 60));
    endHour = Math.max(endHour, Math.ceil(s.endMin / 60));
  }
  return { startHour: Math.max(0, startHour), endHour: Math.min(24, endHour) };
}

export function isUnsynced(status: string) {
  return status === "pending" || status === "error";
}

/**
 * Whether an all-day event covers `day`. Works whether the cache stores the
 * bounds as Helsinki or UTC midnights (end is exclusive).
 */
export function allDayCovers(event: { starts_at: string; ends_at: string }, day: string) {
  const start = helsinkiDate(event.starts_at);
  const end = helsinkiDate(event.ends_at);
  return start === end ? start === day : start <= day && day < end;
}
