"use client";

import { useCallback, useEffect, useState } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { KnightMark } from "@/components/global/Logo";
import { SESSION_EXPIRED, api, type Me } from "@/lib/api";
import { AuthScreen, MfaScreen, ResetScreen } from "./AuthScreen";
import { AppPanel } from "./Panel";
import { Onboarding } from "./Onboarding";

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
  // Session over mid-work: sign in again; the address (screen and tab) stays, so the person returns to the same place.
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const on = () =>
      setSt((cur) => {
        if (cur.s !== "ready") return cur;
        setExpired(true);
        return { s: "anon" };
      });
    window.addEventListener(SESSION_EXPIRED, on);
    return () => window.removeEventListener(SESSION_EXPIRED, on);
  }, []);

  /** Re-reads the account in place (e.g. after turning 2FA on) without leaving the current screen. */
  // Team invitation: kept until the visitor is signed in, then accepted once.
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  // Password reset link: the token leaves the address bar at once (history, screenshots).
  const [reset, setReset] = useState<string | null>(null);
  const [authNote, setAuthNote] = useState<string | null>(null);
  useEffect(() => {
    const r = new URLSearchParams(location.search).get("reset");
    if (r) {
      setReset(r);
      history.replaceState(null, "", location.pathname);
    }
  }, []);
  useEffect(() => {
    const ref = new URLSearchParams(location.search).get("ref");
    if (ref) sessionStorage.setItem("ok_ref", ref);
  }, []);
  useEffect(() => {
    const token = new URLSearchParams(location.search).get("invite");
    if (token) {
      sessionStorage.setItem("ok_invite", token);
      history.replaceState(null, "", location.pathname + location.hash);
    }
  }, []);
  useEffect(() => {
    if (st.s !== "ready") return;
    const token = sessionStorage.getItem("ok_invite");
    if (!token) return;
    sessionStorage.removeItem("ok_invite");
    void api<{ orgId: string; name: string }>("/team/accept", { method: "POST", body: { token } }).then(async (r) => {
      setInviteMsg(r.ok ? fmt(t.team.joined, { name: r.data.name }) : t.team.inviteInvalid);
      if (r.ok) {
        const m = await api<Me>("/auth/me");
        if (m.ok) setSt({ s: "ready", me: m.data });
      }
    });
  }, [st.s, t.team.joined, t.team.inviteInvalid]);

  const refresh = useCallback(async () => {
    const r = await api<Me>("/auth/me");
    if (r.ok) setSt({ s: "ready", me: r.data });
    else if (r.status === 401) setSt(r.error === "mfa_required" ? { s: "mfa" } : { s: "anon" });
  }, []);

  const logout = async () => {
    await api("/auth/logout", { method: "POST", body: {} });
    setExpired(false);
    // The next person to sign in starts on the home screen.
    history.replaceState(null, "", location.pathname);
    setSt({ s: "anon" });
  };

  if (reset)
    return (
      <ResetScreen
        token={reset}
        onDone={(ok) => {
          setReset(null);
          if (ok) setAuthNote(t.auth.resetDone);
          setSt({ s: "anon" });
        }}
      />
    );
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
    const invited = typeof window !== "undefined" && !!sessionStorage.getItem("ok_invite");
    return <AuthScreen initial={expired ? "login" : initial} note={expired ? t.auth.expired : authNote ?? (invited ? t.team.inviteLogin : undefined)} onDone={(me) => { setExpired(false); setSt({ s: "ready", me }); }} onMfa={() => setSt({ s: "mfa" })} />;
  }
  if (!st.me.onboarded)
    return (
      <Onboarding
        me={st.me}
        onDone={(to) => {
          if (to) history.replaceState(null, "", `${location.pathname}#${to.join("/")}`);
          void refresh();
        }}
      />
    );
  return (
    <>
      <AppPanel me={st.me} onLogout={logout} onChange={refresh} />
      {inviteMsg && <p className="ok-toast app-invite-toast" role="status" onAnimationEnd={() => setTimeout(() => setInviteMsg(null), 3000)}>{inviteMsg}</p>}
    </>
  );
}
