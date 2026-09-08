"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, getCurrentUserId } from "@/lib/db";
import { fmtWeight, weightIn, weightUnit, type UnitPref } from "@/lib/units";
import { bestSet } from "@/lib/overload";
import { compact, volumeOf } from "@/lib/stats";
import { Empty, Icon, PageHead, PageSkeleton } from "@/components/ui";

type Set = { set_number: number; weight_kg: number; reps: number };
type Log = {
  id: string;
  suggested_next_weight_kg: number | null;
  is_deload: boolean;
  sort_order: number;
  exercises: { name: string };
  sets: Set[];
};
type Session = {
  id: string;
  started_at: string;
  completed_at: string;
  split_days: { name: string } | null;
  exercise_logs: Log[];
};

const monthOf = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });

export default function HistoryPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [pref, setPref] = useState<UnitPref>("metric");
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = getCurrentUserId();
    if (!uid) return void router.replace("/users");

    (async () => {
      const [{ data: user }, { data }] = await Promise.all([
        supabase.from("users").select("unit_preference").eq("id", uid).single(),
        supabase
          .from("sessions")
          .select(
            "id, started_at, completed_at, split_days(name), exercise_logs(id, sort_order, suggested_next_weight_kg, is_deload, exercises(name), sets(set_number, weight_kg, reps))"
          )
          .eq("user_id", uid)
          .eq("status", "complete")
          .order("completed_at", { ascending: false })
          .limit(100),
      ]);

      setPref((user?.unit_preference as UnitPref) ?? "metric");
      setSessions((data ?? []) as unknown as Session[]);
      setLoading(false);
    })();
  }, [router]);

  if (loading) return <PageSkeleton />;

  // Which log currently holds the best estimated 1RM for its exercise. Marking
  // it turns the log from a list of what happened into a list of what stands.
  const bestLog = new Map<string, { id: string; score: number }>();
  for (const s of sessions) {
    for (const l of s.exercise_logs) {
      const top = bestSet(l.sets)?.e1rm ?? 0;
      const cur = bestLog.get(l.exercises.name);
      if (top > 0 && (!cur || top > cur.score)) {
        bestLog.set(l.exercises.name, { id: l.id, score: top });
      }
    }
  }
  const bestIds = new Set([...bestLog.values()].map((b) => b.id));

  return (
    <main>
      <PageHead
        eyebrow={`${sessions.length} completed`}
        title="Training log"
      />

      {sessions.length === 0 ? (
        <Empty
          icon="clock"
          title="Nothing logged yet"
          body="Finished sessions land here, with every set and the target it earned you."
          action={
            <Link href="/" className="btn-primary">
              Start a session
            </Link>
          }
        />
      ) : (
        <div className="space-y-2">
          {sessions.map((s, i) => {
            const isOpen = open === s.id;
            const logs = [...s.exercise_logs].sort((a, b) => a.sort_order - b.sort_order);
            const sets = logs.reduce((n, l) => n + l.sets.length, 0);
            const volume = logs.reduce((t, l) => t + volumeOf(l.sets), 0);
            const mins = Math.round(
              (new Date(s.completed_at).getTime() - new Date(s.started_at).getTime()) /
                60000
            );

            // Month rules are derived from the neighbour, not carried in a
            // variable across iterations — the list is already newest-first.
            const month = monthOf(s.completed_at);
            const heading =
              i === 0 || monthOf(sessions[i - 1].completed_at) !== month ? month : null;

            return (
              <div key={s.id}>
                {heading && (
                  <h2 className={`eyebrow mb-2.5 ${i > 0 ? "mt-7" : ""}`}>{heading}</h2>
                )}

                <section
                  className={`card rise overflow-hidden transition-colors ${
                    isOpen ? "border-edge" : ""
                  }`}
                  style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                >
                  <button
                    onClick={() => setOpen(isOpen ? null : s.id)}
                    className="flex w-full items-center gap-3 p-4 text-left"
                    aria-expanded={isOpen}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate font-semibold">
                          {s.split_days?.name ?? "Workout"}
                        </span>
                        <span className="num shrink-0 text-xs text-ink3">
                          {new Date(s.completed_at).toLocaleDateString(undefined, {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                      </span>
                      <span className="eyebrow mt-1 block truncate">
                        {logs.length} lifts · {sets} sets
                        {volume > 0 &&
                          ` · ${compact(Math.round(weightIn(volume, pref)))} ${weightUnit(pref)}`}
                        {mins > 0 && mins < 600 && ` · ${mins} min`}
                      </span>
                    </span>
                    <Icon
                      name={isOpen ? "down" : "right"}
                      size={17}
                      className="shrink-0 text-ink3"
                    />
                  </button>

                  {isOpen && (
                    <div className="divider space-y-4 p-4">
                      {logs.map((l) => (
                        <div key={l.id}>
                          <div className="mb-1.5 flex items-center gap-2">
                            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
                              {l.exercises.name}
                            </h3>
                            {bestIds.has(l.id) && (
                              <span className="chip shrink-0 bg-p25/15 text-p25">
                                <Icon name="trophy" size={10} strokeWidth={2.2} />
                                best
                              </span>
                            )}
                            {l.is_deload && (
                              <span className="chip shrink-0 bg-p15/15 text-p15">
                                deload next
                              </span>
                            )}
                          </div>
                          <ul className="num space-y-0.5 text-[0.8125rem] text-ink2">
                            {[...l.sets]
                              .sort((a, b) => a.set_number - b.set_number)
                              .map((set, n) => (
                                <li key={set.set_number}>
                                  <span className="text-ink3">{n + 1}</span>{" "}
                                  {fmtWeight(set.weight_kg, pref)}{" "}
                                  <span className="text-ink3">×</span> {set.reps}
                                </li>
                              ))}
                          </ul>
                          {l.suggested_next_weight_kg != null && (
                            <p className="eyebrow mt-1.5">
                              next {fmtWeight(l.suggested_next_weight_kg, pref)}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
