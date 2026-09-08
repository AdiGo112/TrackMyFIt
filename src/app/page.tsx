"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, getCurrentUserId } from "@/lib/db";
import { daysSince, thisWeek, weekStreak } from "@/lib/stats";
import { Icon, PageSkeleton, useUI } from "@/components/ui";

type Day = {
  id: string;
  name: string;
  sort_order: number;
  count: number;
  preview: string;
};

const today = () =>
  new Date()
    .toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
    .toUpperCase();

/** '4 days ago' / 'today' / 'never'. Staleness is the whole reason to look. */
const ago = (iso?: string) => {
  if (!iso) return "never";
  const n = daysSince(iso);
  return n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
};

export default function Home() {
  const router = useRouter();
  const { confirm, toast } = useUI();

  const [name, setName] = useState("");
  const [days, setDays] = useState<Day[]>([]);
  const [lastByDay, setLastByDay] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string[]>([]);
  const [draft, setDraft] = useState<{ id: string; split_day_id: string | null } | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const uid = getCurrentUserId();
    if (!uid) return void router.replace("/users");

    (async () => {
      const [{ data: user }, { data: dayRows }, { data: draftRows }, { data: complete }] =
        await Promise.all([
          supabase.from("users").select("name").eq("id", uid).single(),
          supabase
            .from("split_days")
            .select("id, name, sort_order, split_day_exercises(sort_order, exercises(name))")
            .eq("user_id", uid)
            .order("sort_order"),
          supabase
            .from("sessions")
            .select("id, split_day_id")
            .eq("user_id", uid)
            .eq("status", "draft")
            .limit(1),
          supabase
            .from("sessions")
            .select("split_day_id, completed_at")
            .eq("user_id", uid)
            .eq("status", "complete")
            .order("completed_at", { ascending: false })
            .limit(300),
        ]);

      // Signed in but no profile yet: a fresh account, or the schema was reset
      // out from under an existing one. Either way, go fill the form in.
      if (!user) return router.replace("/users");
      setName(user.name);

      if (!dayRows?.length) return router.replace("/split");

      setDays(
        dayRows.map((d) => {
          const items = [...(d.split_day_exercises ?? [])].sort(
            (a, b) => a.sort_order - b.sort_order
          );
          const names = items.map(
            (i) => (i.exercises as unknown as { name: string }).name
          );
          return {
            id: d.id,
            name: d.name,
            sort_order: d.sort_order,
            count: names.length,
            preview:
              names.slice(0, 3).join(" · ") +
              (names.length > 3 ? ` +${names.length - 3}` : ""),
          };
        })
      );
      setDraft(draftRows?.[0] ?? null);

      // rows are already newest-first, so the first hit per day is the latest
      const last: Record<string, string> = {};
      for (const s of complete ?? []) {
        if (s.split_day_id && s.completed_at && !last[s.split_day_id]) {
          last[s.split_day_id] = s.completed_at;
        }
      }
      setLastByDay(last);
      setDone((complete ?? []).map((s) => s.completed_at).filter(Boolean) as string[]);
      setLoading(false);
    })();
  }, [router]);

  async function start(day: Day) {
    const userId = getCurrentUserId();
    if (!userId || starting) return;

    if (!day.count) {
      toast(`${day.name} has no exercises yet. Add some first.`, "bad");
      return;
    }
    // One draft per user is enforced by a partial unique index, so clear the old
    // one first rather than letting the insert fail.
    if (
      draft &&
      !(await confirm({
        title: "Discard the unfinished session?",
        body: "You have a session still open. Starting a new one throws away what is in it.",
        confirmLabel: "Discard and start",
        danger: true,
      }))
    )
      return;

    setStarting(true);
    if (draft) await supabase.from("sessions").delete().eq("id", draft.id);

    const { data, error } = await supabase
      .from("sessions")
      .insert({ user_id: userId, split_day_id: day.id, status: "draft" })
      .select("id")
      .single();

    if (error || !data) {
      setStarting(false);
      return toast(error?.message ?? "Could not start the session", "bad");
    }
    router.push(`/session/${data.id}`);
  }

  if (loading) return <PageSkeleton />;

  // What you should train is whatever has gone longest untouched. Never-trained
  // days sort first, then oldest; ties keep the order you wrote the split in.
  const rank = (d: Day) =>
    lastByDay[d.id] ? daysSince(lastByDay[d.id]) : Number.MAX_SAFE_INTEGER;
  const onDeck = days.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  const rest = days.filter((d) => d.id !== onDeck.id);

  const streak = weekStreak(done);
  const week = thisWeek(done);
  const deckLast = lastByDay[onDeck.id];

  return (
    <main>
      <header className="rise mb-6 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow mb-1.5">{today()}</p>
          <h1 className="display truncate text-[1.75rem]">{name}</h1>
        </div>
        {streak > 0 && (
          <span className="chip shrink-0 border border-line bg-raised py-1.5 text-ink2">
            <Icon name="flame" size={13} className="text-p15" />
            {streak} wk
          </span>
        )}
      </header>

      {draft && (
        <Link
          href={`/session/${draft.id}`}
          className="rise card knurl mb-4 flex items-center gap-3 p-4"
          style={{ animationDelay: "40ms" }}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-bg">
            <Icon name="play" size={16} strokeWidth={2} />
          </span>
          <span className="flex-1">
            <span className="eyebrow block">In progress</span>
            <span className="display block text-lg">Resume session</span>
          </span>
          <Icon name="right" size={18} className="text-ink3" />
        </Link>
      )}

      <section
        className="rise card knurl overflow-hidden p-5"
        style={{ animationDelay: "80ms" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="eyebrow">On deck</p>
            <h2 className="display mt-1.5 text-[2.125rem]">{onDeck.name}</h2>
            <p className="mt-2 truncate text-sm text-ink2">
              {onDeck.preview || "No exercises yet"}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="num text-[2rem] leading-none font-semibold">
              {deckLast ? daysSince(deckLast) : "—"}
            </p>
            <p className="eyebrow mt-1.5">{deckLast ? "days" : "new"}</p>
          </div>
        </div>

        <button
          onClick={() => start(onDeck)}
          disabled={starting}
          className="btn-primary mt-5"
        >
          <Icon name="play" size={15} strokeWidth={2} />
          Start {onDeck.name}
        </button>
      </section>

      {rest.length > 0 && (
        <section className="rise mt-7" style={{ animationDelay: "140ms" }}>
          <h2 className="eyebrow mb-2.5">Rest of the rotation</h2>
          <div className="space-y-2">
            {rest.map((d) => (
              <button
                key={d.id}
                onClick={() => start(d)}
                disabled={starting}
                className="card flex w-full items-center gap-3 p-4 text-left transition-colors hover:border-edge"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{d.name}</span>
                  <span className="eyebrow mt-0.5 block">
                    {d.count} {d.count === 1 ? "lift" : "lifts"} · {ago(lastByDay[d.id])}
                  </span>
                </span>
                <Icon name="right" size={17} className="shrink-0 text-ink3" />
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="rise mt-7" style={{ animationDelay: "200ms" }}>
        <h2 className="eyebrow mb-2.5">Consistency</h2>
        <div className="grid grid-cols-3 gap-2">
          {[
            { n: week, label: "this week" },
            { n: streak, label: "week streak" },
            { n: done.length, label: "all time" },
          ].map((s) => (
            <div key={s.label} className="card px-3 py-4 text-center">
              <p className="num text-[1.625rem] leading-none font-semibold">{s.n}</p>
              <p className="eyebrow mt-2">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      <Link
        href="/split"
        className="btn-quiet rise mt-4 !min-h-[44px] text-[0.8125rem]"
        style={{ animationDelay: "240ms" }}
      >
        <Icon name="layers" size={15} />
        Edit split
      </Link>
    </main>
  );
}
