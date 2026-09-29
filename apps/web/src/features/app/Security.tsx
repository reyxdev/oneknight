"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDict } from "@/i18n/provider";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { api, type Me } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { Panel, useFlash, useFormat } from "@/features/oneknight/ui/kit";

type Session = { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean };
type Login = { success: boolean; reason: string; ip: string | null; userAgent: string | null; createdAt: string };

/** "Chrome · Linux" from a user agent, without a library. */
function device(ua: string | null, fallback: string) {
  if (!ua) return fallback;
  const b = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  const o = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return [b, o].filter(Boolean).join(" · ") || fallback;
}

export function Security({ me, onChange, embedded = false }: { me: Me; onChange: () => void; embedded?: boolean }) {
  const d = useDict();
  const t = d.app.security;
  const e2 = d.app.auth.errors as Record<string, string>;
  const f = useFormat();
  const [flash, show] = useFlash();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [history, setHistory] = useState<Login[] | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, h] = await Promise.all([api<Session[]>("/auth/sessions"), api<Login[]>("/auth/login-history")]);
    if (s.ok) setSessions(s.data);
    if (h.ok) setHistory(h.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const fail = (error: string) => {
    playSound("error");
    setErr(e2[error] ?? e2.server_error ?? error);
  };

  const start = async () => {
    setErr(null);
    setBusy(true);
    const r = await api<{ secret: string; qrSvg: string }>("/auth/2fa/setup", { method: "POST", body: {} });
    setBusy(false);
    if (!r.ok) return fail(r.error);
    setSetup(r.data);
  };
  const enable = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setErr(e2.code ?? "");
    setBusy(true);
    const r = await api("/auth/2fa/enable", { method: "POST", body: { code } });
    setBusy(false);
    if (!r.ok) return fail(r.error);
    playSound("success");
    setSetup(null);
    setCode("");
    show(t.enabled);
    onChange();
  };
  const disable = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code) || !pw) return setErr(e2.invalid_input ?? "");
    setBusy(true);
    const r = await api("/auth/2fa/disable", { method: "POST", body: { code, password: pw } });
    setBusy(false);
    setPw("");
    setCode("");
    if (!r.ok) return fail(r.error);
    setDisabling(false);
    show(t.disabled);
    onChange();
  };
  const end = async (id: string) => {
    const r = await api(`/auth/sessions/${id}`, { method: "DELETE" });
    if (r.ok) {
      show(t.ended);
      void load();
    }
  };

  return (
    <div className="ok-screen">
      {!embedded && <div className="ok-h"><h3>{t.title}</h3></div>}
      <Panel title={t.twoFa} action={<span className="ok-pill" data-s={me.totpEnabled ? "done" : "cancelled"}>{me.totpEnabled ? t.on : t.off}</span>}>
        <p className="ok-muted">{t.twoFaText}</p>
        {!me.totpEnabled && !setup && (
          <button type="button" className="btn btn-sm" style={{ justifySelf: "start" }} onClick={start} disabled={busy} data-loading={busy}>
            <Icon name="shield" size={16} />{t.enable}
          </button>
        )}
        {setup && (
          <form className="app-2fa" onSubmit={enable} noValidate>
            <div className="app-2fa-steps">
              <p>{t.step1}</p>
              <p>{t.step2}</p>
              <div className="app-qr" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
              <p className="ok-muted">{t.key}: <code className="app-key">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code></p>
              <p>{t.step3}</p>
            </div>
            <Field label={d.app.auth.mfaCode} error={err ?? undefined}>
              {(p) => <input {...p} className="input app-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />}
            </Field>
            <div className="ok-actions">
              <button className="btn btn-sm" type="submit" disabled={busy} data-loading={busy}>{t.confirm}</button>
              <button className="btn btn-sm btn-ghost" type="button" onClick={() => { setSetup(null); setErr(null); }}>{t.cancel}</button>
            </div>
          </form>
        )}
        {me.totpEnabled && !disabling && (
          <button type="button" className="btn btn-sm btn-ghost" style={{ justifySelf: "start" }} onClick={() => { setDisabling(true); setErr(null); }}>{t.disable}</button>
        )}
        {me.totpEnabled && disabling && (
          <form className="app-2fa" onSubmit={disable} noValidate>
            <p className="ok-muted">{t.disableText}</p>
            <Field label={d.app.auth.password}>{(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
            <Field label={d.app.auth.mfaCode} error={err ?? undefined}>
              {(p) => <input {...p} className="input app-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />}
            </Field>
            <div className="ok-actions">
              <button className="btn btn-sm" type="submit" disabled={busy} data-loading={busy}>{t.disable}</button>
              <button className="btn btn-sm btn-ghost" type="button" onClick={() => { setDisabling(false); setErr(null); }}>{t.cancel}</button>
            </div>
          </form>
        )}
      </Panel>
      <div className="ok-grid-2">
        <Panel title={t.sessions}>
          <ul className="ok-list">
            {(sessions ?? []).map((s) => (
              <li key={s.id}>
                <Icon name="lock" size={16} />
                <span className="ok-grow">
                  <b>{device(s.userAgent, t.unknownDevice)}</b>
                  <small>{s.ip ?? ""} · {t.lastSeen}: {f.ago(new Date(s.lastSeenAt).getTime())}</small>
                </span>
                {s.current ? <span className="ok-pill" data-s="done">{t.current}</span> : <button type="button" className="ok-link" onClick={() => end(s.id)}>{t.end}</button>}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title={t.history}>
          <ul className="ok-list">
            {(history ?? []).map((h, i) => (
              <li key={i}>
                <i className="ok-state" data-s={h.success ? "ok" : "bad"} aria-label={h.success ? t.ok : t.fail} />
                <span className="ok-grow">
                  <b>{(t.reasons as Record<string, string>)[h.reason] ?? h.reason}</b>
                  <small>{device(h.userAgent, t.unknownDevice)} · {h.ip ?? ""}</small>
                </span>
                <small className="ok-muted">{f.dateTime(new Date(h.createdAt).getTime())}</small>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      {flash}
    </div>
  );
}
