// Self-check for the RLS policies in supabase/schema.sql. Run: npm run check:rls
//
// The policies are the ONLY thing standing between a stranger holding the public
// anon key — which ships in the client bundle, so assume everyone has it — and
// every user's training history. This asserts that key can do nothing at all.
// Run it after any change to the policies or the grants.
import assert from "node:assert";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
assert(url && key, "run with --env-file=.env.local so the anon key is loaded");

const TABLES = [
  "users",
  "exercises",
  "split_days",
  "split_day_exercises",
  "sessions",
  "exercise_logs",
  "sets",
];

const rest = (path: string, init?: RequestInit) =>
  fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key!, Authorization: `Bearer ${key!}`, ...init?.headers },
  });

let failures = 0;
const check = (label: string, ok: boolean, detail: string) => {
  if (ok) return;
  failures++;
  console.error(`  FAIL  ${label} — ${detail}`);
};

async function main() {
  for (const t of TABLES) {
    // A signed-out reader must never see a row. 200 with an empty array counts as
    // a pass: that is RLS filtering. A 200 with rows in it does not.
    const r = await rest(`${t}?select=*&limit=1`);
    const body = await r.text();
    check(
      `anon select ${t}`,
      r.status === 401 || r.status === 403 || r.status === 404 || body === "[]",
      `HTTP ${r.status} returned ${body.slice(0, 120)}`
    );

    // And must never write one. 201 here means anyone can fill your database.
    const w = await rest(t, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    check(`anon insert ${t}`, w.status !== 201, `HTTP ${w.status} accepted the insert`);
  }

  if (failures) {
    console.error(`\nRLS check: ${failures} failure(s) — the anon key can reach data.`);
    process.exit(1);
  }
  console.log(`RLS: anon is denied read and write on all ${TABLES.length} tables`);
}

void main();
