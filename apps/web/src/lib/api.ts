"use client";

export const SESSION_EXPIRED = "ok:session-expired";
export const READ_ONLY = "ok:read-only";
export const VIEW_ONLY = "ok:view-only";

/** Same-origin JSON client for /api. Never throws: returns a typed result the UI can render. */
export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string; body?: unknown };

/** `keepalive`: the request finishes even when the page is being closed (a delayed deletion). */
export async function api<T>(path: string, init: { method?: string; body?: unknown; keepalive?: boolean } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: init.body !== undefined ? { "content-type": "application/json" } : {},
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      keepalive: init.keepalive,
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    // The session ended while working (expired, signed out elsewhere): the panel asks to sign in again in place.
    if (res.status === 401 && !path.startsWith("/auth/") && typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EXPIRED));
    // «Лише перегляд»: the panel explains once and sends to «Оплата».
    if (res.status === 402 && (data as { error?: string } | null)?.error === "read_only" && typeof window !== "undefined") window.dispatchEvent(new Event(READ_ONLY));
    // The admin looking at a client's panel: the panel says why nothing changed.
    if (res.status === 403 && (data as { error?: string } | null)?.error === "view_only" && typeof window !== "undefined") window.dispatchEvent(new Event(VIEW_ONLY));
    if (res.ok) return { ok: true, status: res.status, data: data as T };
    return { ok: false, status: res.status, error: (data as { error?: string } | null)?.error ?? (res.status === 502 ? "network" : "server_error"), body: data };
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
}

export type Me = {
  id: string;
  name: string;
  email: string;
  phone: string;
  isAdmin: boolean;
  totpEnabled: boolean;
  organizations: { id: string; name: string; role: "owner" | "manager" | "marketer" | "packer" }[];
  activeOrgId: string | null;
  role: "owner" | "manager" | "marketer" | "packer" | null;
  permissions: string[];
  modules: string[];
  /** False until the owner answered the questions after sign-up. */
  onboarded: boolean;
  subscription: { status: "trial" | "active" | "grace" | "suspended" | "cancelled"; periodEnd: string } | null;
  /** The admin is looking at this business's panel (read only). */
  viewing?: { orgId: string; name: string };
};

/** Non-secret hint cookie set by the API next to the HttpOnly session. Lets static pages show "Відкрити ONEKNIGHT". */
export const hasAuthHint = () => typeof document !== "undefined" && /(?:^|;\s*)ok_auth=1/.test(document.cookie);

/** Guards list loaders against out-of-order responses: only the latest request may update the state. */
export function latestOnly() {
  let seq = 0;
  return () => {
    const my = ++seq;
    return () => my === seq;
  };
}
