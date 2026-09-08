/**
 * Date bucketing and session aggregates. Pure functions, no DB access.
 * Shared by the home screen, history, the finish summary and progress.
 *
 * Self-check: `npm run check`.
 */

const DAY = 86_400_000;

/** Local calendar key, YYYY-MM-DD. Not toISOString(), which is UTC and rolls
 *  the date over for anyone east of Greenwich after their evening session. */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

/** Monday of the week containing `d`, pinned to noon so adding or subtracting
 *  whole days can never land on the wrong side of a DST boundary. */
export function mondayOf(d: Date) {
  const t = new Date(d);
  t.setHours(12, 0, 0, 0);
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  return t;
}

export const daysSince = (iso: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));

/**
 * Consecutive weeks with at least one session, counting back from now.
 *
 * The current week is allowed to be empty without breaking the streak — it is
 * Monday morning for someone, and a tracker that resets your streak at midnight
 * on Sunday is a tracker people stop opening.
 */
export function weekStreak(isoDates: string[], now = new Date()) {
  const weeks = new Set(isoDates.map((d) => dayKey(mondayOf(new Date(d)))));
  const cursor = mondayOf(now);
  if (!weeks.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 7);

  let n = 0;
  while (weeks.has(dayKey(cursor))) {
    n++;
    cursor.setDate(cursor.getDate() - 7);
  }
  return n;
}

/** Sessions completed since Monday of the current week. */
export const thisWeek = (isoDates: string[], now = new Date()) => {
  const start = mondayOf(now).getTime();
  return isoDates.filter((d) => new Date(d).getTime() >= start).length;
};

export const volumeOf = (sets: { weight_kg: number; reps: number }[]) =>
  sets.reduce((t, s) => t + s.weight_kg * s.reps, 0);

/** 12480 -> '12.5k'. Volumes get big fast and the exact kilo never matters. */
export const compact = (n: number) =>
  n >= 100_000
    ? `${Math.round(n / 1000)}k`
    : n >= 1000
      ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
      : String(Math.round(n));
