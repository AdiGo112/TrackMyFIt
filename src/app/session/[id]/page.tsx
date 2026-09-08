"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase, getCurrentUserId, type Exercise } from "@/lib/db";
import {
  weightIn,
  weightToKg,
  weightUnit,
  fmtWeight,
  type UnitPref,
} from "@/lib/units";
import {
  suggestNext,
  bestSet,
  e1rm,
  type LoggedSet,
  type ExerciseMeta,
} from "@/lib/overload";
import { compact, volumeOf } from "@/lib/stats";
import { Icon, PageSkeleton, useUI, useLocalPref, buzz } from "@/components/ui";
import {
  PlateStrip,
  RestTimer,
  Stepper,
  clock,
  useBarWeight,
  useWakeLock,
} from "@/components/gym";

/** done = this set exists in the DB. Nothing is written until you log it. */
type SetRow = { set_number: number; weight: string; reps: string; done: boolean };
type PrevLog = { sets: LoggedSet[]; suggested: number | null; isDeload: boolean };
type Row = {
  exercise: Exercise;
  logId: string | null;
  sets: SetRow[];
  prev: PrevLog | null;
};

type Summary = {
  day: string;
  seconds: number;
  sets: number;
  volumeKg: number;
  prs: number;
  items: { name: string; top: string; next: number | null; deload: boolean }[];
};

