"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, watchAuth } from "@/lib/db";
import { useUI } from "@/components/ui";

/**
 * Where the emailed reset link lands. supabase-js exchanges the token in the URL
 * for a real session on load (detectSessionInUrl), so by the time a session shows
 * up here the holder has proved they can read that inbox — updateUser is enough,
 * no old password needed.
 */
export default function ResetPage() {
  const router = useRouter();
  const { toast } = useUI();
  const [ready, setReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => watchAuth((id) => setReady(id !== null)), []);

  async function submit(form: FormData) {
    setBusy(true);
    const { error } = await supabase.auth.updateUser({
      password: form.get("password") as string,
    });
    setBusy(false);
    if (error) return toast(error.message, "bad");
    toast("Password updated");
    router.replace("/");
  }

  if (ready === null) return null;

  if (!ready) {
    return (
      <main>
        <section className="rise">
          <h1 className="eyebrow mb-2.5">Link expired</h1>
          <p className="text-sm text-ink2">
            Reset links are single use and time limited. Ask for a fresh one.
          </p>
          <button onClick={() => router.replace("/login")} className="btn-quiet mt-4">
            Back to log in
          </button>
        </section>
      </main>
    );
  }

  return (
    <main>
      <form action={submit} className="rise space-y-4">
        <h1 className="eyebrow">Choose a new password</h1>
        <div>
          <label className="label" htmlFor="password">
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="input"
          />
          <p className="mt-1.5 text-xs text-ink3">At least 8 characters.</p>
        </div>
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? "Saving…" : "Save password"}
        </button>
      </form>
    </main>
  );
}
