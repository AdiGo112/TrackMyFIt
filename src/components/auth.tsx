"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { watchAuth } from "@/lib/db";

/** Reachable without a session. Everything else bounces to /login. */
const PUBLIC = ["/login", "/reset"];

/**
 * Single gate for the whole app, so no page has to guard itself.
 *
 * It renders nothing until the session is known — `null` means "still asking",
 * not "signed out". Without that pause every page below would read a null uid on
 * first paint and bounce a signed-in user to /login before the session loaded.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const open = PUBLIC.includes(path);

  useEffect(() => watchAuth((id) => setSignedIn(id !== null)), []);

  useEffect(() => {
    if (signedIn === null) return;
    if (!signedIn && !open) router.replace("/login");
    // Signing in from the login screen has nowhere to go but home; the recovery
    // link at /reset is deliberately left alone, session or not.
    if (signedIn && path === "/login") router.replace("/");
  }, [signedIn, open, path, router]);

  if (signedIn === null) return null;
  if (!signedIn && !open) return null;
  return <>{children}</>;
}
