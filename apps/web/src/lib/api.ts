"use client";

/** Same-origin JSON client for /api. Never throws: returns a typed result the UI can render. */
export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string; body?: unknown };

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: init.body !== undefined ? { "content-type": "application/json" } : {},
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
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
  organizations: { id: string; name: string; role: "owner" | "manager" | "marketer" }[];
  activeOrgId: string | null;
  role: "owner" | "manager" | "marketer" | null;
  permissions: string[];
  modules: string[];
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
