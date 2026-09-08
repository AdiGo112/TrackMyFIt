/**
 * Display conversion only. The DB is always kg/cm — nothing here ever touches
 * what gets stored, it only translates at the edges (render + form input).
 */

export type UnitPref = "metric" | "imperial";

const LB_PER_KG = 2.2046226218;
const CM_PER_INCH = 2.54;

const trim = (n: number) => +n.toFixed(1) + "";

export const kgToLb = (kg: number) => kg * LB_PER_KG;
export const lbToKg = (lb: number) => lb / LB_PER_KG;

export const weightUnit = (p: UnitPref) => (p === "imperial" ? "lb" : "kg");

/** Number only, for input fields. */
export const weightIn = (kg: number, p: UnitPref) =>
  p === "imperial" ? Math.round(kgToLb(kg) * 10) / 10 : kg;

/** Back to kg, for storage. */
export const weightToKg = (v: number, p: UnitPref) =>
  p === "imperial" ? lbToKg(v) : v;

/** Number + unit, for display. */
export const fmtWeight = (kg: number | null, p: UnitPref) =>
  kg === null ? "—" : `${trim(weightIn(kg, p))} ${weightUnit(p)}`;

/** cm, or feet'inches" when imperial. */
export function fmtHeight(cm: number | null, p: UnitPref) {
  if (cm === null) return "—";
  if (p === "metric") return `${trim(cm)} cm`;
  const totalIn = Math.round(cm / CM_PER_INCH);
  return `${Math.floor(totalIn / 12)}'${totalIn % 12}"`;
}

export const cmToIn = (cm: number) => cm / CM_PER_INCH;
export const inToCm = (inches: number) => inches * CM_PER_INCH;
