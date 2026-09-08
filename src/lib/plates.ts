/**
 * Barbell plate loading. Pure math, no DB, no DOM.
 *
 * Dimensions are the real IWF/IPF calibrated-plate specs, in mm — the taper you
 * see in the loaded-bar graphic is the actual taper of a real bar, not a styling
 * choice. Colours are the international competition code, which is the only
 * place saturated colour enters this app.
 *
 * Self-check: `npm run check`.
 */

export type PlateSpec = { kg: number; color: string; dia: number; thick: number };

/** Metric competition set. Bar 20 kg. */
export const KG_PLATES: PlateSpec[] = [
  { kg: 25, color: "var(--color-p25)", dia: 450, thick: 67 },
  { kg: 20, color: "var(--color-p20)", dia: 450, thick: 54 },
  { kg: 15, color: "var(--color-p15)", dia: 400, thick: 43 },
  { kg: 10, color: "var(--color-p10)", dia: 325, thick: 33 },
  { kg: 5, color: "var(--color-p5)", dia: 228, thick: 26 },
  { kg: 2.5, color: "var(--color-p2)", dia: 190, thick: 22 },
  { kg: 1.25, color: "var(--color-p1)", dia: 160, thick: 18 },
];

/** Pound gym set. Bar 45 lb. No 55 lb plate: it is competition-only, and having
 *  it in the set makes the greedy fill suggest 55+35 for 225 lb, which nobody loads. */
export const LB_PLATES: PlateSpec[] = [
  { kg: 45, color: "var(--color-p20)", dia: 450, thick: 54 },
  { kg: 35, color: "var(--color-p15)", dia: 400, thick: 43 },
  { kg: 25, color: "var(--color-p10)", dia: 325, thick: 33 },
  { kg: 10, color: "var(--color-p5)", dia: 228, thick: 26 },
  { kg: 5, color: "var(--color-p2)", dia: 190, thick: 22 },
  { kg: 2.5, color: "var(--color-p1)", dia: 160, thick: 18 },
];

export const DEFAULT_BAR = { metric: 20, imperial: 45 };

export type Loadout = {
  /** One entry per physical plate on ONE side, heaviest first. */
  plates: PlateSpec[];
  perSide: number;
  /** What the plate set can't make up. >0 means the graphic is approximate. */
  remainder: number;
};

/**
 * Greedy fill of one sleeve. Greedy is exact for both sets above because every
 * denomination is a multiple of the next one down or reachable by combining
 * them — a remainder only appears for weights the gym physically can't load.
 */
export function loadout(
  total: number,
  bar: number,
  set: PlateSpec[] = KG_PLATES
): Loadout | null {
  if (!Number.isFinite(total) || total < bar) return null;
  const perSide = (total - bar) / 2;
  const plates: PlateSpec[] = [];
  let left = perSide;
  for (const p of set) {
    while (left >= p.kg - 1e-9) {
      plates.push(p);
      left = Math.round((left - p.kg) * 1e4) / 1e4;
    }
  }
  return { plates, perSide, remainder: Math.round(left * 100) / 100 };
}

/** '2×25 · 1×10 · 1×2.5', or 'Empty bar'. */
export function loadoutLabel(l: Loadout): string {
  if (!l.plates.length) return "Empty bar";
  const counts = new Map<number, number>();
  for (const p of l.plates) counts.set(p.kg, (counts.get(p.kg) ?? 0) + 1);
  return [...counts].map(([kg, n]) => `${n}\u00d7${kg}`).join(" \u00b7 ");
}
