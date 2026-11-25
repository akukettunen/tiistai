import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDays,
  weekRangeUtc,
  type TimeBlock,
} from "@/lib/planning";
import { ITEM_FIELDS, type FrontItem } from "./types";

const BLOCK_FIELDS = "*";

/**
 * Items relevant to the week starting `monday`: planned for that week or the
 * previous one (for left-overs), or completed during that week.
 */
export async function loadWeekItems(
  supabase: SupabaseClient,
  monday: string,
): Promise<{ data: FrontItem[]; error: string | null }> {
  const lastMonday = addDays(monday, -7);
  const nextMonday = addDays(monday, 7);
  const { start, end } = weekRangeUtc(monday);
  const { data, error } = await supabase
    .from("items")
    .select(ITEM_FIELDS)
    .or(
      [
        `planned_week.in.(${lastMonday},${monday})`,
        `and(planned_day.gte.${lastMonday},planned_day.lt.${nextMonday})`,
        `and(completed_at.gte."${start}",completed_at.lt."${end}")`,
      ].join(","),
    )
    .order("position");
  return { data: (data ?? []) as FrontItem[], error: error?.message ?? null };
}

/** Time blocks overlapping the week. */
export async function loadWeekSchedule(
  supabase: SupabaseClient,
  monday: string,
): Promise<{ blocks: TimeBlock[]; error: string | null }> {
  const { start, end } = weekRangeUtc(monday);
  const { data, error } = await supabase
    .from("time_blocks")
    .select(BLOCK_FIELDS)
    .lt("starts_at", end)
    .gt("ends_at", start)
    .order("starts_at");
  return { blocks: (data ?? []) as TimeBlock[], error: error?.message ?? null };
}