export default function SessionPage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast, confirm } = useUI();

  const [rows, setRows] = useState<Row[]>([]);
  const [dayName, setDayName] = useState("");
  const [pref, setPref] = useState<UnitPref>("metric");
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [rest, setRest] = useState<number | null>(null);
  const [restSec] = useLocalPref<number>("rest_seconds", 120);

  const [bar] = useBarWeight(pref);
  useWakeLock(!loading && !summary);

  /** All-time best e1RM per exercise BEFORE this session — the bar a PR clears. */
  const [priorBest, setPriorBest] = useState<Map<string, number>>(() => new Map());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ---------------------------------------------------------------- load
  useEffect(() => {
    const uid = getCurrentUserId();
    if (!uid) return void router.replace("/users");

    (async () => {
      const { data: session } = await supabase
        .from("sessions")
        .select("id, status, started_at, split_day_id, split_days(name)")
        .eq("id", sessionId)
        .single();

      if (!session) return void router.replace("/");
      if (session.status === "complete") return void router.replace("/history");
      setDayName(
        (session.split_days as unknown as { name: string } | null)?.name ?? "Workout"
      );
      setStartedAt(new Date(session.started_at).getTime());

      const [{ data: user }, { data: planned }, { data: logs }, { data: completed }] =
        await Promise.all([
          supabase.from("users").select("unit_preference").eq("id", uid).single(),
          supabase
            .from("split_day_exercises")
            .select("sort_order, exercises(*)")
            .eq("split_day_id", session.split_day_id!)
            .order("sort_order"),
          supabase
            .from("exercise_logs")
            .select("id, exercise_id, sets(set_number, weight_kg, reps)")
            .eq("session_id", sessionId),
          supabase
            .from("sessions")
            .select("id")
            .eq("user_id", uid)
            .eq("status", "complete")
            .order("completed_at", { ascending: false })
            .limit(100),
        ]);

      const unitPref = (user?.unit_preference as UnitPref) ?? "metric";
      setPref(unitPref);

      const exercises = (planned ?? []).map((p) => p.exercises as unknown as Exercise);
      const completedIds = (completed ?? []).map((s) => s.id);

      // One query for every exercise's history, then pick the most recent per
      // exercise in JS — the completed-session list is already newest-first, so
      // its index is the recency rank. The same rows give the all-time best.
      const rank = new Map(completedIds.map((sid, i) => [sid, i]));
      const prevByExercise = new Map<string, PrevLog>();

      if (exercises.length && completedIds.length) {
        const { data: history } = await supabase
          .from("exercise_logs")
          .select(
            "exercise_id, session_id, suggested_next_weight_kg, is_deload, sets(weight_kg, reps)"
          )
          .in(
            "exercise_id",
            exercises.map((e) => e.id)
          )
          .in("session_id", completedIds);

        const best = new Map<string, number>();
        const bests = new Map<string, number>();
        for (const h of history ?? []) {
          const sets = (h.sets ?? []) as LoggedSet[];
          const top = bestSet(sets)?.e1rm ?? 0;
          if (top > (bests.get(h.exercise_id) ?? 0)) bests.set(h.exercise_id, top);

          const r = rank.get(h.session_id) ?? Infinity;
          if (r < (best.get(h.exercise_id) ?? Infinity)) {
            best.set(h.exercise_id, r);
            prevByExercise.set(h.exercise_id, {
              sets,
              suggested: h.suggested_next_weight_kg,
              isDeload: h.is_deload,
            });
          }
        }
        setPriorBest(bests);
      }

      const logByExercise = new Map(
        (logs ?? []).map((l) => [
          l.exercise_id,
          {
            id: l.id,
            sets: (l.sets ?? [])
              .sort((a, b) => a.set_number - b.set_number)
              .map((s) => ({
                set_number: s.set_number,
                weight: String(weightIn(s.weight_kg, unitPref)),
                reps: String(s.reps),
                done: true,
              })),
          },
        ])
      );

      setRows(
        exercises.map((exercise) => {
          const existing = logByExercise.get(exercise.id);
          return {
            exercise,
            logId: existing?.id ?? null,
            sets: existing?.sets ?? [],
            prev: prevByExercise.get(exercise.id) ?? null,
          };
        })
      );
      setOpen(exercises[0]?.id ?? null);
      setLoading(false);
    })();
  }, [sessionId, router]);

  // ------------------------------------------------------------- helpers
  const patch = (exId: string, fn: (r: Row) => Row) =>
    setRows((rs) => rs.map((r) => (r.exercise.id === exId ? fn(r) : r)));

  /**
   * What the input shows greyed-out when empty: last session's set at this
   * position, at the suggested weight if there is one. Logging with the field
   * left blank commits exactly this — the zero-typing path.
   */
  const placeholderFor = (row: Row, i: number) => {
    const p = row.prev?.sets[i];
    if (!p) return null;
    return {
      weight: String(weightIn(row.prev!.suggested ?? p.weight_kg, pref)),
      reps: String(p.reps),
    };
  };

  const ensureLog = useCallback(
    async (row: Row, sortOrder: number): Promise<string | null> => {
      if (row.logId) return row.logId;
      const { data, error } = await supabase
        .from("exercise_logs")
        .upsert(
          { session_id: sessionId, exercise_id: row.exercise.id, sort_order: sortOrder },
          { onConflict: "session_id,exercise_id" }
        )
        .select("id")
        .single();
      if (error || !data) {
        toast(error?.message ?? "Could not save that set", "bad");
        return null;
      }
      patch(row.exercise.id, (r) => ({ ...r, logId: data.id }));
      return data.id;
    },
    [sessionId, toast]
  );

  /** Logging a set is what writes it. Falls back to the placeholder when blank. */
  async function commitSet(exId: string, setNumber: number) {
    const idx = rows.findIndex((r) => r.exercise.id === exId);
    const row = rows[idx];
    const i = row.sets.findIndex((x) => x.set_number === setNumber);
    const s = row.sets[i];
    if (!s) return;

    const ph = placeholderFor(row, i);
    const weight = s.weight !== "" ? s.weight : (ph?.weight ?? "");
    const reps = s.reps !== "" ? s.reps : (ph?.reps ?? "");
    if (weight === "" || reps === "" || Number(reps) <= 0) {
      toast("Enter a weight and reps for this set.", "bad");
      return;
    }

    setSaving((n) => n + 1);
    const logId = await ensureLog(row, idx);
    if (logId) {
      const { error } = await supabase.from("sets").upsert(
        {
          exercise_log_id: logId,
          set_number: setNumber,
          weight_kg: weightToKg(Number(weight), pref),
          reps: Number(reps),
        },
        { onConflict: "exercise_log_id,set_number" }
      );
      if (error) {
        toast(error.message, "bad");
        setSaving((n) => n - 1);
        return;
      }
    }
    setSaving((n) => n - 1);
    buzz(14);

    // write the resolved values back so the row shows what was actually stored
    const after = row.sets.map((x) =>
      x.set_number === setNumber ? { ...x, weight, reps, done: true } : x
    );
    patch(exId, (r) => ({ ...r, sets: after }));

    // Rest starts the moment the set lands, not when you remember to press go.
    setRest((n) => (n ?? 0) + 1);

    const score = e1rm(weightToKg(Number(weight), pref), Number(reps));
    const prior = priorBest.get(exId) ?? 0;
    const sessionBest = Math.max(
      0,
      ...row.sets
        .filter((x) => x.done)
        .map((x) => e1rm(weightToKg(Number(x.weight), pref), Number(x.reps)))
    );
    if (prior > 0 && score > Math.max(prior, sessionBest)) {
      buzz([30, 60, 30, 60, 90]);
      toast(`PR on ${row.exercise.name} — ${weight} ${weightUnit(pref)} × ${reps}`);
    }

    // every planned set logged -> move to the next untouched exercise
    if (after.every((x) => x.done)) {
      const next = rows.find((r, j) => j > idx && r.sets.every((x) => !x.done));
      if (next) {
        setOpen(next.exercise.id);
        seedSets(next.exercise.id);
      }
    }
  }

  /** Undo to correct a mistake: removes the row, keeps the values to retype. */
  async function uncommitSet(exId: string, setNumber: number) {
    const row = rows.find((r) => r.exercise.id === exId)!;
    patch(exId, (r) => ({
      ...r,
      sets: r.sets.map((x) => (x.set_number === setNumber ? { ...x, done: false } : x)),
    }));
    if (row.logId) {
      await supabase
        .from("sets")
        .delete()
        .eq("exercise_log_id", row.logId)
        .eq("set_number", setNumber);
    }
  }

  /**
   * On expand: lay out one blank row per set you did last time so the
   * placeholders are visible immediately. Blank rows write nothing.
   */
  function seedSets(exId: string) {
    patch(exId, (r) => {
      if (r.sets.length === 0) {
        const n = Math.max(1, r.prev?.sets.length ?? 1);
        return {
          ...r,
          sets: Array.from({ length: n }, (_, i) => ({
            set_number: i + 1,
            weight: "",
            reps: "",
            done: false,
          })),
        };
      }
      // resumed mid-exercise with everything logged — offer the next set
      if (r.sets.every((x) => x.done)) return withExtraSet(r);
      return r;
    });
  }

  const withExtraSet = (r: Row): Row => {
    const next = r.sets.length ? Math.max(...r.sets.map((s) => s.set_number)) + 1 : 1;
    const last = r.sets[r.sets.length - 1];
    return {
      ...r,
      sets: [
        ...r.sets,
        { set_number: next, weight: last?.weight ?? "", reps: last?.reps ?? "", done: false },
      ],
    };
  };

  const addSet = (exId: string) => patch(exId, withExtraSet);

  async function removeSet(exId: string, setNumber: number) {
    const row = rows.find((r) => r.exercise.id === exId)!;
    patch(exId, (r) => ({ ...r, sets: r.sets.filter((s) => s.set_number !== setNumber) }));
    if (row.logId) {
      await supabase
        .from("sets")
        .delete()
        .eq("exercise_log_id", row.logId)
        .eq("set_number", setNumber);
    }
  }

  // -------------------------------------------------------------- finish
  async function finish() {
    if (finishing) return;
    const logged = rows.reduce((n, r) => n + r.sets.filter((s) => s.done).length, 0);

    if (!logged) {
      const drop = await confirm({
        title: "Nothing logged yet",
        body: "This session has no sets in it. Discard it rather than saving an empty workout?",
        confirmLabel: "Discard session",
        danger: true,
      });
      if (!drop) return;
      await supabase.from("sessions").delete().eq("id", sessionId);
      return router.replace("/");
    }

    const skipped = rows.filter((r) => !r.sets.some((s) => s.done)).length;
    const ok = await confirm({
      title: "Finish this workout?",
      body: `${logged} ${logged === 1 ? "set" : "sets"} logged${
        skipped ? `, ${skipped} ${skipped === 1 ? "exercise" : "exercises"} skipped` : ""
      }. Next-session targets get worked out now.`,
      confirmLabel: "Finish",
    });
    if (!ok) return;

    setFinishing(true);

    const uid = getCurrentUserId()!;

    // Re-read from the DB rather than trusting component state: the calc must not
    // depend on which accordion rows happened to be expanded.
    const { data: logs } = await supabase
      .from("exercise_logs")
      .select("id, exercise_id, exercises(*), sets(weight_kg, reps)")
      .eq("session_id", sessionId);

    const { data: completed } = await supabase
      .from("sessions")
      .select("id")
      .eq("user_id", uid)
      .eq("status", "complete")
      .order("completed_at", { ascending: false })
      .limit(100);

    const completedIds = (completed ?? []).map((s) => s.id);
    const rank = new Map(completedIds.map((sid, i) => [sid, i]));

    const prevByExercise = new Map<string, LoggedSet[]>();
    if (logs?.length && completedIds.length) {
      const { data: history } = await supabase
        .from("exercise_logs")
        .select("exercise_id, session_id, sets(weight_kg, reps)")
        .in(
          "exercise_id",
          logs.map((l) => l.exercise_id)
        )
        .in("session_id", completedIds);

      const best = new Map<string, number>();
      for (const h of history ?? []) {
        const r = rank.get(h.session_id) ?? Infinity;
        if (r < (best.get(h.exercise_id) ?? Infinity)) {
          best.set(h.exercise_id, r);
          prevByExercise.set(h.exercise_id, (h.sets ?? []) as LoggedSet[]);
        }
      }
    }

    const items: Summary["items"] = [];
    let sets = 0;
    let volumeKg = 0;
    let prs = 0;

    const ordered = [...(logs ?? [])].sort((a, b) =>
      rows.findIndex((r) => r.exercise.id === a.exercise_id) -
      rows.findIndex((r) => r.exercise.id === b.exercise_id)
    );

    for (const log of ordered) {
      const ex = log.exercises as unknown as ExerciseMeta;
      const logSets = (log.sets ?? []) as LoggedSet[];
      if (!logSets.length) {
        await supabase.from("exercise_logs").delete().eq("id", log.id);
        continue;
      }
      const { weightKg, isDeload } = suggestNext(
        logSets,
        ex,
        prevByExercise.get(log.exercise_id) ?? []
      );
      await supabase
        .from("exercise_logs")
        .update({ suggested_next_weight_kg: weightKg, is_deload: isDeload })
        .eq("id", log.id);

      const top = bestSet(logSets);
      const wasBest = priorBest.get(log.exercise_id) ?? 0;
      if (top && wasBest > 0 && top.e1rm > wasBest) prs++;
      sets += logSets.length;
      volumeKg += volumeOf(logSets);
      items.push({
        name: ex.name,
        top: top
          ? `${fmtWeight(top.weight_kg, pref)} × ${top.reps}`
          : `${logSets.length} sets`,
        next: weightKg,
        deload: isDeload,
      });
    }

    const { error } = await supabase
      .from("sessions")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .eq("id", sessionId);

    if (error) {
      toast(error.message, "bad");
      setFinishing(false);
      return;
    }

    buzz([40, 60, 40]);
    setRest(null);
    setSummary({
      day: dayName,
      seconds: startedAt ? Math.round((now - startedAt) / 1000) : 0,
      sets,
      volumeKg,
      prs,
      items,
    });
  }

  async function leave() {
    const ok = await confirm({
      title: "Leave this workout?",
      body: "Everything logged is already saved. The session stays open, so you can pick it up from the home screen.",
      confirmLabel: "Leave",
    });
    if (ok) router.replace("/");
  }

  // -------------------------------------------------------------- render
  if (loading) return <PageSkeleton />;

  if (summary) return <SummaryView s={summary} pref={pref} onDone={() => router.replace("/")} />;

  const doneExercises = rows.filter((r) => r.sets.some((s) => s.done)).length;
  const elapsed = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;

  return (
    <main className={rest !== null ? "pb-24" : "pb-10"}>
      <header className="rise mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow mb-1.5">In session</p>
          <h1 className="display truncate text-[1.75rem]">{dayName}</h1>
        </div>
        <button
          onClick={leave}
          className="btn-sm !min-h-[40px] !min-w-[40px] !px-0"
          aria-label="Leave workout"
        >
          <Icon name="x" size={16} />
        </button>
      </header>

      <div className="space-y-2">
        {rows.map((row, idx) => {
          const isOpen = open === row.exercise.id;
          const doneSets = row.sets.filter((s) => s.done);
          const activeIdx = row.sets.findIndex((s) => !s.done);
          const prior = priorBest.get(row.exercise.id) ?? 0;
          const leader = Math.max(
            0,
            ...doneSets.map((s) => e1rm(weightToKg(Number(s.weight), pref), Number(s.reps)))
          );

          const target = row.prev?.suggested ?? null;
          const prevSummary = row.prev?.sets.length
            ? row.prev.sets
                .map((s) => `${weightIn(s.weight_kg, pref)}×${s.reps}`)
                .join(" · ")
            : null;

          return (
            <section
              key={row.exercise.id}
              className={`card rise overflow-hidden transition-colors ${
                isOpen ? "border-edge" : ""
              }`}
              style={{ animationDelay: `${Math.min(idx, 6) * 35}ms` }}
            >
              <button
                onClick={() => {
                  setOpen(isOpen ? null : row.exercise.id);
                  if (!isOpen) seedSets(row.exercise.id);
                }}
                className="flex w-full items-center gap-3 p-4 text-left"
                aria-expanded={isOpen}
              >
                <span
                  className={`num flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold ${
                    doneSets.length
                      ? "bg-ink text-bg"
                      : "border border-line text-ink3"
                  }`}
                >
                  {doneSets.length || idx + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    {row.exercise.name}
                  </span>
                  <span className="eyebrow mt-0.5 block truncate">
                    {row.exercise.default_reps ?? "no range"} reps
                    {target !== null && ` · target ${fmtWeight(target, pref)}`}
                  </span>
                </span>
                {row.prev?.isDeload && (
                  <span className="chip shrink-0 bg-p15/15 text-p15">deload</span>
                )}
                <Icon
                  name={isOpen ? "down" : "right"}
                  size={17}
                  className="shrink-0 text-ink3"
                />
              </button>

              {isOpen && (
                <div className="divider p-4 pt-3.5">
                  {target !== null && (
                    <div className="mb-3.5">
                      <div className="mb-2 flex items-baseline gap-2">
                        <span className="eyebrow">Target</span>
                        <span className="num text-lg font-semibold">
                          {fmtWeight(target, pref)}
                        </span>
                        {row.prev?.isDeload && (
                          <span className="text-xs text-p15">back off and rebuild</span>
                        )}
                      </div>
                      {row.exercise.equipment === "barbell" && (
                        <PlateStrip totalKg={target} pref={pref} bar={bar} />
                      )}
                    </div>
                  )}

                  <p className="eyebrow mb-3">
                    {prevSummary ? (
                      <>
                        <span className="text-ink3">Last</span>{" "}
                        <span className="text-ink2">{prevSummary}</span>
                      </>
                    ) : (
                      "First time logging this"
                    )}
                  </p>

                  <div className="space-y-2">
                    {row.sets.map((s, i) => {
                      const ph = placeholderFor(row, i);

                      if (s.done) {
                        const score = e1rm(
                          weightToKg(Number(s.weight), pref),
                          Number(s.reps)
                        );
                        const isPr = prior > 0 && score > prior && score >= leader;
                        return (
                          <div
                            key={s.set_number}
                            className="flex items-center gap-3 rounded-[10px] border border-line bg-bg px-3 py-2.5"
                          >
                            <Icon
                              name="check"
                              size={15}
                              strokeWidth={2.4}
                              className="shrink-0 text-ink"
                            />
                            <span className="num flex-1 text-[0.9375rem] font-medium">
                              {s.weight}
                              <span className="text-ink3"> {weightUnit(pref)} × </span>
                              {s.reps}
                            </span>
                            {isPr && (
                              <span className="chip shrink-0 bg-p25/15 text-p25">
                                <Icon name="trophy" size={10} strokeWidth={2.2} />
                                pr
                              </span>
                            )}
                            <button
                              onClick={() => uncommitSet(row.exercise.id, s.set_number)}
                              className="text-ink3 transition-colors hover:text-ink"
                              aria-label={`Undo set ${i + 1}`}
                            >
                              <Icon name="refresh" size={15} />
                            </button>
                          </div>
                        );
                      }

                      if (i !== activeIdx) {
                        return (
                          <div
                            key={s.set_number}
                            className="flex items-center gap-3 px-3 py-2 text-ink3"
                          >
                            <span className="num w-[15px] text-[0.8125rem]">{i + 1}</span>
                            <span className="num flex-1 text-[0.8125rem]">
                              {ph ? `${ph.weight} ${weightUnit(pref)} × ${ph.reps}` : "—"}
                            </span>
                            <button
                              onClick={() => removeSet(row.exercise.id, s.set_number)}
                              aria-label={`Remove set ${i + 1}`}
                              className="transition-colors hover:text-p25"
                            >
                              <Icon name="x" size={14} />
                            </button>
                          </div>
                        );
                      }

                      // The set you are actually about to do gets the whole
                      // block: full-size steppers, no hunting for a small target.
                      return (
                        <div
                          key={s.set_number}
                          className="rounded-[10px] border border-edge bg-raised p-3"
                        >
                          <div className="mb-2.5 flex items-center justify-between">
                            <span className="eyebrow text-ink2">Set {i + 1}</span>
                            <button
                              onClick={() => removeSet(row.exercise.id, s.set_number)}
                              className="text-ink3 transition-colors hover:text-p25"
                              aria-label={`Remove set ${i + 1}`}
                            >
                              <Icon name="x" size={14} />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 gap-2.5 min-[360px]:grid-cols-2">
                            <div>
                              <p className="label">{weightUnit(pref)}</p>
                              <Stepper
                                value={s.weight}
                                placeholder={ph?.weight}
                                onChange={(v) =>
                                  patch(row.exercise.id, (r) => ({
                                    ...r,
                                    sets: r.sets.map((x) =>
                                      x.set_number === s.set_number
                                        ? { ...x, weight: v }
                                        : x
                                    ),
                                  }))
                                }
                                step={pref === "imperial" ? 5 : 2.5}
                                decimal
                                ariaLabel={`Set ${i + 1} weight`}
                              />
                            </div>
                            <div>
                              <p className="label">reps</p>
                              <Stepper
                                value={s.reps}
                                placeholder={ph?.reps}
                                onChange={(v) =>
                                  patch(row.exercise.id, (r) => ({
                                    ...r,
                                    sets: r.sets.map((x) =>
                                      x.set_number === s.set_number ? { ...x, reps: v } : x
                                    ),
                                  }))
                                }
                                step={1}
                                ariaLabel={`Set ${i + 1} reps`}
                              />
                            </div>
                          </div>

                          <button
                            className="btn-primary mt-2.5"
                            onClick={() => commitSet(row.exercise.id, s.set_number)}
                          >
                            <Icon name="check" size={16} strokeWidth={2.4} />
                            Log set {i + 1}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <button
                    className="btn-quiet mt-2 !min-h-[44px] text-[0.8125rem]"
                    onClick={() => addSet(row.exercise.id)}
                  >
                    <Icon name="plus" size={14} />
                    Add set
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* Everything live sits where the thumb already is. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 backdrop-blur-xl">
        <div className="safe-b mx-auto max-w-lg space-y-2 px-4 py-3">
          {rest !== null && (
            // key: a new set restarts the timer by remounting it
            <RestTimer key={rest} seconds={restSec} onDismiss={() => setRest(null)} />
          )}
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="num text-[1.0625rem] leading-none font-semibold">
                {clock(elapsed)}
              </p>
              <p className="eyebrow mt-1 truncate">
                {doneExercises}/{rows.length} done
                {saving > 0 && " · saving"}
              </p>
            </div>
            <button
              onClick={finish}
              disabled={finishing}
              className="btn-primary !w-auto !min-h-[46px] px-6"
            >
              {finishing ? "Saving…" : "Finish"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

/* ═══════════════════════════════════════════════════════════════
   The payoff screen. The overload suggestions are the whole point
   of the app and used to be buried three taps deep in history.
   ═══════════════════════════════════════════════════════════════ */

function SummaryView({
  s,
  pref,
  onDone,
}: {
  s: Summary;
  pref: UnitPref;
  onDone: () => void;
}) {
  return (
    <main>
      <header className="rise mb-6">
        <p className="eyebrow mb-1.5">{s.day} · logged</p>
        <h1 className="display text-[2.125rem]">Session done</h1>
      </header>

      <div className="rise card knurl grid grid-cols-3 gap-2 p-5" style={{ animationDelay: "60ms" }}>
        {[
          { n: clock(s.seconds), label: "duration" },
          { n: String(s.sets), label: "sets" },
          { n: compact(Math.round(weightIn(s.volumeKg, pref))), label: `${weightUnit(pref)} volume` },
        ].map((x) => (
          <div key={x.label} className="text-center">
            <p className="num text-[1.375rem] leading-none font-semibold">{x.n}</p>
            <p className="eyebrow mt-2">{x.label}</p>
          </div>
        ))}
      </div>

      {s.prs > 0 && (
        <div
          className="rise mt-3 flex items-center gap-3 rounded-[12px] border border-p25/40 bg-p25/[0.08] p-4"
          style={{ animationDelay: "110ms" }}
        >
          <Icon name="trophy" size={20} className="shrink-0 text-p25" />
          <p className="text-sm font-semibold">
            {s.prs} personal {s.prs === 1 ? "record" : "records"} today
          </p>
        </div>
      )}

      <section className="rise mt-7" style={{ animationDelay: "160ms" }}>
        <h2 className="eyebrow mb-2.5">Next time, lift this</h2>
        <div className="space-y-2">
          {s.items.map((it) => (
            <div key={it.name} className="card flex items-center gap-3 p-4">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{it.name}</span>
                <span className="eyebrow mt-0.5 block">today {it.top}</span>
              </span>
              {it.next !== null ? (
                <span className="shrink-0 text-right">
                  <span className="num block text-[0.9375rem] font-semibold">
                    {fmtWeight(it.next, pref)}
                  </span>
                  {it.deload && (
                    <span className="chip mt-0.5 bg-p15/15 text-p15">deload</span>
                  )}
                </span>
              ) : (
                <span className="eyebrow shrink-0">no target</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <button className="btn-primary mt-7" onClick={onDone}>
        Done
      </button>
    </main>
  );
}
