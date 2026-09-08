"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, getCurrentUserId, type Exercise } from "@/lib/db";
import { Icon, PageSkeleton, useUI } from "@/components/ui";

type DayExercise = { id: string; sort_order: number; exercise: Exercise };
type Day = { id: string; name: string; sort_order: number; items: DayExercise[] };

/**
 * Starting points, not doctrine. Every name here exists in the seeded exercise
 * list, and applying one just writes ordinary rows — nothing about a split
 * built this way is different from one typed in by hand.
 */
const TEMPLATES: { name: string; note: string; days: [string, string[]][] }[] = [
  {
    name: "Push / Pull / Legs",
    note: "3 days · the default for a reason",
    days: [
      ["Push", ["Barbell Bench Press", "Overhead Press", "Incline DB Press", "Lateral Raise", "Tricep Pushdown"]],
      ["Pull", ["Deadlift", "Pull-up", "Seated Cable Row", "Face Pull", "Barbell Curl"]],
      ["Legs", ["Back Squat", "Romanian Deadlift", "Leg Press", "Leg Curl", "Calf Raise"]],
    ],
  },
  {
    name: "Upper / Lower",
    note: "4 days · most volume per session",
    days: [
      ["Upper A", ["Barbell Bench Press", "Barbell Row", "DB Shoulder Press", "Lat Pulldown", "DB Curl", "Tricep Pushdown"]],
      ["Lower A", ["Back Squat", "Romanian Deadlift", "Leg Press", "Leg Curl", "Calf Raise"]],
      ["Upper B", ["Overhead Press", "Pull-up", "Incline DB Press", "Seated Cable Row", "Hammer Curl", "Skull Crusher"]],
      ["Lower B", ["Deadlift", "Front Squat", "Walking Lunge", "Leg Extension", "Hanging Leg Raise"]],
    ],
  },
  {
    name: "Full body",
    note: "3 days · least time in the gym",
    days: [
      ["Full A", ["Back Squat", "Barbell Bench Press", "Barbell Row", "Plank"]],
      ["Full B", ["Deadlift", "Overhead Press", "Lat Pulldown", "Hanging Leg Raise"]],
      ["Full C", ["Front Squat", "Incline DB Press", "Seated Cable Row", "Cable Crunch"]],
    ],
  },
];

/** Swap sort_order between two rows to move one up/down. */
async function swapOrder(
  table: "split_days" | "split_day_exercises",
  a: { id: string; sort_order: number },
  b: { id: string; sort_order: number }
) {
  await Promise.all([
    supabase.from(table).update({ sort_order: b.sort_order }).eq("id", a.id),
    supabase.from(table).update({ sort_order: a.sort_order }).eq("id", b.id),
  ]);
}

