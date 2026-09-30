"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { withLang } from "@/i18n";
import { Field } from "@/components/ui/Field";
import { KnightMark } from "@/components/global/Logo";
import { Icon } from "@/components/ui/Icon";
import { api, type Me } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { contacts } from "@/data/contacts";

type Mode = "login" | "register";
type Errors = Partial<Record<"name" | "phone" | "email" | "password" | "form", string>>;

/** «+380 67 123 45 67» from whatever was typed or pasted (0671234567, 380671234567, +38 (067)…). */
export function formatPhone(v: string) {
  let d = v.replace(/\D/g, "");
  if (d.startsWith("380")) d = d.slice(3);
  else if (d.startsWith("80")) d = d.slice(2);
  else if (d.startsWith("0")) d = d.slice(1);
  d = d.slice(0, 9);
  const parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean);
  return `+380${parts.length ? ` ${parts.join(" ")}` : " "}`;
}
const phoneComplete = (v: string) => v.replace(/\D/g, "").length === 12;

/** An invitation: the code itself or the whole link with ?invite=… pasted. */
const inviteToken = (v: string) => {
  const s = v.trim();
  try {
    return new URL(s).searchParams.get("invite") ?? s;
  } catch {
    return s;
  }
};

export function AuthScreen({ initial, onDone, onMfa, note }: { initial: Mode; onDone: (me: Me) => void; onMfa: () => void; note?: string }) {
  const t = useDict().app.auth;
  const lang = useLang();
  const [mode, setMode] = useState<Mode>(initial);
  const [f, setF] = useState({ name: "", phone: "+380 ", email: "", password: "", invite: "" });
  const [err, setErr] = useState<Errors>({});
  const [taken, setTaken] = useState(false);
  const [show, setShow] = useState(false);
  const [withInvite, setWithInvite] = useState(false);
  const [forgot, setForgot] = useState<"closed" | "open" | "sent">("closed");
  const [busy, setBusy] = useState(false);
  const e2 = t.errors as Record<string, string>;

  const switchTo = (m: Mode) => {
    setMode(m);
    setErr({});
    setTaken(false);
    setForgot("closed");
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v: Errors = {};
    if (mode === "register") {
      if (f.name.trim().length < 2) v.name = t.errors.name;
      if (!phoneComplete(f.phone)) v.phone = t.errors.phoneFormat;
      if (f.password.length < 8) v.password = t.errors.passwordShort;
    }
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) v.email = t.errors.emailFormat;
    if (mode === "login" && !f.password) v.password = t.errors.passwordShort;
    setErr(v);
    setTaken(false);
    if (Object.keys(v).length) {
      playSound("error");
      e.currentTarget.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      return;
    }
    setBusy(true);
    // A referral code from «?ref=» (kept for the session): both get a month after the first payment.
    const ref = new URLSearchParams(location.search).get("ref") ?? sessionStorage.getItem("ok_ref");
    // The invitation is accepted right after the account exists (AppRoot), like an invite link.
    if (mode === "register" && f.invite.trim()) sessionStorage.setItem("ok_invite", inviteToken(f.invite));
    const r =
      mode === "register"
        ? await api<Me>("/auth/register", { method: "POST", body: { name: f.name, phone: f.phone.replace(/\s/g, ""), email: f.email, password: f.password, ...(ref ? { ref } : {}) } })
        : await api<{ mfaRequired: boolean; user?: Me }>("/auth/login", { method: "POST", body: { email: f.email, password: f.password } });
    setBusy(false);
    if (!r.ok) {
      playSound("error");
      if (r.error === "email_taken") setTaken(true);
      else setErr({ form: e2[r.error] ?? t.errors.server_error });
      return;
    }
    setF((x) => ({ ...x, password: "" }));
    playSound("success");
    if (mode === "register") return onDone(r.data as Me);
    const d = r.data as { mfaRequired: boolean; user?: Me };
    if (d.mfaRequired) onMfa();
    else onDone(d.user!);
  };

  const askReset = async () => {
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return setErr({ email: t.errors.emailFormat });
    setBusy(true);
    await api("/auth/reset/telegram", { method: "POST", body: { email: f.email.trim() } });
    setBusy(false);
    setForgot("sent");
  };

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <main className="app-auth">
      <div className="app-auth-card card">
        <a href={withLang(lang, "/")} className="app-auth-brand" aria-label="ONEKNIGHT">
          <KnightMark size={36} />
          <b>ONEKNIGHT</b>
        </a>
        <div className="ok-seg" role="tablist" aria-label="ONEKNIGHT">
          {(["login", "register"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} aria-checked={mode === m} onClick={() => switchTo(m)}>
              {m === "login" ? t.loginTab : t.registerTab}
            </button>
          ))}
        </div>
        <h1 className="h3">{mode === "login" ? t.loginTitle : t.registerTitle}</h1>
        <p className="small">{t.lead}</p>
        {note && <p className="ok-note" role="status"><Icon name="person" size={15} />{note}</p>}
        <form className="grid gap-4" onSubmit={submit} noValidate>
          {mode === "register" && (
            <>
              <Field label={t.name} error={err.name}>{(p) => <input {...p} className="input" autoComplete="name" value={f.name} onChange={set("name")} />}</Field>
              <Field label={t.phone} error={err.phone}>{(p) => <input {...p} className="input" type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: formatPhone(e.target.value) })} />}</Field>
            </>
          )}
          <Field label={t.email} error={err.email} hint={mode === "register" ? t.noVerify : undefined}>
            {(p) => <input {...p} className="input" type="email" inputMode="email" autoComplete={mode === "login" ? "username" : "email"} value={f.email} onChange={set("email")} />}
          </Field>
          {forgot === "closed" && (
            <Field label={t.password} error={err.password} hint={mode === "register" ? t.passwordHint : undefined}>
              {(p) => (
                <span className="app-pass">
                  <input {...p} className="input" type={show ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} value={f.password} onChange={set("password")} />
                  <button type="button" className="app-pass-eye" aria-pressed={show} aria-label={show ? t.hidePassword : t.showPassword} title={show ? t.hidePassword : t.showPassword} onClick={() => setShow((v) => !v)}>
                    <Icon name="eye" size={17} />
                  </button>
                </span>
              )}
            </Field>
          )}
          {mode === "register" &&
            (withInvite ? (
              <Field label={t.inviteCode} hint={t.inviteHint}>{(p) => <input {...p} className="input" autoComplete="off" spellCheck={false} value={f.invite} onChange={set("invite")} />}</Field>
            ) : (
              <button type="button" className="ok-link" style={{ justifySelf: "start" }} onClick={() => setWithInvite(true)}>{t.haveInvite}</button>
            ))}
          {taken && (
            <p className="field-error" role="alert">
              {t.errors.email_taken}{" "}
              <button type="button" className="ok-link" onClick={() => switchTo("login")}>{t.login}</button>
            </p>
          )}
          {err.form && <p className="field-error" role="alert">{err.form}</p>}
          {forgot === "closed" ? (
            <button className="btn btn-lg" type="submit" disabled={busy} data-loading={busy}>
              {mode === "login" ? t.login : t.register}
            </button>
          ) : forgot === "open" ? (
            <div className="grid gap-2">
              <p className="small">{t.forgotLead}</p>
              <button className="btn btn-lg" type="button" disabled={busy} data-loading={busy} onClick={askReset}>{t.forgotSend}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setForgot("closed")}>{t.forgotBack}</button>
            </div>
          ) : (
            <div className="grid gap-2">
              <p className="ok-note" role="status">{t.forgotSent}</p>
              <p className="small">{t.forgotNoTelegram} <a className="underline underline-offset-4" href={contacts.telegram.url} target="_blank" rel="noopener">@{contacts.telegram.handle}</a></p>
              <button type="button" className="btn btn-ghost" onClick={() => setForgot("closed")}>{t.forgotBack}</button>
            </div>
          )}
          {mode === "register" && (
            <p className="small">
              {t.agree} <a className="underline underline-offset-4" href={withLang(lang, "/legal/oneknight-terms/")} target="_blank" rel="noopener">{t.terms}</a> {t.and}{" "}
              <a className="underline underline-offset-4" href={withLang(lang, "/legal/privacy/")} target="_blank" rel="noopener">{t.privacy}</a>.
            </p>
          )}
        </form>
        {mode === "login" && forgot === "closed" && <button type="button" className="ok-link" style={{ justifySelf: "start" }} onClick={() => { setForgot("open"); setErr({}); }}>{t.forgot}</button>}
        <a href={withLang(lang, "/#playground")} className="btn btn-secondary">{t.demo}</a>
        <a href={withLang(lang, "/")} className="small underline underline-offset-4">{t.back}</a>
      </div>
    </main>
  );
}

