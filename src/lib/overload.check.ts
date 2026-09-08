// Self-check for the overload math. Run: npx tsx src/lib/overload.check.ts
// Kept out of overload.ts so no node: builtin ever reaches the client bundle.
import assert from "node:assert";
import { parseRepRange, suggestNext, e1rm, bestSet, type ExerciseMeta } from "./overload";
import { loadout, loadoutLabel, KG_PLATES, LB_PLATES } from "./plates";
import { weekStreak, thisWeek, mondayOf, dayKey, compact, volumeOf } from "./stats";

const bench: ExerciseMeta = {
  name: "Barbell Bench Press",
  archetype: "push",
  is_compound: true,
  default_reps: "8-12",
};
const squat: ExerciseMeta = {
  ...bench,
  name: "Back Squat",
  archetype: "legs",
  default_reps: "5-8",
};
const dead: ExerciseMeta = { ...bench, name: "Deadlift", archetype: "pull" };
const plank: ExerciseMeta = {
  name: "Plank",
  archetype: "core",
  is_compound: false,
  default_reps: "--",
};
const pullup: ExerciseMeta = { ...bench, name: "Pull-up", default_reps: "6-10" };

const s = (weight_kg: number, reps: number) => ({ weight_kg, reps });

assert.deepStrictEqual(parseRepRange("8-12"), { min: 8, max: 12 });
assert.strictEqual(parseRepRange("--"), null);
assert.strictEqual(parseRepRange(null), null);
assert.strictEqual(parseRepRange(""), null);

// topped out the range on every set -> +2.5 upper
assert.deepStrictEqual(suggestNext([s(60, 12), s(60, 12), s(60, 12)], bench), {
  weightKg: 62.5,
  isDeload: false,
});

// legs compound -> +5
assert.deepStrictEqual(suggestNext([s(100, 8), s(100, 8)], squat), {
  weightKg: 105,
  isDeload: false,
});

// deadlift is archetype 'pull' but still gets the lower-body jump
assert.deepStrictEqual(
  suggestNext([s(140, 6), s(140, 6)], { ...dead, default_reps: "3-6" }),
  { weightKg: 145, isDeload: false }
);

// within range, not topped out -> hold and build reps
assert.deepStrictEqual(suggestNext([s(60, 12), s(60, 10), s(60, 9)], bench), {
  weightKg: 60,
  isDeload: false,
});

// one set below the bottom, no prior miss -> hold, no deload
assert.deepStrictEqual(suggestNext([s(60, 12), s(60, 6)], bench), {
  weightKg: 60,
  isDeload: false,
});

// second consecutive miss at the same weight -> deload to 60*0.9=54 -> 55
assert.deepStrictEqual(
  suggestNext([s(60, 7), s(60, 6)], bench, [s(60, 7), s(60, 5)]),
  { weightKg: 55, isDeload: true }
);

// prior session missed at a DIFFERENT weight -> streak doesn't carry
assert.deepStrictEqual(
  suggestNext([s(60, 6)], bench, [s(55, 6)]),
  { weightKg: 60, isDeload: false }
);

// prior session hit the range -> streak reset
assert.deepStrictEqual(
  suggestNext([s(60, 6)], bench, [s(60, 10)]),
  { weightKg: 60, isDeload: false }
);

// no rep range (time-based) -> no suggestion
assert.deepStrictEqual(suggestNext([s(0, 60)], plank), {
  weightKg: null,
  isDeload: false,
});

// unweighted bodyweight -> no suggestion rather than a wrong one
assert.deepStrictEqual(suggestNext([s(0, 10), s(0, 10)], pullup), {
  weightKg: null,
  isDeload: false,
});

// weighted pull-up still progresses
assert.deepStrictEqual(suggestNext([s(10, 10), s(10, 10)], pullup), {
  weightKg: 12.5,
  isDeload: false,
});

// no sets logged -> no suggestion, no crash
assert.deepStrictEqual(suggestNext([], bench), {
  weightKg: null,
  isDeload: false,
});

// only the top-weight sets count; a lighter warm-up set doesn't block progression
assert.deepStrictEqual(suggestNext([s(40, 5), s(60, 12), s(60, 12)], bench), {
  weightKg: 62.5,
  isDeload: false,
});

// --- e1RM / PR ranking -----------------------------------------------------

