"use client";

import { useSyncExternalStore } from "react";

/**
 * Demo session. Implements the shape of a real session so the header, modal and ONEKNIGHT shell
 * do not change when real auth arrives: only this module is replaced by an API-backed one.
 * The password is never stored.
 */
export type Session = { name: string; phone: string; email: string; demo: true };

const KEY = "ok.demo-session";
const listeners = new Set<() => void>();
let cache: Session | null = null;
let loaded = false;

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function snapshot(): Session | null {
  if (!loaded && typeof window !== "undefined") {
    cache = load();
    loaded = true;
  }
  return cache;
}

function emit() {
  listeners.forEach((l) => l());
}

export function signIn(s: Omit<Session, "demo">) {
  cache = { ...s, demo: true };
  loaded = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* session then lasts for this page view only */
  }
  emit();
}

export function signOut() {
  cache = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  emit();
}

export function findDemoAccount(email: string): Session | null {
  const s = snapshot();
  return s && s.email.toLowerCase() === email.trim().toLowerCase() ? s : null;
}

export function useSession(): Session | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    snapshot,
    () => null,
  );
}
