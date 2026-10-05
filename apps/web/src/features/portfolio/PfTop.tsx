"use client";

import { useEffect, useState } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt, withLang } from "@/i18n";
import { contacts } from "@/data/contacts";
import { brandIcons, type Brand } from "@/data/brand-icons";
import { KnightMark } from "@/components/global/Logo";
import { usePortfolioSettings } from "./settings";

const BAR_KEY = "pf.discount.closed";
const MESSENGERS: { brand: Brand; href: string }[] = [
  { brand: "viber", href: contacts.viber.url },
  { brand: "whatsapp", href: contacts.whatsapp.url },
  { brand: "telegram", href: contacts.telegram.url },
];

export function PhoneIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" />
    </svg>
  );
}

export function BrandIcon({ brand, size = 20 }: { brand: Brand; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path fill="currentColor" d={brandIcons[brand].path} />
    </svg>
  );
}

const ext = (href: string) => (href.startsWith("http") ? { target: "_blank", rel: "noopener" } : {});

/**
 * Discount bar (closable, answer 481) and the header: shrinks on scroll and stays (331); messengers and a call on
 * computers (114), one «Зв'язатись» button on phones (332), «Порахувати ціну» (442).
 */
export function PfTop() {
  const t = useDict().pf;
  const lang = useLang();
  const [small, setSmall] = useState(false);
  const [sheet, setSheet] = useState<"contact" | "menu" | null>(null);
  const [closed, setClosed] = useState(true);
  const { placesLeft } = usePortfolioSettings();

  useEffect(() => {
    try {
      setClosed(localStorage.getItem(BAR_KEY) === "1");
    } catch {
      setClosed(false);
    }
    const onScroll = () => setSmall(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheet(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheet]);

  const bar = placesLeft > 0 && !closed;
  const closeBar = () => {
    setClosed(true);
    try {
      localStorage.setItem(BAR_KEY, "1");
    } catch {
      /* closes for this page view only */
    }
  };
  const calc = withLang(lang, "/cina/");
  const home = withLang(lang, "/");
  const nav = [
    { href: `${home}#roboty`, label: t.nav.works },
    { href: `${home}#cina`, label: t.nav.prices },
    { href: `${home}#pro-mene`, label: t.nav.about },
    { href: `${home}#pytannia`, label: t.nav.faq },
    { href: `${home}#kontakty`, label: t.nav.contacts },
  ];

  return (
    <div className="pf-top" data-small={small || undefined}>
      {bar && (
        <div className="pf-bar">
          <a href={calc}>
            <b>{t.discount.text}</b>
            <span>· {fmt(t.discount.left, { n: placesLeft })}</span>
          </a>
          <button type="button" onClick={closeBar} aria-label={t.discount.close}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      )}
      <header className="pf-header">
        <div className="pf-wrap pf-header-row">
          <a className="pf-brand" href={withLang(lang, "/")}>
            <KnightMark size={34} />
            <span>
              <b>{t.header.name}</b>
              <small>ONEKNIGHT</small>
            </span>
          </a>
          <nav className="pf-nav" aria-label={t.nav.label}>
            {nav.map((n) => (
              <a key={n.href} href={n.href}>{n.label}</a>
            ))}
          </nav>
          <div className="pf-header-actions">
            <ul className="pf-quick">
              {MESSENGERS.map((m) => (
                <li key={m.brand}>
                  <a href={m.href} {...ext(m.href)} aria-label={brandIcons[m.brand].title} title={brandIcons[m.brand].title} style={{ ["--brand" as string]: brandIcons[m.brand].hex }}>
                    <BrandIcon brand={m.brand} />
                  </a>
                </li>
              ))}
              <li>
                <a href={contacts.phone.tel} aria-label={`${t.header.call}: ${contacts.phone.display}`} title={contacts.phone.display} style={{ ["--brand" as string]: "#f2a93b" }}>
                  <PhoneIcon />
                </a>
              </li>
            </ul>
            <a className="pf-btn pf-btn-amber pf-btn-sm pf-header-calc" href={calc}>{t.header.calc}</a>
            <button type="button" className="pf-btn pf-btn-ghost pf-btn-sm pf-only-phone" onClick={() => setSheet("contact")} aria-haspopup="dialog">
              {t.header.contact}
            </button>
            <button type="button" className="pf-burger pf-only-phone" onClick={() => setSheet("menu")} aria-label={t.nav.menu} aria-haspopup="dialog">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
          </div>
        </div>
      </header>

      {sheet && (
        <div className="pf-sheet" role="dialog" aria-modal="true" aria-label={sheet === "contact" ? t.header.contactTitle : t.nav.menu} onClick={(e) => e.target === e.currentTarget && setSheet(null)}>
          <div className="pf-sheet-card">
            <div className="pf-sheet-head">
              <b>{sheet === "contact" ? t.header.contactTitle : t.nav.menu}</b>
              <button type="button" onClick={() => setSheet(null)} aria-label={t.header.close} autoFocus>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            {sheet === "contact" ? (
              <ul className="pf-sheet-list">
                <li>
                  <a className="pf-contact pf-contact-call" href={contacts.phone.tel}>
                    <PhoneIcon size={22} />
                    <span><small>{t.header.call}</small>{contacts.phone.display}</span>
                  </a>
                </li>
                {MESSENGERS.map((m) => (
                  <li key={m.brand}>
                    <a className="pf-contact" href={m.href} {...ext(m.href)} style={{ ["--brand" as string]: brandIcons[m.brand].hex }}>
                      <BrandIcon brand={m.brand} size={22} />
                      <span>{brandIcons[m.brand].title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="pf-sheet-list">
                {nav.map((n) => (
                  <li key={n.href}>
                    <a className="pf-menu-link" href={n.href} onClick={() => setSheet(null)}>{n.label}</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Phones: «Подзвонити» + «Порахувати ціну» always at hand (answer 211). */
export function PfMobileBar({ callOnly = false }: { callOnly?: boolean }) {
  const t = useDict().pf;
  const lang = useLang();
  return (
    <div className="pf-mobilebar" data-call-only={callOnly || undefined}>
      <a className="pf-btn pf-btn-ghost" href={contacts.phone.tel}>
        <PhoneIcon /> {t.mobileBar.call}
      </a>
      {!callOnly && <a className="pf-btn pf-btn-amber" href={withLang(lang, "/cina/")}>{t.mobileBar.calc}</a>}
    </div>
  );
}