export function MfaScreen({ onDone, onCancel }: { onDone: (me: Me) => void; onCancel: () => void }) {
  const t = useDict().app.auth;
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const e2 = t.errors as Record<string, string>;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setErr(t.errors.code);
    setBusy(true);
    const r = await api<{ user: Me }>("/auth/login/totp", { method: "POST", body: { code } });
    setBusy(false);
    if (!r.ok) {
      playSound("error");
      setCode("");
      return setErr(e2[r.error] ?? t.errors.server_error);
    }
    playSound("success");
    onDone(r.data.user);
  };
  return (
    <main className="app-auth">
      <form className="app-auth-card card" onSubmit={submit} noValidate>
        <span className="app-auth-brand"><KnightMark size={36} /><b>ONEKNIGHT</b></span>
        <h1 className="h3">{t.mfaTitle}</h1>
        <p className="small">{t.mfaLead}</p>
        <Field label={t.mfaCode} error={err ?? undefined}>
          {(p) => (
            <input {...p} className="input app-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} autoFocus onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          )}
        </Field>
        <button className="btn btn-lg" type="submit" disabled={busy} data-loading={busy}>{t.mfaSubmit}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t.mfaCancel}</button>
      </form>
    </main>
  );
}

/** Opened from a one-time link the admin sent: sets a new password (2FA code still asked when it is on). */
export function ResetScreen({ token, onDone }: { token: string; onDone: (ok: boolean) => void }) {
  const t = useDict().app.auth;
  const [info, setInfo] = useState<{ name: string; totpRequired: boolean } | null | "invalid">(null);
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const e2 = t.errors as Record<string, string>;
  useEffect(() => {
    void api<{ name: string; totpRequired: boolean }>(`/auth/reset/${encodeURIComponent(token)}`).then((r) => setInfo(r.ok ? r.data : "invalid"));
  }, [token]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return setErr(t.errors.passwordShort);
    if (info && info !== "invalid" && info.totpRequired && !/^\d{6}$/.test(code)) return setErr(t.errors.code);
    setBusy(true);
    const r = await api("/auth/reset", { method: "POST", body: { token, password: pw, ...(code ? { code } : {}) } });
    setBusy(false);
    if (!r.ok) {
      playSound("error");
      setCode("");
      if (r.error === "invalid_link") return setInfo("invalid");
      return setErr(e2[r.error] ?? t.errors.server_error);
    }
    playSound("success");
    onDone(true);
  };
  if (info === null) return <main className="app-center" aria-busy="true"><span className="app-pulse"><KnightMark size={48} /></span></main>;
  return (
    <main className="app-auth">
      {info === "invalid" ? (
        <div className="app-auth-card card">
          <span className="app-auth-brand"><KnightMark size={36} /><b>ONEKNIGHT</b></span>
          <h1 className="h3">{t.resetTitle}</h1>
          <p className="small">{t.resetInvalid}</p>
          <button type="button" className="btn" onClick={() => onDone(false)}>{t.login}</button>
        </div>
      ) : (
        <form className="app-auth-card card" onSubmit={submit} noValidate>
          <span className="app-auth-brand"><KnightMark size={36} /><b>ONEKNIGHT</b></span>
          <h1 className="h3">{t.resetTitle}</h1>
          <p className="small">{t.resetLead.replace("{name}", info.name)}</p>
          <Field label={t.newPassword} hint={t.passwordHint} error={!info.totpRequired || pw.length < 8 ? err ?? undefined : undefined}>
            {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} />}
          </Field>
          {info.totpRequired && (
            <Field label={t.resetCode} error={pw.length >= 8 ? err ?? undefined : undefined}>
              {(p) => <input {...p} className="input app-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />}
            </Field>
          )}
          <button className="btn btn-lg" type="submit" disabled={busy} data-loading={busy}>{t.resetSubmit}</button>
        </form>
      )}
    </main>
  );
}
