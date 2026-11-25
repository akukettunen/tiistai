"use client";

import { useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, Info, Loader2, RefreshCw, Unplug } from "lucide-react";

export type AvailableCalendar = {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor: string | null;
};

export type CalendarAccountView = {
  status: "ok" | "error" | "revoked";
  email: string;
  last_error: string | null;
  last_synced_at: string | null;
  available_calendars: AvailableCalendar[];
  read_calendar_ids: string[];
};

const STATUS_LABELS: Record<CalendarAccountView["status"], string> = {
  ok: "Yhdistetty",
  error: "Virhe viimeisimmässä synkronoinnissa",
  revoked: "Yhteys katkennut — yhdistä uudelleen",
};

function formatTime(value: string | null) {
  if (!value) return "Ei vielä";
  return new Intl.DateTimeFormat("fi-FI", {
    timeZone: "Europe/Helsinki",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function CalendarSettings({
  initialAccount,
  liveSync,
  flashError,
  flashConnected,
}: {
  initialAccount: CalendarAccountView | null;
  liveSync: boolean;
  flashError: string | null;
  flashConnected: boolean;
}) {
  const [account, setAccount] = useState(initialAccount);
  const [selected, setSelected] = useState<string[]>(initialAccount?.read_calendar_ids ?? []);
  const [busy, setBusy] = useState<"save" | "disconnect" | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(
    flashError
      ? { kind: "error", text: flashError }
      : flashConnected
        ? { kind: "ok", text: "Google Kalenteri yhdistetty. Tiistai-kalenteri on luotu tilillesi." }
        : null,
  );
  const [deleteCalendar, setDeleteCalendar] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const dirty =
    account !== null &&
    (selected.length !== account.read_calendar_ids.length ||
      selected.some((id) => !account.read_calendar_ids.includes(id)));

  async function save() {
    setBusy("save");
    setMessage(null);
    try {
      const response = await fetch("/api/calendar/account/calendars", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ read_calendar_ids: selected }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Tallennus epäonnistui.");
      if (data.connected) {
        setAccount({
          status: data.status,
          email: data.email,
          last_error: data.last_error,
          last_synced_at: data.last_synced_at,
          available_calendars: data.available_calendars,
          read_calendar_ids: data.read_calendar_ids,
        });
        setSelected(data.read_calendar_ids);
      }
      setMessage(data.error ? { kind: "error", text: data.error } : { kind: "ok", text: "Kalenterivalinnat tallennettu." });
    } catch (caught) {
      setMessage({ kind: "error", text: caught instanceof Error ? caught.message : "Tallennus epäonnistui." });
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setMessage(null);
    try {
      const response = await fetch("/api/calendar/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deleteCalendar }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Yhteyden katkaisu epäonnistui.");
      setAccount(null);
      setSelected([]);
      setConfirming(false);
      setMessage({
        kind: data.error ? "error" : "ok",
        text: data.error ? `Yhteys katkaistu, mutta: ${data.error}` : "Yhteys Google Kalenteriin katkaistu.",
      });
      window.history.replaceState(null, "", "/settings/calendar");
    } catch (caught) {
      setMessage({ kind: "error", text: caught instanceof Error ? caught.message : "Yhteyden katkaisu epäonnistui." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-[#6c63ff] text-white">
          <CalendarDays size={20} />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[#252336]">Google Kalenteri</h1>
          <p className="text-sm text-[#8b8998]">
            Aikablokit omaan Tiistai-kalenteriin ja muiden kalentereiden tapahtumat etusivulle.
          </p>
        </div>
      </div>

      {message && (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
            message.kind === "ok"
              ? "border-[#cdeedd] bg-[#f1fbf5] text-[#1f6b45]"
              : "border-[#f5d0d4] bg-[#fdf3f4] text-[#a12d3a]"
          }`}
        >
          {message.kind === "ok" ? (
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {!account ? (
        <section className="rounded-2xl border border-[#e2e1e8] bg-white p-6 sm:p-8">
          <h2 className="text-base font-semibold text-[#252336]">Ei yhdistetty</h2>
          <p className="mt-2 text-sm text-[#6e6c7d]">
            Tiistai luo Google-tilillesi oman <strong>Tiistai</strong>-kalenterin aikablokeille ja lukee valitsemiesi
            kalentereiden tapahtumat. Muihin kalentereihin ei kirjoiteta mitään.
          </p>
          <a
            href="/api/calendar/oauth/start"
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-[#6c63ff] px-5 text-sm font-semibold text-white hover:bg-[#5b52f2]"
          >
            <CalendarDays size={16} />
            Yhdistä Google Kalenteri
          </a>
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-[#e2e1e8] bg-white p-6 sm:p-8">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[#8b8998]">Tili</dt>
                <dd className="mt-1 font-medium text-[#252336]">{account.email || "—"}</dd>
              </div>
              <div>
                <dt className="text-[#8b8998]">Tila</dt>
                <dd
                  className={`mt-1 font-medium ${account.status === "ok" ? "text-[#1f6b45]" : "text-[#a12d3a]"}`}
                >
                  {STATUS_LABELS[account.status]}
                </dd>
              </div>
              <div>
                <dt className="text-[#8b8998]">Viimeksi synkronoitu</dt>
                <dd className="mt-1 font-medium text-[#252336]">{formatTime(account.last_synced_at)}</dd>
              </div>
              <div>
                <dt className="text-[#8b8998]">Live-synkronointi</dt>
                <dd className="mt-1 font-medium text-[#252336]">
                  {liveSync ? "Päällä (push-ilmoitukset)" : "Pois (päivittyy sivua avatessa)"}
                </dd>
              </div>
            </dl>
            {account.last_error && (
              <p className="mt-4 rounded-lg bg-[#fdf3f4] px-3 py-2 text-xs text-[#a12d3a]">{account.last_error}</p>
            )}
            {account.status === "revoked" && (
              <a
                href="/api/calendar/oauth/start"
                className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-[#6c63ff] px-4 text-sm font-semibold text-white hover:bg-[#5b52f2]"
              >
                <RefreshCw size={15} />
                Yhdistä uudelleen
              </a>
            )}
          </section>

          <section className="rounded-2xl border border-[#e2e1e8] bg-white p-6 sm:p-8">
            <h2 className="text-base font-semibold text-[#252336]">Luettavat kalenterit</h2>
            <p className="mt-1 text-sm text-[#6e6c7d]">
              Näiden kalentereiden tapahtumat näytetään etusivun viikkonäkymässä. Tiistai-kalenteri luetaan aina.
            </p>
            <ul className="mt-4 divide-y divide-[#efeef3] rounded-xl border border-[#e8e7ed]">
              {account.available_calendars.length === 0 && (
                <li className="px-4 py-3 text-sm text-[#8b8998]">Kalentereita ei löytynyt.</li>
              )}
              {account.available_calendars.map((calendar) => (
                <li key={calendar.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm hover:bg-[#fafafc]">
                    <input
                      type="checkbox"
                      className="size-4 accent-[#6c63ff]"
                      checked={selected.includes(calendar.id)}
                      disabled={account.status === "revoked"}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, calendar.id]
                            : current.filter((id) => id !== calendar.id),
                        )
                      }
                    />
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{ backgroundColor: calendar.backgroundColor ?? "#c4c3cf" }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[#29283a]">{calendar.summary}</span>
                    {calendar.primary && (
                      <span className="rounded-full bg-[#f0efff] px-2 py-0.5 text-xs font-medium text-[#5b52f2]">
                        Ensisijainen
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || busy !== null || account.status === "revoked"}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-[#6c63ff] px-4 text-sm font-semibold text-white hover:bg-[#5b52f2] disabled:opacity-50"
            >
              {busy === "save" && <Loader2 size={15} className="animate-spin" />}
              Tallenna
            </button>
          </section>

          <section className="rounded-2xl border border-[#e2e1e8] bg-white p-6 sm:p-8">
            <h2 className="text-base font-semibold text-[#252336]">Katkaise yhteys</h2>
            <p className="mt-1 text-sm text-[#6e6c7d]">
              Tiistai poistaa tallennetut tunnukset ja välimuistin. Aikablokit jäävät Tiistaihin paikallisina.
            </p>
            <label className="mt-4 flex items-center gap-2 text-sm text-[#29283a]">
              <input
                type="checkbox"
                className="size-4 accent-[#d83a52]"
                checked={deleteCalendar}
                onChange={(event) => setDeleteCalendar(event.target.checked)}
              />
              Poista myös Tiistai-kalenteri Googlesta
            </label>
            {confirming ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-sm text-[#a12d3a]">
                  {deleteCalendar ? "Tiistai-kalenteri ja sen tapahtumat poistetaan. Jatketaanko?" : "Jatketaanko?"}
                </span>
                <button
                  type="button"
                  onClick={disconnect}
                  disabled={busy !== null}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#d83a52] px-4 text-sm font-semibold text-white hover:bg-[#c42f46] disabled:opacity-50"
                >
                  {busy === "disconnect" && <Loader2 size={15} className="animate-spin" />}
                  Katkaise
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="h-9 rounded-lg px-3 text-sm font-medium text-[#6e6c7d] hover:bg-[#f2f2f7]"
                >
                  Peruuta
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg border border-[#f5d0d4] px-4 text-sm font-semibold text-[#a12d3a] hover:bg-[#fdf3f4]"
              >
                <Unplug size={15} />
                Katkaise yhteys
              </button>
            )}
          </section>
        </>
      )}

      <aside className="flex gap-2 rounded-xl border border-[#e8e7ed] bg-white px-4 py-3 text-xs text-[#6e6c7d]">
        <Info size={15} className="mt-0.5 shrink-0 text-[#8b8998]" />
        <p>
          Ylläpitäjälle: aseta Google Cloud -konsolissa OAuth-sovelluksen julkaisutilaksi <strong>In production</strong>.
          Testing-tilassa refresh tokenit vanhenevat 7 päivässä, jolloin yhteys katkeaa ja se pitää yhdistää uudelleen.
        </p>
      </aside>
    </div>
  );
}
