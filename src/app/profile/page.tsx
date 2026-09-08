"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, getCurrentUserId, type User } from "@/lib/db";
import { cmToIn, inToCm, kgToLb, lbToKg, type UnitPref } from "@/lib/units";
import {
  Icon,
  PageHead,
  PageSkeleton,
  Segmented,
  useLocalPref,
  useUI,
} from "@/components/ui";
import { useBarWeight } from "@/components/gym";

const ACTIVITY = ["sedentary", "light", "moderate", "active", "very_active"] as const;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** WHO adult categories. Stated plainly, with the caveat it deserves. */
function bmiBand(bmi: number) {
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "healthy range";
  if (bmi < 30) return "overweight";
  return "obese";
}

export default function ProfilePage() {
  const router = useRouter();
  const { toast, confirm } = useUI();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [pref, setPref] = useState<UnitPref>("metric");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("male");
  const [activity, setActivity] = useState("moderate");
  // held in display units, converted at the edges — the DB is always kg/cm
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");

  const [bar, setBar] = useBarWeight(pref);
  const [rest, setRest] = useLocalPref<number>("rest_seconds", 120);

  useEffect(() => {
    const uid = getCurrentUserId();
    if (!uid) return void router.replace("/users");

    void (async () => {
      const { data } = await supabase
        .from("users")
        .select("*")
        .eq("id", uid)
        .single<User>();

      if (!data) return router.replace("/users");
      const p = (data.unit_preference as UnitPref) ?? "metric";
      setName(data.name);
      setPref(p);
      setAge(data.age === null ? "" : String(data.age));
      setGender(data.gender ?? "male");
      setActivity(data.activity_level ?? "moderate");
      setHeight(
        data.height_cm === null
          ? ""
          : String(round1(p === "imperial" ? cmToIn(data.height_cm) : data.height_cm))
      );
      setWeight(
        data.weight_kg === null
          ? ""
          : String(round1(p === "imperial" ? kgToLb(data.weight_kg) : data.weight_kg))
      );
      setLoading(false);
    })();
  }, [router]);

  /** Switching units rewrites what is on screen so the number keeps describing
   *  the same body, rather than silently reinterpreting 180 cm as 180 inches. */
  function switchUnits(next: UnitPref) {
    if (next === pref) return;
    const conv = (v: string, toImperial: (n: number) => number, toMetric: (n: number) => number) =>
      v === "" ? v : String(round1(next === "imperial" ? toImperial(Number(v)) : toMetric(Number(v))));
    setHeight((h) => conv(h, cmToIn, inToCm));
    setWeight((w) => conv(w, kgToLb, lbToKg));
    setPref(next);
  }

  async function save() {
    const uid = getCurrentUserId();
    if (!uid || saving) return;
    if (!name.trim()) return toast("A profile needs a name.", "bad");

    setSaving(true);
    const num = (v: string) => (v === "" ? null : Number(v));
    const h = num(height);
    const w = num(weight);

    const { error } = await supabase
      .from("users")
      .update({
        name: name.trim(),
        age: num(age),
        gender,
        activity_level: activity,
        unit_preference: pref,
        height_cm: h === null ? null : pref === "imperial" ? inToCm(h) : h,
        weight_kg: w === null ? null : pref === "imperial" ? lbToKg(w) : w,
      })
      .eq("id", uid);

    setSaving(false);
    toast(error ? error.message : "Profile saved", error ? "bad" : "info");
  }

  async function remove() {
    const uid = getCurrentUserId();
    if (!uid) return;
    const ok = await confirm({
      title: `Delete ${name}?`,
      body: "Every session, set and split for this profile is deleted with it. This cannot be undone.",
      confirmLabel: "Delete everything",
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("users").delete().eq("id", uid);
    if (error) return toast(error.message, "bad");
    // ponytail: the profile and all its history go, the auth account stays —
    // deleting that needs the service_role key, which has no business in a
    // browser. Logging back in lands on the empty profile form.
    await supabase.auth.signOut();
  }

  if (loading) return <PageSkeleton />;

  const cm = height === "" ? null : pref === "imperial" ? inToCm(Number(height)) : Number(height);
  const kg = weight === "" ? null : pref === "imperial" ? lbToKg(Number(weight)) : Number(weight);
  const bmi = cm && kg && cm > 0 ? kg / (cm / 100) ** 2 : null;

  const barOptions =
    pref === "imperial"
      ? [
          { value: 35, label: "35 lb" },
          { value: 45, label: "45 lb" },
          { value: 55, label: "55 lb" },
        ]
      : [
          { value: 15, label: "15 kg" },
          { value: 20, label: "20 kg" },
          { value: 25, label: "25 kg" },
        ];

  return (
    <main>
      <PageHead eyebrow="Profile" title={name || "You"} />

      <section className="rise space-y-4">
        <div>
          <label className="label" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <p className="label">Units</p>
          <Segmented
            label="Units"
            value={pref}
            onChange={switchUnits}
            options={[
              { value: "metric", label: "kg · cm" },
              { value: "imperial", label: "lb · in" },
            ]}
          />
          <p className="mt-1.5 text-xs text-ink3">
            Display only. Your history is stored in kg, so switching never
            rewrites a single logged set.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="age">
              Age
            </label>
            <input
              id="age"
              type="number"
              inputMode="numeric"
              className="input"
              value={age}
              onChange={(e) => setAge(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="gender">
              Gender
            </label>
            <select
              id="gender"
              className="input"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="height">
              Height · {pref === "imperial" ? "in" : "cm"}
            </label>
            <input
              id="height"
              type="number"
              step="0.1"
              inputMode="decimal"
              className="input"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="weight">
              Bodyweight · {pref === "imperial" ? "lb" : "kg"}
            </label>
            <input
              id="weight"
              type="number"
              step="0.1"
              inputMode="decimal"
              className="input"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="activity">
            Activity level
          </label>
          <select
            id="activity"
            className="input"
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
          >
            {ACTIVITY.map((a) => (
              <option key={a} value={a}>
                {a.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>

        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save profile"}
        </button>
      </section>

      {bmi && (
        <section className="rise mt-7">
          <h2 className="eyebrow mb-2.5">Body mass index</h2>
          <div className="card flex items-center gap-4 p-4">
            <p className="num text-[1.75rem] leading-none font-semibold">
              {bmi.toFixed(1)}
            </p>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{bmiBand(bmi)}</p>
              <p className="mt-0.5 text-xs text-ink3">
                Height and weight only — it does not know how much of you is
                muscle, so treat it as one number among many.
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="rise mt-7">
        <h2 className="eyebrow mb-2.5">This device</h2>
        <div className="card space-y-4 p-4">
          <div>
            <p className="label">Bar weight</p>
            <Segmented
              label="Bar weight"
              value={bar}
              onChange={setBar}
              options={barOptions}
            />
            <p className="mt-1.5 text-xs text-ink3">
              What the plate diagram subtracts before splitting the rest across
              two sleeves.
            </p>
          </div>
          <div>
            <p className="label">Rest between sets</p>
            <Segmented
              label="Rest between sets"
              value={rest}
              onChange={setRest}
              options={[
                { value: 60, label: "1:00" },
                { value: 90, label: "1:30" },
                { value: 120, label: "2:00" },
                { value: 180, label: "3:00" },
              ]}
            />
          </div>
        </div>
        <p className="eyebrow mt-2">
          Kept on this phone, not on the account — a different gym has a
          different bar.
        </p>
      </section>

      <section className="rise mt-7">
        <h2 className="eyebrow mb-2.5">Account</h2>
        <div className="space-y-2">
          <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>
            <Icon name="users" size={16} />
            Log out
          </button>
          <button className="btn-quiet !text-p25" onClick={remove}>
            <Icon name="trash" size={16} />
            Delete this profile
          </button>
        </div>
      </section>
    </main>
  );
}
