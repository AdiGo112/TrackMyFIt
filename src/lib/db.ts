import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key || url.includes("placeholder")) {
  throw new Error(
    "Supabase is not configured. Copy .env.local.example to .env.local and fill in " +
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY from your project's " +
      "Settings -> API page, then restart the dev server."
  );
}

export const supabase = createClient(url, key);

/**
 * The current user is the Supabase Auth account, and its uid doubles as users.id
 * (see supabase/schema.sql), so every query still filters on exactly this value.
 *
 * The read stays synchronous because dozens of call sites want it inline. That is
 * safe only because <AuthGate> holds the app's first render until this cache is
 * filled: onAuthStateChange emits INITIAL_SESSION the moment it subscribes, so
 * "no session yet" and "signed out" are never confused for one another.
 */
let cachedUserId: string | null = null;

export const getCurrentUserId = () => cachedUserId;

/** Keeps the cache in step with sign-in, sign-out and token refresh. Returns an
 *  unsubscribe, so it drops straight into a useEffect. */
export function watchAuth(onChange: (id: string | null) => void) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cachedUserId = session?.user.id ?? null;
    onChange(cachedUserId);
  });
  return () => data.subscription.unsubscribe();
}

// --- row types (hand-written; not worth generating for 7 tables) ---

export type User = {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  activity_level: string | null;
  unit_preference: "metric" | "imperial";
};

export type Exercise = {
  id: string;
  name: string;
  archetype: string;
  muscle_group: string;
  equipment: string;
  default_reps: string | null;
  is_compound: boolean;
};
