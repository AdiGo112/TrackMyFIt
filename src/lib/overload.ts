/**
 * Progressive overload + deload math. Pure functions, no DB access.
 *
 * These numbers (+2.5 / +5, 2-miss streak, x0.9) are reasonable v1 defaults, NOT
 * sourced from a published standard. They live here as constants so tuning them
 * later is a one-file edit. Self-check: `npm run check`.
 */

export const UPPER_INCREMENT_KG = 2.5;
export const LOWER_INCREMENT_KG = 5;
export const DELOAD_FACTOR = 0.9;
export const PLATE_STEP_KG = 2.5;

export type RepRange = { min: number; max: number };
export type LoggedSet = { weight_kg: number; reps: number };

export type ExerciseMeta = {
  name: string;
  archetype: string;
  is_compound: boolean;
  default_reps: string | null;
};

export type Suggestion = {
  weightKg: number | null;
  isDeload: boolean;
};

/** '8-12' -> {min:8,max:12}. '--', '', null, or anything unparseable -> null. */
export function parseRepRange(raw: string | null | undefined): RepRange | null {
  const m = raw?.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
  if (!m) return null;
  const [min, max] = [Number(m[1]), Number(m[2])];
  return min > 0 && max >= min ? { min, max } : null;
}

/** Round to the nearest loadable increment (2.5kg). */
export const roundToPlate = (kg: number) =>
  Math.round(kg / PLATE_STEP_KG) * PLATE_STEP_KG;

/**
 * ponytail: name match for deadlifts. They're seeded muscle_group 'back' /
 * archetype 'pull', so nothing structural marks them as lower-body — and the rule
 * calls for the +5kg jump on "squat/deadlift variants". Add an `is_lower_body`
 * column to `exercises` if this list ever grows past deadlifts.
 */
const increment = (ex: ExerciseMeta) =>
  ex.is_compound && (ex.archetype === "legs" || /deadlift/i.test(ex.name))
    ? LOWER_INCREMENT_KG
    : UPPER_INCREMENT_KG;

/** The heaviest weight touched in a session, and the sets performed at it. */
export function topWeight(sets: LoggedSet[]): number | null {
  if (!sets.length) return null;
  return Math.max(...sets.map((s) => s.weight_kg));
}

const workingSets = (sets: LoggedSet[], weight: number) =>
  sets.filter((s) => s.weight_kg === weight);

/**
 * Did this session miss the bottom of the rep range on any working set?
 * Used both for this session's verdict and to check the previous session's,
 * which is how the deload streak is derived rather than stored.
 */
export function missedBottom(
  sets: LoggedSet[],
  range: RepRange | null
): boolean {
  if (!range || !sets.length) return false;
  const top = topWeight(sets)!;
  return workingSets(sets, top).some((s) => s.reps < range.min);
}

/**
 * Double progression.
 *
 *  - every working set at the top of the range -> add weight
 *  - all within range but not topped out      -> hold weight, build reps
 *  - any working set below the bottom         -> hold, and deload if the
 *                                                previous session also missed
 *                                                at this same weight
 *
 * Returns {weightKg: null} when there's nothing meaningful to suggest: no sets,
 * no rep range (time-based work like Plank), or unweighted bodyweight work where
 * "+2.5kg" would be nonsense.
 */
export function suggestNext(
  sets: LoggedSet[],
  ex: ExerciseMeta,
  prevSets: LoggedSet[] = []
): Suggestion {
  const range = parseRepRange(ex.default_reps);
  const top = topWeight(sets);

  if (!range || top === null || top <= 0) {
    return { weightKg: null, isDeload: false };
  }

  const working = workingSets(sets, top);

  if (working.every((s) => s.reps >= range.max)) {
    return { weightKg: top + increment(ex), isDeload: false };
  }

  if (working.some((s) => s.reps < range.min)) {
    // Two consecutive misses at the same weight -> back off 10%.
    const prevTop = topWeight(prevSets);
    const streak = prevTop === top && missedBottom(prevSets, range);
    return streak
      ? { weightKg: roundToPlate(top * DELOAD_FACTOR), isDeload: true }
      : { weightKg: top, isDeload: false };
  }

  return { weightKg: top, isDeload: false };
}

/**
 * Epley estimated 1-rep max. Used only to rank sets against each other for PR
 * detection — it is a comparison key, not a number anyone should train off.
 */
export const e1rm = (weightKg: number, reps: number) =>
  weightKg <= 0 || reps <= 0 ? 0 : weightKg * (1 + reps / 30);

/** The best single set in a list, by estimated 1RM. Null when nothing counts. */
export function bestSet(sets: LoggedSet[]): (LoggedSet & { e1rm: number }) | null {
  let best: (LoggedSet & { e1rm: number }) | null = null;
  for (const s of sets) {
    const score = e1rm(s.weight_kg, s.reps);
    if (score > 0 && (!best || score > best.e1rm)) best = { ...s, e1rm: score };
  }
  return best;
}
