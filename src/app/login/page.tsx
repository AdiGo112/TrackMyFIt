"use client";

import { useState } from "react";
import { supabase } from "@/lib/db";
import { useUI } from "@/components/ui";

type Mode = "in" | "up" | "forgot";

const COPY: Record<Mode, { eyebrow: string; submit: string; busy: string }> = {
  in: { eyebrow: "Log in", submit: "Log in", busy: "Logging in…" },
  up: { eyebrow: "Create account", submit: "Create account", busy: "Creating…" },
  forgot: { eyebrow: "Reset password", submit: "Send reset link", busy: "Sending…" },
};

/** The brand mark: a loaded competition bar, in the plate colours the app uses
 *  everywhere else. Same shape as the app icon. */
function BarMark() {
  const plate = (w: number, h: number, bg: string) => (
    <span style={{ width: w, height: h, background: bg, borderRadius: 2 }} />
  );
  return (
    <span className="flex items-center gap-[2px]" aria-hidden="true">
      {plate(3, 13, "var(--color-p1)")}
      {plate(5, 30, "var(--color-p20)")}
      {plate(7, 30, "var(--color-p25)")}
      {plate(13, 6, "var(--color-ink)")}
      {plate(7, 30, "var(--color-p25)")}
      {plate(5, 30, "var(--color-p20)")}
      {plate(3, 13, "var(--color-p1)")}
    </span>
  );
}

export default function LoginPage() {
  const { toast } = useUI();
  const [mode, setMode] = useState<Mode>("in");
  const [busy, setBusy] = useState(false);
  // Set after signup or a reset request: both end in "go read your email", and
  // there is nothing useful to show on this screen until they do.
  const [sent, setSent] = useState<string | null>(null);

  async function submit(form: FormData) {
    const email = (form.get("email") as string).trim();
    const password = (form.get("password") as string) ?? "";
    setBusy(true);

    if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${location.origin}/reset`,
      });
      setBusy(false);
      if (error) return toast(error.message, "bad");
      // Deliberately the same message whether or not the address has an account:
      // otherwise this form tells strangers who is registered.
      return setSent(`If ${email} has an account, a reset link is on its way.`);
    }

    if (mode === "up") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}/` },
      });
      setBusy(false);
      if (error) return toast(error.message, "bad");
      // With email confirmation on there is no session yet. If confirmation is
      // ever switched off, one arrives here and AuthGate moves us along.
      if (!data.session) setSent(`Confirm your address — we sent a link to ${email}.`);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast(error.message, "bad");
    // On success AuthGate sees the session and redirects; nothing to do here.
  }

  if (sent) {
    return (
      <main>
        <header className="rise mb-8">
          <BarMark />
          <h1 className="display mt-4 text-[2.5rem]">TrackMyFit</h1>
        </header>
        <section className="rise">
          <h2 className="eyebrow mb-2.5">Check your email</h2>
          <p className="text-sm text-ink2">{sent}</p>
          <button
            onClick={() => {
              setSent(null);
              setMode("in");
            }}
            className="btn-quiet mt-4"
          >
            Back to log in
          </button>
        </section>
      </main>
    );
  }

  return (
    <main>
      <header className="rise mb-8">
        <BarMark />
        <h1 className="display mt-4 text-[2.5rem]">TrackMyFit</h1>
        <p className="mt-1.5 text-sm text-ink2">
          Log the set, load the bar, beat last week.
        </p>
      </header>

      <form action={submit} className="rise space-y-4">
        <h2 className="eyebrow">{COPY[mode].eyebrow}</h2>

        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="input"
          />
        </div>

        {mode !== "forgot" && (
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={mode === "up" ? "new-password" : "current-password"}
              className="input"
            />
            {mode === "up" && (
              <p className="mt-1.5 text-xs text-ink3">At least 8 characters.</p>
            )}
          </div>
        )}

        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? COPY[mode].busy : COPY[mode].submit}
        </button>

        <div className="flex flex-wrap gap-x-4">
          {mode !== "in" && (
            <button type="button" onClick={() => setMode("in")} className="btn-quiet">
              Log in
            </button>
          )}
          {mode !== "up" && (
            <button type="button" onClick={() => setMode("up")} className="btn-quiet">
              Create account
            </button>
          )}
          {mode !== "forgot" && (
            <button type="button" onClick={() => setMode("forgot")} className="btn-quiet">
              Forgot password
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
