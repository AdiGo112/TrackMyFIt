"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, getCurrentUserId } from "@/lib/db";
import { inToCm, lbToKg, type UnitPref } from "@/lib/units";
import { useUI } from "@/components/ui";

const ACTIVITY = ["sedentary", "light", "moderate", "active", "very_active"] as const;

/**
 * Step two of signing up: the account exists, the profile row does not. AuthGate
 * has already guaranteed a session by the time this renders, and the home page
 * sends anyone here whose users row is missing.
 */
export default function NewProfilePage() {
  const router = useRouter();
  const { toast } = useUI();
  const [busy, setBusy] = useState(false);

  async function create(form: FormData) {
    setBusy(true);
    const pref = form.get("unit_preference") as UnitPref;
    const num = (k: string) => {
      const v = form.get(k);
      return v === null || v === "" ? null : Number(v);
    };

    const height = num("height");
    const weight = num("weight");

    const { error } = await supabase.from("users").insert({
      // The primary key IS the auth uid — that is what every RLS policy checks.
      id: getCurrentUserId(),
      name: (form.get("name") as string).trim(),
      age: num("age"),
      gender: form.get("gender") as string,
      // always stored metric, whatever they typed in
      height_cm: height === null ? null : pref === "imperial" ? inToCm(height) : height,
      weight_kg: weight === null ? null : pref === "imperial" ? lbToKg(weight) : weight,
      activity_level: form.get("activity_level") as string,
      unit_preference: pref,
    });

    if (error) {
      toast(error.message, "bad");
      setBusy(false);
      return;
    }
    // A brand new profile has no split yet, so there is only one place to go.
    router.replace("/split");
  }

  return (
    <main>
      <header className="rise mb-8">
        <h1 className="display text-[2.5rem]">Almost there</h1>
        <p className="mt-1.5 text-sm text-ink2">
          A few numbers so the app can size your lifts. All of it is editable later.
        </p>
      </header>

      <form action={create} className="rise space-y-4">
        <h2 className="eyebrow">Your profile</h2>

        <div>
          <label className="label" htmlFor="name">
            Name
          </label>
          <input id="name" name="name" required className="input" autoComplete="name" />
        </div>

        <div>
          <label className="label" htmlFor="unit_preference">
            Units
          </label>
          <select
            id="unit_preference"
            name="unit_preference"
            className="input"
            defaultValue="metric"
          >
            <option value="metric">Metric — kg, cm</option>
            <option value="imperial">Imperial — lb, in</option>
          </select>
          <p className="mt-1.5 text-xs text-ink3">
            Display only. Everything is stored in kg and cm, so you can switch later
            without touching your history.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="age">
              Age
            </label>
            <input id="age" name="age" type="number" inputMode="numeric" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="gender">
              Gender
            </label>
            <select id="gender" name="gender" className="input" defaultValue="male">
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="height">
              Height
            </label>
            <input
              id="height"
              name="height"
              type="number"
              step="0.1"
              inputMode="decimal"
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="weight">
              Bodyweight
            </label>
            <input
              id="weight"
              name="weight"
              type="number"
              step="0.1"
              inputMode="decimal"
              className="input"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="activity_level">
            Activity level
          </label>
          <select
            id="activity_level"
            name="activity_level"
            className="input"
            defaultValue="moderate"
          >
            {ACTIVITY.map((a) => (
              <option key={a} value={a}>
                {a.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? "Creating…" : "Create profile"}
        </button>
        {/* The tab bar is hidden on this screen, so without this there is no way
            back out of a half-finished signup. */}
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="btn-quiet"
        >
          Log out
        </button>
      </form>
    </main>
  );
}