export default function SplitPage() {
  const router = useRouter();
  const { toast, confirm } = useUI();
  const [days, setDays] = useState<Day[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDay, setNewDay] = useState("");
  const [picker, setPicker] = useState<Day | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from("split_days")
      .select("id, name, sort_order, split_day_exercises(id, sort_order, exercises(*))")
      .eq("user_id", uid)
      .order("sort_order");

    setDays(
      (data ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        sort_order: d.sort_order,
        items: (d.split_day_exercises ?? [])
          .map((i) => ({
            id: i.id,
            sort_order: i.sort_order,
            exercise: i.exercises as unknown as Exercise,
          }))
          .sort((a, b) => a.sort_order - b.sort_order),
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    const uid = getCurrentUserId();
    if (!uid) return void router.replace("/users");
    void (async () => {
      await load(uid);
    })();
  }, [load, router]);

  const refresh = () => {
    const uid = getCurrentUserId();
    if (uid) void load(uid);
  };

  async function addDay() {
    const name = newDay.trim();
    const userId = getCurrentUserId();
    if (!name || !userId) return;
    await supabase
      .from("split_days")
      .insert({ user_id: userId, name, sort_order: days.length });
    setNewDay("");
    refresh();
  }

  async function applyTemplate(t: (typeof TEMPLATES)[number]) {
    const userId = getCurrentUserId();
    if (!userId || busy) return;
    if (
      days.length &&
      !(await confirm({
        title: `Add ${t.name} to your split?`,
        body: `Your ${days.length} existing ${
          days.length === 1 ? "day stays" : "days stay"
        } put — these get added after them.`,
        confirmLabel: "Add days",
      }))
    )
      return;

    setBusy(true);
    const names = [...new Set(t.days.flatMap(([, list]) => list))];
    const { data: exs } = await supabase
      .from("exercises")
      .select("id, name")
      .in("name", names);
    const byName = new Map((exs ?? []).map((e) => [e.name, e.id]));

    let order = days.length;
    for (const [dayName, list] of t.days) {
      const { data: day } = await supabase
        .from("split_days")
        .insert({ user_id: userId, name: dayName, sort_order: order++ })
        .select("id")
        .single();
      if (!day) continue;

      const rows = list
        .map((n, i) => ({
          split_day_id: day.id,
          exercise_id: byName.get(n),
          sort_order: i,
        }))
        .filter((r) => r.exercise_id);
      if (rows.length) await supabase.from("split_day_exercises").insert(rows);
    }

    setBusy(false);
    setShowTemplates(false);
    toast(`${t.name} added`);
    refresh();
  }

  async function removeDay(day: Day) {
    const ok = await confirm({
      title: `Delete ${day.name}?`,
      body: "Sessions you already logged against this day stay in your history.",
      confirmLabel: "Delete day",
      danger: true,
    });
    if (!ok) return;
    await supabase.from("split_days").delete().eq("id", day.id);
    refresh();
  }

  async function addExercise(day: Day, ex: Exercise) {
    await supabase.from("split_day_exercises").insert({
      split_day_id: day.id,
      exercise_id: ex.id,
      sort_order: day.items.length,
    });
    refresh(); // picker stays open so they can add several in a row
  }

  async function removeExercise(rowId: string) {
    await supabase.from("split_day_exercises").delete().eq("id", rowId);
    refresh();
  }

  async function move<T extends { id: string; sort_order: number }>(
    table: "split_days" | "split_day_exercises",
    list: T[],
    index: number,
    dir: -1 | 1
  ) {
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    await swapOrder(table, list[index], list[target]);
    refresh();
  }

  if (loading) return <PageSkeleton />;

  const empty = days.length === 0;

  return (
    <main>
      <header className="rise mb-6 flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1.5">
            {empty ? "Set up" : `${days.length} training days`}
          </p>
          <h1 className="display text-[1.75rem]">Your split</h1>
        </div>
        {!empty && (
          <Link href="/" className="btn-sm">
            Done
          </Link>
        )}
      </header>

      {(empty || showTemplates) && (
        <section className="rise mb-6">
          <h2 className="eyebrow mb-2.5">Start from a template</h2>
          <div className="space-y-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.name}
                disabled={busy}
                onClick={() => applyTemplate(t)}
                className="card knurl flex w-full items-center gap-3 p-4 text-left transition-colors hover:border-edge disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="display block text-lg">{t.name}</span>
                  <span className="eyebrow mt-1 block">{t.note}</span>
                </span>
                <Icon name="arrowRight" size={17} className="shrink-0 text-ink3" />
              </button>
            ))}
          </div>
          <p className="eyebrow mt-3 text-center">
            {empty ? "or build your own below" : ""}
          </p>
        </section>
      )}

      <div className="space-y-3">
        {days.map((day, di) => (
          <section key={day.id} className="card rise p-4">
            <div className="mb-3 flex items-center gap-1.5">
              <h2 className="display min-w-0 flex-1 truncate text-lg">{day.name}</h2>
              <button
                className="btn-sm !min-w-[38px] !px-0"
                onClick={() => move("split_days", days, di, -1)}
                disabled={di === 0}
                aria-label={`Move ${day.name} up`}
              >
                <Icon name="up" size={15} />
              </button>
              <button
                className="btn-sm !min-w-[38px] !px-0"
                onClick={() => move("split_days", days, di, 1)}
                disabled={di === days.length - 1}
                aria-label={`Move ${day.name} down`}
              >
                <Icon name="arrowDown" size={15} />
              </button>
              <button
                className="btn-sm !min-w-[38px] !px-0 text-ink3 hover:!text-p25"
                onClick={() => removeDay(day)}
                aria-label={`Delete ${day.name}`}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>

            <ul className="mb-3 space-y-1">
              {day.items.map((item, ii) => (
                <li key={item.id} className="flex items-center gap-1.5">
                  <span className="num w-[15px] shrink-0 text-xs text-ink3">
                    {ii + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{item.exercise.name}</span>
                    <span className="eyebrow block">
                      {item.exercise.default_reps ?? "no range"} · {item.exercise.equipment}
                    </span>
                  </span>
                  <button
                    className="btn-sm !min-h-[36px] !min-w-[34px] !px-0"
                    onClick={() => move("split_day_exercises", day.items, ii, -1)}
                    disabled={ii === 0}
                    aria-label={`Move ${item.exercise.name} up`}
                  >
                    <Icon name="up" size={14} />
                  </button>
                  <button
                    className="btn-sm !min-h-[36px] !min-w-[34px] !px-0"
                    onClick={() => move("split_day_exercises", day.items, ii, 1)}
                    disabled={ii === day.items.length - 1}
                    aria-label={`Move ${item.exercise.name} down`}
                  >
                    <Icon name="arrowDown" size={14} />
                  </button>
                  <button
                    className="btn-sm !min-h-[36px] !min-w-[34px] !px-0 text-ink3 hover:!text-p25"
                    onClick={() => removeExercise(item.id)}
                    aria-label={`Remove ${item.exercise.name}`}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
              {day.items.length === 0 && (
                <li className="eyebrow py-2">No exercises yet</li>
              )}
            </ul>

            <button className="btn-ghost !min-h-[44px] text-sm" onClick={() => setPicker(day)}>
              <Icon name="plus" size={15} />
              Add exercise
            </button>
          </section>
        ))}
      </div>

      <div className="rise mt-5 flex gap-2">
        <input
          className="input"
          placeholder="New day, e.g. Push"
          value={newDay}
          onChange={(e) => setNewDay(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addDay()}
          aria-label="New training day name"
        />
        <button className="btn-sm !px-5" onClick={addDay} disabled={!newDay.trim()}>
          Add
        </button>
      </div>

      {!empty && (
        <button
          className="btn-quiet mt-2 !min-h-[44px] text-[0.8125rem]"
          onClick={() => setShowTemplates((v) => !v)}
        >
          <Icon name="layers" size={15} />
          {showTemplates ? "Hide templates" : "Add a template"}
        </button>
      )}

      {picker && (
        <ExercisePicker
          day={picker}
          onPick={(ex) => addExercise(picker, ex)}
          onClose={() => setPicker(null)}
        />
      )}
    </main>
  );
}

function ExercisePicker({
  day,
  onPick,
  onClose,
}: {
  day: Day;
  onPick: (ex: Exercise) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState<Exercise[]>([]);
  const [q, setQ] = useState("");
  const [archetype, setArchetype] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(
    () => new Set(day.items.map((i) => i.exercise.id))
  );

  useEffect(() => {
    supabase
      .from("exercises")
      .select("*")
      .order("name")
      .then(({ data }) => setAll(data ?? []));
  }, []);

  const archetypes = [...new Set(all.map((e) => e.archetype))];
  const term = q.trim().toLowerCase();
  const shown = all.filter(
    (e) =>
      (!archetype || e.archetype === archetype) &&
      (!term ||
        e.name.toLowerCase().includes(term) ||
        e.muscle_group.toLowerCase().includes(term) ||
        e.equipment.toLowerCase().includes(term))
  );

  return (
    <div className="fade-in fixed inset-0 z-50 flex flex-col bg-bg">
      <div
        className="mx-auto flex h-full w-full max-w-lg flex-col px-4"
        style={{
          paddingTop: "calc(1.5rem + env(safe-area-inset-top))",
          paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
        }}
      >
        <div className="mb-3 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="eyebrow mb-1">Add to</p>
            <h2 className="display truncate text-xl">{day.name}</h2>
          </div>
          <button className="btn-sm !px-4" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="relative mb-3">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink3"
          />
          <input
            className="input !pl-9"
            placeholder="Search name, muscle or kit"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            aria-label="Search exercises"
          />
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {archetypes.map((a) => (
            <button
              key={a}
              onClick={() => setArchetype(archetype === a ? null : a)}
              aria-pressed={archetype === a}
              className={`btn-sm !min-h-[36px] !px-3 font-mono text-[0.6875rem] tracking-[0.1em] uppercase ${
                archetype === a ? "!border-ink !bg-ink !text-bg" : ""
              }`}
            >
              {a}
            </button>
          ))}
        </div>

        <ul className="-mx-1 flex-1 space-y-1.5 overflow-y-auto px-1 pb-2">
          {shown.map((ex) => (
            <li key={ex.id}>
              <button
                className="card flex w-full items-center gap-3 p-3 text-left transition-colors hover:border-edge"
                onClick={() => {
                  onPick(ex);
                  setAdded(new Set(added).add(ex.id));
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{ex.name}</span>
                  <span className="eyebrow mt-0.5 block truncate">
                    {ex.muscle_group} · {ex.equipment} · {ex.default_reps ?? "no range"}
                  </span>
                </span>
                {added.has(ex.id) ? (
                  <Icon name="check" size={16} strokeWidth={2.4} className="shrink-0" />
                ) : (
                  <Icon name="plus" size={16} className="shrink-0 text-ink3" />
                )}
              </button>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="eyebrow py-6 text-center">No exercises match that</li>
          )}
        </ul>
      </div>
    </div>
  );
}
