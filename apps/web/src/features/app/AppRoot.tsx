"use client";

import { useCallback, useEffect, useState } from "react";
import { useDict } from "@/i18n/provider";
import { KnightMark } from "@/components/global/Logo";
import { api, type Me } from "@/lib/api";
import { AuthScreen, MfaScreen } from "./AuthScreen";
import { AppPanel } from "./Panel";

type State = { s: "loading" } | { s: "offline" } | { s: "anon" } | { s: "mfa" } | { s: "ready"; me: Me };

export function AppRoot() {
  const t = useDict().app;
  const [st, setSt] = useState<State>({ s: "loading" });

  const check = useCallback(async () => {
    setSt({ s: "loading" });
    const r = await api<Me>("/auth/me");
    if (r.ok) return setSt({ s: "ready", me: r.data });
    if (r.error === "mfa_required") return setSt({ s: "mfa" });
    if (r.status === 401) return setSt({ s: "anon" });
    setSt({ s: "offline" });
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  /** Re-reads the account in place (e.g. after turning 2FA on) without leaving the current screen. */
  const refresh = useCallback(async () => {
    const r = await api<Me>("/auth/me");
    if (r.ok) setSt({ s: "ready", me: r.data });
    else if (r.status === 401) setSt(r.error === "mfa_required" ? { s: "mfa" } : { s: "anon" });
  }, []);

  const logout = async () => {
    await api("/auth/logout", { method: "POST", body: {} });
    // The next person to sign in starts on the home screen.
    history.replaceState(null, "", location.pathname);
    setSt({ s: "anon" });
  };

  if (st.s === "loading")
    return (
      <main className="app-center" aria-busy="true">
        <span className="app-pulse"><KnightMark size={48} /></span>
        <span className="sr-only">{t.loading}</span>
      </main>
    );
  if (st.s === "offline")
    return (
      <main className="app-center">
        <div className="card app-auth-card">
          <h1 className="h3">{t.offline.title}</h1>
          <p className="small">{t.offline.text}</p>
          <button type="button" className="btn" onClick={check}>{t.offline.retry}</button>
        </div>
      </main>
    );
  if (st.s === "mfa") return <MfaScreen onDone={(me) => setSt({ s: "ready", me })} onCancel={logout} />;
  if (st.s === "anon") {
    const initial = typeof window !== "undefined" && new URLSearchParams(location.search).get("start") === "register" ? "register" : "login";
    return <AuthScreen initial={initial} onDone={(me) => setSt({ s: "ready", me })} onMfa={() => setSt({ s: "mfa" })} />;
  }
  return <AppPanel me={st.me} onLogout={logout} onChange={refresh} />;
}
