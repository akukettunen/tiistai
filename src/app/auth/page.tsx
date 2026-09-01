"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Layers3 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  function destination() {
    const next = new URLSearchParams(window.location.search).get("next");
    return next?.startsWith("/") && !next.startsWith("//") ? next : "/board";
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    setIsError(false);

    const supabase = createClient();
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage(error.message);
        setIsError(true);
      } else {
        router.push(destination());
        router.refresh();
      }
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setMessage(error.message);
        setIsError(true);
      } else {
        router.push(destination());
        router.refresh();
      }
    }
    setLoading(false);
  }

  function changeMode(nextMode: "login" | "signup") {
    setMode(nextMode);
    setMessage(null);
    setIsError(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f7fa] px-5 py-10">
      <section className="w-full max-w-100">
        <div className="mb-8 flex items-center justify-center gap-2.5 text-lg font-semibold text-[#252336]">
          <span className="grid size-9 place-items-center rounded-lg bg-[#6c63ff] text-white">
            <Layers3 size={18} />
          </span>
          Tuesday
        </div>
        <div className="rounded-2xl border border-[#e2e1e8] bg-white p-6 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[#252336]">
            {mode === "login" ? "Log in" : "Create account"}
          </h1>

          <div className="mt-6 grid grid-cols-2 border-b border-[#e8e7ed] text-sm font-medium">
            <button
              className={`border-b-2 py-3 ${mode === "login" ? "border-[#6c63ff] text-[#5148df]" : "border-transparent text-[#858392]"}`}
              onClick={() => changeMode("login")}
            >
              Log in
            </button>
            <button
              className={`border-b-2 py-3 ${mode === "signup" ? "border-[#6c63ff] text-[#5148df]" : "border-transparent text-[#858392]"}`}
              onClick={() => changeMode("signup")}
            >
              Sign up
            </button>
          </div>

          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[#2f2d42]">Email</span>
                <input
                  className="h-11 w-full rounded-lg border border-[#dedee8] px-3 text-sm outline-none placeholder:text-[#aaa8b7] focus:border-[#6c63ff]"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[#2f2d42]">Password</span>
                <span className="relative block">
                  <input
                    className="h-11 w-full rounded-lg border border-[#dedee8] px-3 pr-11 text-sm outline-none placeholder:text-[#aaa8b7] focus:border-[#6c63ff]"
                    type={showPassword ? "text" : "password"}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    minLength={6}
                    placeholder="At least 6 characters"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[#868496]"
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
              </label>

              {message && (
                <div
                  className={`rounded-lg px-3 py-2.5 text-sm ${isError ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}
                >
                  {message}
                </div>
              )}

              <button
                className="h-11 w-full rounded-lg bg-[#6c63ff] text-sm font-semibold text-white hover:bg-[#5b52f2] disabled:opacity-60"
                disabled={loading}
              >
                {loading ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
              </button>
            </form>
        </div>
      </section>
    </main>
  );
}
