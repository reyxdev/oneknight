"use client";

import { useId, useState, type FormEvent } from "react";
import { CONTACT_WAYS, normalizeUaPhone, type ContactWay, type PortfolioInput, type Sprava } from "@oneknight/domain";
import { useDict, useLang } from "@/i18n/provider";
import { fmt, withLang } from "@/i18n";
import { api } from "@/lib/api";
import { contacts } from "@/data/contacts";

export type CalcSnapshot = PortfolioInput & { sprava: Sprava | null };

/** Owner works every day 9:00–21:00 Kyiv time (answer 208). */
function lateNow() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "numeric", hour12: false }).format(new Date()));
  return h >= 21;
}

/**
 * The lead form (answers 161, 201–207, 287–289, 335, 416–419): name, phone, how to reach, about the business.
 * Goes to the admin and the owner's Telegram; nothing is redirected anywhere. What was typed is kept on errors.
 */
export function PfLeadForm({ calc }: { calc?: CalcSnapshot | null }) {
  const t = useDict().pf.calc.form;
  const lang = useLang();
  const id = useId();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [how, setHow] = useState<ContactWay>("call");
  const [about, setAbout] = useState("");
  const [trap, setTrap] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2 || !phone.trim()) return setError(t.required);
    if (!normalizeUaPhone(phone)) return setError(t.badPhone);
    setBusy(true);
    const r = await api<{ number: number }>("/leads/portfolio", { method: "POST", body: { name: name.trim(), phone, contact: how, about: about.trim() || undefined, calc: calc ?? undefined, locale: lang, website: trap } });
    setBusy(false);
    if (r.ok) return setDone(fmt(lateNow() ? t.thanksLate : t.thanks, { name: name.trim() }));
    setError(fmt(r.status === 429 ? t.tooMany : r.error === "bad_phone" ? t.badPhone : t.failed, { phone: contacts.phone.display }));
  };

  if (done)
    return (
      <div className="pf-form pf-form-done" role="status">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M7.5 12.5l3 3 6-6.5" /></svg>
        <p className="pf-form-thanks">{done}</p>
        <ol className="pf-form-steps">{t.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        <p>{t.saveNumber}</p>
        <a className="pf-big-phone" href={contacts.phone.tel}>{contacts.phone.display}</a>
      </div>
    );

  return (
    <form className="pf-form" onSubmit={submit} noValidate>
      <p className="pf-form-title">{t.title}</p>
      <ol className="pf-form-steps">{t.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      <div className="pf-field">
        <label htmlFor={`${id}-n`}>{t.name}</label>
        <input id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={100} required />
      </div>
      <div className="pf-field">
        <label htmlFor={`${id}-p`}>{t.phone}</label>
        <input id={`${id}-p`} value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="067 123 45 67" maxLength={20} required aria-describedby={`${id}-ph`} />
        <small id={`${id}-ph`}>{t.phoneHint}</small>
      </div>
      <fieldset className="pf-field pf-how">
        <legend>{t.how}</legend>
        <div className="pf-chips">
          {CONTACT_WAYS.map((w) => (
            <button key={w} type="button" className="pf-chip" aria-pressed={how === w} onClick={() => setHow(w)}>{t.hows[w]}</button>
          ))}
        </div>
      </fieldset>
      <div className="pf-field">
        <label htmlFor={`${id}-a`}>{t.about}</label>
        <textarea id={`${id}-a`} value={about} onChange={(e) => setAbout(e.target.value)} rows={3} maxLength={1000} placeholder={t.aboutHint} />
      </div>
      {/* Spam trap: invisible to people (answer 417). */}
      <input className="pf-trap" tabIndex={-1} autoComplete="off" aria-hidden="true" value={trap} onChange={(e) => setTrap(e.target.value)} name="website" />
      {error && <p className="pf-form-error" role="alert">{error}</p>}
      <button type="submit" className="pf-btn pf-btn-amber pf-btn-lg pf-form-submit" disabled={busy}>{t.submit}</button>
      <p className="pf-form-note">{t.hours}</p>
      <p className="pf-form-note">{t.privacy} <a href={withLang(lang, "/legal/privacy/")}>{t.privacyLink}</a></p>
    </form>
  );
}
