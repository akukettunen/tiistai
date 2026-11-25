import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppTopBar } from "@/components/app-top-bar";
import { webhookAddress } from "@/lib/calendar/watch";
import { createClient } from "@/lib/supabase/server";
import { CalendarSettings, type CalendarAccountView } from "./calendar-settings";

export const metadata: Metadata = { title: "Google Kalenteri — Tiistai" };

export default async function CalendarSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");

  const params = await searchParams;
  const { data, error } = await supabase
    .from("calendar_accounts")
    .select("status, email, last_error, last_synced_at, available_calendars, read_calendar_ids")
    .eq("owner_id", authData.user.id)
    .maybeSingle();

  const account: CalendarAccountView | null = data
    ? {
        status: data.status,
        email: data.email,
        last_error: data.last_error,
        last_synced_at: data.last_synced_at,
        available_calendars: Array.isArray(data.available_calendars) ? data.available_calendars : [],
        read_calendar_ids: Array.isArray(data.read_calendar_ids) ? data.read_calendar_ids : [],
      }
    : null;

  const flashError = typeof params.error === "string" ? params.error : (error?.message ?? null);
  const flashConnected = params.connected === "1";

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f7fa]">
      <AppTopBar />
      <main className="mx-auto w-full max-w-2xl px-4 py-8 md:py-12">
        <CalendarSettings
          key={account ? `${account.email}-${account.status}` : "none"}
          initialAccount={account}
          liveSync={Boolean(webhookAddress())}
          flashError={flashError}
          flashConnected={flashConnected}
        />
      </main>
    </div>
  );
}
