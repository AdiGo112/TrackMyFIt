"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, getCurrentUserId } from "@/lib/db";
import { fmtWeight, weightIn, weightUnit, type UnitPref } from "@/lib/units";
import { bestSet } from "@/lib/overload";
import { compact, dayKey, mondayOf, volumeOf, weekStreak } from "@/lib/stats";
import { Empty, PageHead, PageSkeleton, Segmented } from "@/components/ui";

type Set = { weight_kg: number; reps: number };
type Log = { exercises: { name: string }; sets: Set[] };
type Session = { id: string; completed_at: string; exercise_logs: Log[] };

const shortDate = (iso: string | Date) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export default function StatsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [pref, setPref] = useState<UnitPref>("metric");
  const [loading, setLoading] = useState(true);
  const [weeks, setWeeks] = useState(8);
  const [lift, setLift] = useState("");
  // Pinned at load so every derived bucket is pure for the rest of the render.
  const [asOf, setAsOf] = useState<number>(0);

  useEffect(() => {
    const uid = getCurrentUserId();
    if (!uid) return void router.replace("/users");

    void (async () => {
      const [{ data: user }, { data }] = await Promise.all([
        supabase.from("users").select("unit_preference").eq("id", uid).single(),
        supabase
          .from("sessions")
          .select("id, completed_at, exercise_logs(exercises(name), sets(weight_kg, reps))")
          .eq("user_id", uid)
          .eq("status", "complete")
          .order("completed_at", { ascending: false })
          .limit(200),
      ]);

      setPref((user?.unit_preference as UnitPref) ?? "metric");
      setSessions((data ?? []) as unknown as Session[]);
      setAsOf(Date.now());
      setLoading(false);
    })();
  }, [router]);

  const unit = weightUnit(pref);

  /** Every lift with a scoring set, best first — the PR board and the picker. */
  const records = useMemo(() => {
    const byLift = new Map<
      string,
      { name: string; weight_kg: number; reps: number; e1rm: number; date: string }
    >();
    for (const s of sessions) {
      for (const l of s.exercise_logs) {
        const top = bestSet(l.sets);
        if (!top) continue;
        const cur = byLift.get(l.exercises.name);
        if (!cur || top.e1rm > cur.e1rm) {
          byLift.set(l.exercises.name, {
            name: l.exercises.name,
            weight_kg: top.weight_kg,
            reps: top.reps,
            e1rm: top.e1rm,
            date: s.completed_at,
          });
        }
      }
    }
    return [...byLift.values()].sort((a, b) => b.e1rm - a.e1rm);
  }, [sessions]);

  /** Weekly volume, including the weeks you did nothing — absence is the point. */
  const weekly = useMemo(() => {
    if (!asOf) return [];
    const bucket = new Map<string, { volume: number; sessions: number }>();
    for (const s of sessions) {
      const k = dayKey(mondayOf(new Date(s.completed_at)));
      const b = bucket.get(k) ?? { volume: 0, sessions: 0 };
      b.volume += s.exercise_logs.reduce((t, l) => t + volumeOf(l.sets), 0);
      b.sessions += 1;
      bucket.set(k, b);
    }
    return Array.from({ length: weeks }, (_, i) => {
      const start = mondayOf(new Date(asOf));
      start.setDate(start.getDate() - (weeks - 1 - i) * 7);
      const b = bucket.get(dayKey(start)) ?? { volume: 0, sessions: 0 };
      return { start, ...b };
    });
  }, [sessions, weeks, asOf]);

  /** Estimated 1RM per session for one lift, oldest first. */
  const trend = useMemo(() => {
    if (!lift) return [];
    return sessions
      .flatMap((s) => {
        const log = s.exercise_logs.find((l) => l.exercises.name === lift);
        const top = log && bestSet(log.sets);
        return top ? [{ date: s.completed_at, value: top.e1rm, top }] : [];
      })
      .reverse();
  }, [sessions, lift]);

  if (loading) return <PageSkeleton />;

  if (!sessions.length) {
    return (
      <main>
        <PageHead eyebrow="Progress" title="Nothing to plot" />
        <Empty
          icon="chart"
          title="No sessions yet"
          body="Volume, records and per-lift trends all build themselves out of your logged sets."
          action={
            <Link href="/" className="btn-primary">
              Start a session
            </Link>
          }
        />
      </main>
    );
  }

  const totalVolume = sessions.reduce(
    (t, s) => t + s.exercise_logs.reduce((v, l) => v + volumeOf(l.sets), 0),
    0
  );
  const totalSets = sessions.reduce(
    (t, s) => t + s.exercise_logs.reduce((v, l) => v + l.sets.length, 0),
    0
  );

  return (
    <main>
      <PageHead eyebrow="Progress" title="The numbers" />

      <section className="rise grid grid-cols-3 gap-2">
        {[
          { n: String(sessions.length), label: "sessions" },
          { n: compact(Math.round(weightIn(totalVolume, pref))), label: `${unit} lifted` },
          { n: String(weekStreak(sessions.map((s) => s.completed_at))), label: "week streak" },
        ].map((s) => (
          <div key={s.label} className="card px-3 py-4 text-center">
            <p className="num text-[1.625rem] leading-none font-semibold">{s.n}</p>
            <p className="eyebrow mt-2">{s.label}</p>
          </div>
        ))}
      </section>

      <section className="rise mt-7" style={{ animationDelay: "60ms" }}>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="eyebrow mb-1">Weekly volume</h2>
            <p className="num text-lg font-semibold">
              {compact(Math.round(weightIn(weekly.at(-1)?.volume ?? 0, pref)))} {unit}
              <span className="eyebrow ml-1.5">this week</span>
            </p>
          </div>
          <div className="w-[128px] shrink-0">
            <Segmented
              label="Weeks shown"
              value={weeks}
              onChange={setWeeks}
              options={[
                { value: 8, label: "8w" },
                { value: 26, label: "26w" },
              ]}
            />
          </div>
        </div>
        <VolumeBars data={weekly} pref={pref} />
      </section>

      <section className="rise mt-7" style={{ animationDelay: "120ms" }}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="eyebrow">Strength trend</h2>
          <select
            className="input !w-auto !py-2 text-sm"
            value={lift}
            onChange={(e) => setLift(e.target.value)}
            aria-label="Exercise to plot"
          >
            <option value="">Pick a lift…</option>
            {records.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        {lift ? (
          <TrendLine data={trend} pref={pref} name={lift} />
        ) : (
          <p className="card px-4 py-8 text-center text-sm text-ink2">
            Choose a lift to see its estimated 1RM over time.
          </p>
        )}
      </section>

      <section className="rise mt-7" style={{ animationDelay: "180ms" }}>
        <h2 className="eyebrow mb-2.5">Records</h2>
        <ul className="space-y-2">
          {records.map((r, i) => (
            <li key={r.name} className="card flex items-center gap-3 p-4">
              <span className="num w-5 shrink-0 text-xs text-ink3">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{r.name}</span>
                <span className="eyebrow mt-0.5 block">{shortDate(r.date)}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="num block text-[0.9375rem] font-semibold">
                  {fmtWeight(r.weight_kg, pref)} × {r.reps}
                </span>
                <span className="eyebrow mt-0.5 block">
                  ≈{Math.round(weightIn(r.e1rm, pref))} {unit} 1rm
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="eyebrow mt-2.5">
          {totalSets} sets logged · 1RM is an Epley estimate, not a lift you have made
        </p>
      </section>
    </main>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Charts. Both are single-series, so they wear the same bone the
   rest of the interface wears — colour in this app means plate
   weight, and a chart is not a plate.
   ═══════════════════════════════════════════════════════════════ */

function VolumeBars({
  data,
  pref,
}: {
  data: { start: Date; volume: number; sessions: number }[];
  pref: UnitPref;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.volume));
  const shown = hover === null ? data.length - 1 : hover;
  const active = data[shown];

  return (
    <div className="card p-4">
      <div className="relative">
        {/* one recessive reference line at the peak, nothing else */}
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-line" />

        <div
          className="flex h-32 items-end gap-[2px]"
          onPointerLeave={() => setHover(null)}
          role="list"
          aria-label="Weekly training volume"
        >
          {data.map((d, i) => {
            const pct = (d.volume / max) * 100;
            return (
              <button
                key={d.start.toISOString()}
                role="listitem"
                aria-label={`Week of ${shortDate(d.start)}: ${Math.round(
                  weightIn(d.volume, pref)
                )} ${weightUnit(pref)} across ${d.sessions} ${
                  d.sessions === 1 ? "session" : "sessions"
                }`}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onClick={() => setHover(i)}
                className={`min-w-0 flex-1 rounded-t-[4px] transition-colors ${
                  i === shown ? "bg-ink" : "bg-ink/30 hover:bg-ink/55"
                }`}
                style={{ height: `${Math.max(pct, d.volume > 0 ? 3 : 1.5)}%` }}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-2.5 flex items-baseline justify-between gap-2 border-t border-line pt-2.5">
        <span className="eyebrow">
          {shortDate(active.start)}
          {hover === null && " · latest"}
        </span>
        <span className="num text-[0.8125rem] font-medium">
          {active.volume > 0
            ? `${compact(Math.round(weightIn(active.volume, pref)))} ${weightUnit(pref)} · ${
                active.sessions
              } ${active.sessions === 1 ? "session" : "sessions"}`
            : "rest week"}
        </span>
      </div>
    </div>
  );
}

function TrendLine({
  data,
  pref,
  name,
}: {
  data: { date: string; value: number; top: { weight_kg: number; reps: number } }[];
  pref: UnitPref;
  name: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  // Measure rather than stretch: a viewBox scaled to fit turns the 4px hover
  // dot into an ellipse and misplaces every hit target.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(320);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(120, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (data.length < 2) {
    return (
      <p className="card px-4 py-8 text-center text-sm text-ink2">
        {data.length === 1
          ? `Only one session of ${name} so far. A trend needs two.`
          : `No sets logged for ${name} yet.`}
      </p>
    );
  }

  const H = 110;
  const values = data.map((d) => d.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  // 8% headroom top and bottom so the extremes are not welded to the frame
  const x = (i: number) => (i / (data.length - 1)) * W;
  const y = (v: number) => H - 0.08 * H - ((v - lo) / span) * H * 0.84;

  const line = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const shown = hover ?? data.length - 1;
  const pt = data[shown];
  const change = data[data.length - 1].value - data[0].value;

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="num text-lg font-semibold">
          ≈{Math.round(weightIn(pt.value, pref))} {weightUnit(pref)}
        </span>
        <span className="eyebrow">
          est 1rm · {shortDate(pt.date)} · {fmtWeight(pt.top.weight_kg, pref)} ×{" "}
          {pt.top.reps}
        </span>
      </div>

      <div ref={box}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={`Estimated one-rep max for ${name} across ${data.length} sessions, from ${Math.round(
          weightIn(data[0].value, pref)
        )} to ${Math.round(weightIn(data[data.length - 1].value, pref))} ${weightUnit(pref)}`}
        className="overflow-visible"
        onPointerLeave={() => setHover(null)}
      >
        <polygon
          points={`0,${H} ${line} ${W},${H}`}
          fill="var(--color-ink)"
          opacity="0.07"
        />
        <polyline
          points={line}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={x(shown)}
          cy={y(pt.value)}
          r="4"
          fill="var(--color-ink)"
          stroke="var(--color-surface)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {/* invisible hit slabs, one per point, wider than the marks */}
        {data.map((d, i) => (
          <rect
            key={d.date}
            x={x(i) - W / data.length / 2}
            y={0}
            width={W / data.length}
            height={H}
            fill="transparent"
            onPointerEnter={() => setHover(i)}
            onPointerDown={() => setHover(i)}
          />
        ))}
      </svg>
      </div>

      <div className="mt-2.5 flex items-baseline justify-between gap-2 border-t border-line pt-2.5">
        <span className="eyebrow">{shortDate(data[0].date)}</span>
        <span
          className={`num text-[0.8125rem] font-medium ${change < 0 ? "text-ink2" : ""}`}
        >
          {change >= 0 ? "+" : ""}
          {Math.round(weightIn(change, pref))} {weightUnit(pref)} over {data.length}{" "}
          sessions
        </span>
      </div>
    </div>
  );
}
