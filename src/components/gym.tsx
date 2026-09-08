"use client";

import { useEffect, useRef, useState } from "react";
import { KG_PLATES, LB_PLATES, loadout, loadoutLabel } from "@/lib/plates";
import { weightIn, weightUnit, type UnitPref } from "@/lib/units";
import { Icon, buzz, useLocalPref } from "./ui";

/**
 * Bar weight, kept per unit system rather than converted: a gym that racks 45 lb
 * bars does not also own a 20.4 kg one. Device-local, because the bar belongs to
 * the room you are standing in, not to the account.
 */
export function useBarWeight(pref: UnitPref) {
  const kg = useLocalPref<number>("bar_kg", 20);
  const lb = useLocalPref<number>("bar_lb", 45);
  return pref === "imperial" ? lb : kg;
}

/* ═══════════════════════════════════════════════════════════════
   The plate strip — the signature element.

   A weight is an abstraction; a loaded bar is a thing you can walk
   up to. This draws the bar you actually have to load, to the real
   IWF proportions: 25kg plates are wide and full-diameter, change
   plates taper down. That taper is data, not decoration.
   ═══════════════════════════════════════════════════════════════ */

const MAX_DIA = 450;
const MAX_THICK = 67;

export function PlateStrip({
  totalKg,
  pref,
  bar,
}: {
  totalKg: number;
  pref: UnitPref;
  /** Bar weight in DISPLAY units, because that is what the lifter reads. */
  bar: number;
}) {
  const set = pref === "imperial" ? LB_PLATES : KG_PLATES;
  const load = loadout(weightIn(totalKg, pref), bar, set);
  if (!load) return null;

  const h = 50;

  return (
    <div>
      <div
        className="relative flex items-center overflow-x-auto rounded-[8px] border border-line bg-bg px-2.5"
        style={{ height: h + 14 }}
        role="img"
        aria-label={`Per side: ${loadoutLabel(load)}`}
      >
        {/* the shaft, knurled */}
        <div className="knurl absolute inset-x-0 top-1/2 h-[6px] -translate-y-1/2 bg-edge" />

        <div className="relative flex shrink-0 items-center gap-[2px]">
          {load.plates.map((p, i) => (
            <div
              key={i}
              className="shrink-0 rounded-[2px] ring-1 ring-black/50"
              style={{
                height: Math.max(12, (h * p.dia) / MAX_DIA),
                width: Math.max(3.5, (15 * p.thick) / MAX_THICK),
                background: p.color,
              }}
            />
          ))}
          {/* the collar goes on last, outside the plates */}
          <div
            className="ml-[3px] shrink-0 rounded-[2px] bg-ink3"
            style={{ height: h * 0.3, width: 5 }}
          />
        </div>
      </div>

      <p className="eyebrow mt-1.5 flex flex-wrap items-center gap-x-2">
        <span className="text-ink2">
          {load.plates.length ? loadoutLabel(load) : "Empty bar"}
        </span>
        <span>
          per side · {bar} {weightUnit(pref)} bar
        </span>
        {load.remainder > 0 && (
          <span className="text-p15">
            {load.remainder} {weightUnit(pref)} short
          </span>
        )}
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Stepper — the point is never having to open the keyboard.
   ═══════════════════════════════════════════════════════════════ */

export function Stepper({
  value,
  onChange,
  step,
  placeholder,
  ariaLabel,
  decimal = false,
}: {
  value: string;
  onChange: (v: string) => void;
  step: number;
  placeholder?: string;
  ariaLabel: string;
  decimal?: boolean;
}) {
  // Nudging an empty field starts from the placeholder — which is last
  // session's number — so "same as last time, plus 2.5" is two taps.
  const nudge = (dir: 1 | -1) => {
    const base = Number(value !== "" ? value : (placeholder ?? 0)) || 0;
    onChange(String(Math.max(0, Math.round((base + dir * step) * 100) / 100)));
    buzz(8);
  };

  return (
    <div className="grid h-[52px] grid-cols-[42px_1fr_42px] items-center rounded-[10px] border border-line bg-bg">
      <button
        type="button"
        onClick={() => nudge(-1)}
        aria-label={`${ariaLabel} down`}
        className="flex h-full items-center justify-center text-ink3 transition-colors hover:text-ink"
      >
        <Icon name="minus" size={16} strokeWidth={2.2} />
      </button>

      <input
        type="number"
        inputMode={decimal ? "decimal" : "numeric"}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className="h-full w-full border-x border-line bg-transparent text-center font-mono text-[1.0625rem] font-medium tabular-nums outline-none placeholder:text-ink3/70 focus:bg-raised"
      />

      <button
        type="button"
        onClick={() => nudge(1)}
        aria-label={`${ariaLabel} up`}
        className="flex h-full items-center justify-center text-ink3 transition-colors hover:text-ink"
      >
        <Icon name="plus" size={16} strokeWidth={2.2} />
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Rest timer
   ═══════════════════════════════════════════════════════════════ */

export const clock = (sec: number) =>
  `${Math.floor(Math.abs(sec) / 60)}:${String(Math.floor(Math.abs(sec) % 60)).padStart(2, "0")}`;

/**
 * Counts down to a wall-clock deadline rather than ticking a number, so locking
 * the phone between sets — which is what actually happens — does not drift it.
 *
 * The deadline is owned here rather than passed in: reading the clock is not
 * something a parent can do while rendering, and a rest timer that restarts is
 * just this component seeing a new `token`.
 */
export function RestTimer({
  seconds,
  onDismiss,
}: {
  seconds: number;
  onDismiss: () => void;
}) {
  const [total, setTotal] = useState(seconds);
  const [left, setLeft] = useState(seconds);
  // The deadline is not render data — only `left` is — so it lives in a ref and
  // is only ever touched from an effect or a handler.
  const endsAt = useRef(0);
  const buzzer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    endsAt.current = Date.now() + seconds * 1000;
    const t = setInterval(() => setLeft((endsAt.current - Date.now()) / 1000), 250);
    // Buzz once on the crossing, then keep counting up as an overrun clock:
    // knowing you have been sitting there for 4:12 is the useful part.
    buzzer.current = setTimeout(() => buzz([140, 70, 140]), seconds * 1000);
    return () => {
      clearInterval(t);
      if (buzzer.current) clearTimeout(buzzer.current);
    };
  }, [seconds]);

  const onAdjust = (d: number) => {
    endsAt.current += d * 1000;
    setTotal((t) => Math.max(15, t + d));
    setLeft((l) => l + d);

    // the alert has to move with the deadline, or +15 buzzes at the old one
    if (buzzer.current) clearTimeout(buzzer.current);
    const ms = endsAt.current - Date.now();
    buzzer.current = ms > 0 ? setTimeout(() => buzz([140, 70, 140]), ms) : null;
  };

  const done = left <= 0;
  const pct = done ? 100 : Math.min(100, ((total - left) / total) * 100);

  return (
    <div className="relative overflow-hidden rounded-[10px] border border-line bg-raised">
      <div
        className={`absolute inset-y-0 left-0 transition-[width] duration-300 ease-linear ${
          done ? "bg-p10/20" : "bg-ink/[0.07]"
        }`}
        style={{ width: `${pct}%` }}
      />
      <div className="relative flex items-center gap-2 px-3 py-2.5">
        <Icon
          name="timer"
          size={17}
          className={done ? "text-p10" : "text-ink3"}
        />
        <span
          className={`font-mono text-[1.0625rem] font-semibold tabular-nums ${
            done ? "text-p10" : "text-ink"
          }`}
          role="timer"
          aria-live="off"
        >
          {done ? `+${clock(left)}` : clock(left)}
        </span>
        <span className="eyebrow flex-1">{done ? "Go" : "Rest"}</span>

        <button className="btn-sm !min-h-[38px] !px-2.5" onClick={() => onAdjust(-15)}>
          −15
        </button>
        <button className="btn-sm !min-h-[38px] !px-2.5" onClick={() => onAdjust(15)}>
          +15
        </button>
        <button
          className="btn-sm !min-h-[38px] !min-w-[38px] !px-0"
          onClick={onDismiss}
          aria-label="Dismiss rest timer"
        >
          <Icon name="x" size={15} />
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Keep the screen awake while logging. Without this the phone
   sleeps between sets and every set costs an unlock.
   ═══════════════════════════════════════════════════════════════ */

export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let dropped = false;

    const grab = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        /* denied, low battery, or backgrounded — the app works regardless */
      }
    };
    // The OS drops the lock whenever the tab hides; re-take it on return.
    const onVisible = () => {
      if (document.visibilityState === "visible" && !dropped) void grab();
    };

    void grab();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      dropped = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
