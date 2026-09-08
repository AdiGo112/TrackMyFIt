"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/* ═══════════════════════════════════════════════════════════════
   Icons — one component, one path table. Stroke-only so they
   inherit colour and never fight the monochrome palette.
   ═══════════════════════════════════════════════════════════════ */

const PATHS = {
  home: "M3 10.2 12 3l9 7.2M5.6 9v11.4h12.8V9",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2",
  chart: "M3 20h18M6.5 20v-5M11 20V8M15.5 20v-8M20 20V5",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20.5a7.5 7.5 0 0 1 15 0",
  users:
    "M15 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M8.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M22 20v-1.5a4 4 0 0 0-3-3.87M16 3.63a4 4 0 0 1 0 7.75",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  check: "M4.5 12.5 9.5 17.5 19.5 6.5",
  x: "M6 6l12 12M18 6 6 18",
  down: "m6 9 6 6 6-6",
  right: "m9 6 6 6-6 6",
  up: "M12 19V5m0 0-6 6m6-6 6 6",
  arrowDown: "M12 5v14m0 0 6-6m-6 6-6-6",
  arrowRight: "M4 12h15m0 0-6-6m6 6-6 6",
  play: "M7 4.8v14.4L19.5 12 7 4.8Z",
  timer: "M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 10.5V14l2.5 1.5M9.5 2h5",
  flame:
    "M12 22c3.9 0 6.5-2.6 6.5-6 0-4.5-4.4-6-3.9-11-3 2-5.6 4.5-5.6 7.5 0 1-1 1.5-1.5 1-.6-.6-.8-1.4-.8-2.3C5.2 13 5 14.4 5 16c0 3.4 3 6 7 6Z",
  trophy:
    "M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4.6A2.4 2.4 0 0 0 7 10.4M17 6h2.4A2.4 2.4 0 0 1 17 10.4M9.5 20h5M12 14.2V20",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3",
  trash: "M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6",
  refresh: "M20.5 12a8.5 8.5 0 1 1-2.5-6M20.5 3.5v5h-5",
  layers: "M12 3 3 7.5l9 4.5 9-4.5L12 3ZM3 16.5 12 21l9-4.5M3 12l9 4.5L21 12",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  className = "",
  strokeWidth = 1.75,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      // the only solid glyph: an outlined play triangle reads as a bug
      fill={name === "play" ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Toast + confirm. Replaces alert()/confirm(), which block the
   thread and look like 1998 mid-workout.
   ═══════════════════════════════════════════════════════════════ */

type Toast = { id: number; text: string; tone: "info" | "bad" };
type ConfirmOpts = {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
};

const UICtx = createContext<{
  toast: (text: string, tone?: "info" | "bad") => void;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
} | null>(null);

export const useUI = () => {
  const v = useContext(UICtx);
  if (!v) throw new Error("useUI must be used inside <UIProvider>");
  return v;
};

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ask, setAsk] = useState<ConfirmOpts | null>(null);
  const answer = useRef<((v: boolean) => void) | undefined>(undefined);
  const dialog = useRef<HTMLDialogElement>(null);

  const toast = useCallback((text: string, tone: "info" | "bad" = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3400);
  }, []);

  const confirm = useCallback(
    (o: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        answer.current = resolve;
        setAsk(o);
      }),
    []
  );

  // <dialog> gives focus trapping, Esc-to-close and an inert background for
  // free — no reason to hand-roll any of it.
  useEffect(() => {
    if (ask) dialog.current?.showModal();
  }, [ask]);

  const settle = (v: boolean) => {
    answer.current?.(v);
    answer.current = undefined;
    dialog.current?.close();
    setAsk(null);
  };

  return (
    <UICtx.Provider value={{ toast, confirm }}>
      {children}

      {/* Top, not bottom: the bottom of the session screen is the rest timer and
          the finish button, and a toast must never cover either. */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))]"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`drop pointer-events-auto w-full max-w-sm rounded-[10px] border px-4 py-3 text-sm font-medium shadow-lg shadow-black/40 ${
              t.tone === "bad"
                ? "border-p25/50 bg-[#2a1512] text-p25"
                : "border-edge bg-raised text-ink"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>

      <dialog
        ref={dialog}
        onClose={() => settle(false)}
        onCancel={() => settle(false)}
        className="confirm-dialog"
        aria-labelledby="confirm-title"
      >
        {ask && (
          <div className="sheet-up">
            {/* a sentence, so not the uppercase display face */}
            <h2 id="confirm-title" className="text-lg font-semibold">
              {ask.title}
            </h2>
            {ask.body && <p className="mt-2 text-sm text-ink2">{ask.body}</p>}
            <div className="mt-5 flex gap-2">
              <button className="btn-ghost" onClick={() => settle(false)}>
                Cancel
              </button>
              <button
                className={
                  ask.danger ? "btn-ghost !border-p25/60 !text-p25" : "btn-primary"
                }
                onClick={() => settle(true)}
                autoFocus
              >
                {ask.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </UICtx.Provider>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Layout furniture
   ═══════════════════════════════════════════════════════════════ */

const TABS = [
  { href: "/", label: "Train", icon: "home" },
  { href: "/history", label: "Log", icon: "clock" },
  { href: "/stats", label: "Progress", icon: "chart" },
  { href: "/profile", label: "You", icon: "user" },
] as const;

export function TabBar() {
  const path = usePathname();
  // Full-focus screens: mid-workout, and anything before a profile exists.
  if (path.startsWith("/session/") || ["/users", "/login", "/reset"].includes(path))
    return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/90 backdrop-blur-xl"
      aria-label="Main"
    >
      <div className="safe-b mx-auto flex max-w-lg">
        {TABS.map((t) => {
          const on = t.href === "/" ? path === "/" : path.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 pt-2.5 pb-2 transition-colors ${
                on ? "text-ink" : "text-ink3 hover:text-ink2"
              }`}
            >
              <Icon name={t.icon} size={21} strokeWidth={on ? 2.1 : 1.7} />
              <span className="font-mono text-[0.5625rem] font-medium tracking-[0.12em] uppercase">
                {t.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function PageHead({
  eyebrow,
  title,
  right,
}: {
  eyebrow: string;
  title: string;
  right?: ReactNode;
}) {
  return (
    <header className="rise mb-6 flex items-end justify-between gap-3">
      <div>
        <p className="eyebrow mb-1.5">{eyebrow}</p>
        <h1 className="display text-[1.75rem]">{title}</h1>
      </div>
      {right}
    </header>
  );
}

export const Skel = ({ className = "" }: { className?: string }) => (
  <div className={`animate-pulse rounded-[8px] bg-raised ${className}`} />
);

export function PageSkeleton() {
  return (
    <div className="space-y-3 pt-2">
      <Skel className="h-3 w-20" />
      <Skel className="h-8 w-44" />
      <Skel className="mt-6 h-32 w-full" />
      <Skel className="h-16 w-full" />
      <Skel className="h-16 w-full" />
    </div>
  );
}

export function Empty({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rise card knurl flex flex-col items-center px-6 py-12 text-center">
      <Icon name={icon} size={30} className="text-ink3" />
      <h2 className="display mt-4 text-lg">{title}</h2>
      <p className="mt-1.5 max-w-[26ch] text-sm text-ink2">{body}</p>
      {action && <div className="mt-5 w-full max-w-[15rem]">{action}</div>}
    </div>
  );
}

/** Two-to-four way switch. Used for units, chart ranges, bar weight. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex gap-1 rounded-[10px] border border-line bg-bg p-1"
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-[7px] px-2 py-2 font-mono text-[0.6875rem] font-medium tracking-[0.1em] uppercase transition-colors ${
            o.value === value ? "bg-ink text-bg" : "text-ink2 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * localStorage-backed preference. Device-local by design: bar weight and rest
 * length belong to the gym you are standing in, not to the account.
 */
const prefListeners = new Set<() => void>();

export function useLocalPref<T extends string | number>(key: string, fallback: T) {
  // localStorage is an external store, so read it with the API built for
  // external stores. That also makes the server render deterministic instead of
  // hydrating one value and then flipping to another.
  const subscribe = useCallback((cb: () => void) => {
    prefListeners.add(cb);
    window.addEventListener("storage", cb);
    return () => {
      prefListeners.delete(cb);
      window.removeEventListener("storage", cb);
    };
  }, []);

  const raw = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(key),
    () => null
  );

  const value =
    raw === null
      ? fallback
      : ((typeof fallback === "number" ? Number(raw) : raw) as T);

  const set = useCallback(
    (next: T) => {
      localStorage.setItem(key, String(next));
      prefListeners.forEach((l) => l());
    },
    [key]
  );

  return [value, set] as const;
}

/** Short buzz on a real interaction. Silently absent on desktop and iOS. */
export const buzz = (ms: number | number[] = 12) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported — the visual feedback already carried it */
  }
};