// unweighted or zero-rep sets never rank, so bodyweight work can't fake a PR
assert.strictEqual(e1rm(0, 10), 0);
assert.strictEqual(e1rm(60, 0), 0);
// Epley: 100kg x 5 -> 100 * (1 + 5/30)
assert.strictEqual(Math.round(e1rm(100, 5) * 100) / 100, 116.67);
// a lighter set for more reps can outrank a heavier single
assert.strictEqual(bestSet([s(100, 1), s(90, 8)])?.weight_kg, 90);
assert.strictEqual(bestSet([]), null);
assert.strictEqual(bestSet([s(0, 12)]), null);

// --- plate loading ---------------------------------------------------------

// below the bar can't be loaded at all
assert.strictEqual(loadout(15, 20), null);
// the bar itself loads nothing
assert.deepStrictEqual(loadout(20, 20)!.plates, []);
assert.strictEqual(loadoutLabel(loadout(20, 20)!), "Empty bar");
// 100kg on a 20kg bar = 40/side = 25 + 15
assert.deepStrictEqual(loadout(100, 20)!.plates.map((p) => p.kg), [25, 15]);
assert.strictEqual(loadoutLabel(loadout(100, 20)!), "1×25 · 1×15");
// repeats collapse in the label but stay separate plates in the graphic
assert.deepStrictEqual(loadout(120, 20)!.plates.map((p) => p.kg), [25, 25]);
assert.strictEqual(loadoutLabel(loadout(120, 20)!), "2×25");
// every 2.5kg step is loadable exactly -> no remainder anywhere in normal range
for (let kg = 20; kg <= 300; kg += 2.5) {
  assert.strictEqual(loadout(kg, 20)!.remainder, 0, `${kg}kg left a remainder`);
}
// a weight the plate set physically can't make reports the shortfall
assert.strictEqual(loadout(21, 20)!.remainder, 0.5);
// imperial set on a 45lb bar: 225lb = 90/side = 45+45
assert.deepStrictEqual(
  loadout(225, 45, LB_PLATES)!.plates.map((p) => p.kg),
  [45, 45]
);
// plate specs are ordered heaviest-first, which the greedy fill depends on
for (const set of [KG_PLATES, LB_PLATES]) {
  for (let i = 1; i < set.length; i++) assert.ok(set[i - 1].kg > set[i].kg);
}

// --- week bucketing --------------------------------------------------------

// Wed 2026-09-02 -> Monday 2026-08-31
assert.strictEqual(dayKey(mondayOf(new Date(2026, 8, 2))), "2026-08-31");
// a Monday is its own week start
assert.strictEqual(dayKey(mondayOf(new Date(2026, 7, 31))), "2026-08-31");
// Sunday belongs to the week that just ended, not the one starting
assert.strictEqual(dayKey(mondayOf(new Date(2026, 8, 6))), "2026-08-31");

const NOW = new Date(2026, 8, 2, 9, 0); // Wed 2 Sep 2026
const on = (y: number, m: number, d: number) => new Date(y, m, d, 18).toISOString();

assert.strictEqual(weekStreak([], NOW), 0);
// trained this week only
assert.strictEqual(weekStreak([on(2026, 8, 1)], NOW), 1);
// three consecutive weeks including this one
assert.strictEqual(
  weekStreak([on(2026, 8, 1), on(2026, 7, 26), on(2026, 7, 19)], NOW),
  3
);
// an empty current week does not break a run that is still alive
assert.strictEqual(weekStreak([on(2026, 7, 26), on(2026, 7, 19)], NOW), 2);
// a skipped week ends the streak
assert.strictEqual(weekStreak([on(2026, 7, 26), on(2026, 7, 12)], NOW), 1);
// several sessions in one week still count as one week
assert.strictEqual(weekStreak([on(2026, 8, 1), on(2026, 8, 2)], NOW), 1);

assert.strictEqual(thisWeek([on(2026, 8, 1), on(2026, 7, 26)], NOW), 1);
assert.strictEqual(thisWeek([], NOW), 0);

// --- display aggregates ----------------------------------------------------

assert.strictEqual(volumeOf([s(60, 10), s(60, 8)]), 1080);
assert.strictEqual(volumeOf([]), 0);
assert.strictEqual(compact(940), "940");
assert.strictEqual(compact(1000), "1k");
assert.strictEqual(compact(12480), "12.5k");
assert.strictEqual(compact(250000), "250k");

console.log("overload.ts + plates.ts + stats.ts: all assertions passed");
