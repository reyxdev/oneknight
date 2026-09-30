"use client";

import { useEffect, useState } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt, withLang } from "@/i18n";
import { contacts } from "@/data/contacts";
import { Icon } from "@/components/ui/Icon";

const COOKIES_KEY = "ok.cookies";
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode: the notice simply shows again next time */
  }
};

/** A small note: only necessary cookies are used (owner's decision 30.09.2026), so no choice to make. */
export function CookieNotice() {
  const t = useDict().siteBits.cookies;
  const lang = useLang();
  const [show, setShow] = useState(false);
  useEffect(() => setShow(read(COOKIES_KEY) !== "1"), []);
  if (!show) return null;
  return (
    <div className="site-cookies" role="region" aria-label="Cookies">
      <p>{t.text} <a href={withLang(lang, "/legal/cookies/")} className="underline underline-offset-4">{t.more}</a></p>
      <button type="button" className="btn btn-sm" onClick={() => { write(COOKIES_KEY, "1"); setShow(false); }}>{t.ok}</button>
    </div>
  );
}

/** «Написати»: on phones only, the owner's own channels. */
export function ContactFab() {
  const d = useDict();
  const t = d.siteBits.write;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);
  return (
    <div className="site-fab" data-open={open}>
      {open && (
        <div className="site-fab-menu" id="site-fab-menu">
          <a href={contacts.telegram.url} target="_blank" rel="noopener">{d.footer.telegram}</a>
          <a href={contacts.viber.url}>{d.footer.viber}</a>
          <a href={contacts.whatsapp.url} target="_blank" rel="noopener">{d.footer.whatsapp}</a>
          <a href={contacts.phone.tel}>{t.call}</a>
        </div>
      )}
      <button type="button" className="btn site-fab-btn" aria-expanded={open} aria-controls="site-fab-menu" onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? "close" : "chat"} size={18} />
        {t.button}
      </button>
    </div>
  );
}

/** «Вас запросив бізнес X»: from a referral link (?ref=), kept for the visit so the new account gets the bonus. */
export function InviteStrip() {
  const t = useDict().siteBits.invite;
  const lang = useLang();
  const [invite, setInvite] = useState<{ code: string; name: string } | null>(null);
  useEffect(() => {
    let code = new URLSearchParams(location.search).get("ref");
    try {
      if (code) sessionStorage.setItem("ok_ref", code);
      else code = sessionStorage.getItem("ok_ref");
      if (sessionStorage.getItem("ok_ref_closed") === code) return;
    } catch {
      /* no storage: the strip still shows for this page */
    }
    if (!code || !/^[A-Za-z0-9]{8}$/.test(code)) return;
    void fetch(`/api/site/invite/${code}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((x: { business?: string } | null) => x?.business && setInvite({ code: code!, name: x.business }))
      .catch(() => {});
  }, []);
  if (!invite) return null;
  return (
    <div className="site-invite" role="note">
      <p><b>{fmt(t.text, { name: invite.name })}</b> {t.offer}</p>
      <a className="btn btn-sm" href={withLang(lang, `/app/?start=register&ref=${invite.code}`)}>{t.cta}</a>
      <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={t.close} onClick={() => { try { sessionStorage.setItem("ok_ref_closed", invite.code); } catch { /* ignore */ } setInvite(null); }}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
