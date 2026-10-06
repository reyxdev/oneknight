"use client";

import { useEffect, useRef, useState } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt, withLang } from "@/i18n";
import { contacts } from "@/data/contacts";
import { brandIcons, type Brand } from "@/data/brand-icons";
import { KnightMark } from "@/components/global/Logo";
import { usePortfolioSettings } from "./settings";

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
 * «−25% першим 10» as a paper price sticker with ten boxes, the used ones crossed out in pen (answers 536, 537, 655).
 * Hidden when no places are left.
 */
export function DiscountSticker({ className = "" }: { className?: string }) {
  const t = useDict().pf.discount;
  const lang = useLang();
  const { placesLeft } = usePortfolioSettings();
  if (placesLeft <= 0) return null;
  const used = Math.max(0, 10 - placesLeft);
  return (
    <a className={`pf-sticker ${className}`} href={withLang(lang, "/cina/")} aria-label={fmt(t.aria, { n: placesLeft })}>
      <b>{t.sticker}</b>
      <span className="pf-boxes" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => <i key={i} data-used={i < used || undefined} />)}
      </span>
      <small aria-hidden="true">{fmt(t.left, { n: placesLeft })}</small>
    </a>
  );
}

/**
 * The header (answers 538, 569, 570, 637, 656, 657, 684–687): name on the left; the number, a small «Порахувати ціну»
 * and «Меню» on the right (on phones «Зв'язатись» and «Меню»). Solid paper; hides while scrolling down.
 */
export function PfTop() {
  const t = useDict().pf;
  const svc = useDict().pf.services;
  const lang = useLang();
  const [hidden, setHidden] = useState(false);
  const [sheet, setSheet] = useState<"contact" | "menu" | null>(null);
  const last = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setHidden(y > 120 && y > last.current);
      last.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheet(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheet]);

  const home = withLang(lang, "/");
  const nav = [
    { href: `${home}#roboty`, label: t.nav.works },
    { href: `${home}#yak`, label: t.nav.how },
    { href: `${home}#pro-mene`, label: t.nav.about },
    { href: `${home}#kontakty`, label: t.nav.contacts },
  ];

  return (
    <div className="pf-top" data-hidden={(hidden && !sheet) || undefined}>
      <header className="pf-header">
        <div className="pf-wrap pf-header-row">
          <a className="pf-brand" href={home}>
            <KnightMark size={32} />
            <b>{t.header.name}</b>
          </a>
          <div className="pf-header-actions">
            <a className="pf-header-phone" href={contacts.phone.tel}>{contacts.phone.display}</a>
            <a className="pf-btn pf-btn-amber pf-btn-sm pf-header-calc" href={withLang(lang, "/cina/")}>{t.header.calc}</a>
            <button type="button" className="pf-btn pf-btn-sm pf-only-phone" onClick={() => setSheet("contact")} aria-haspopup="dialog">{t.header.contact}</button>
            <button type="button" className="pf-btn pf-btn-sm" onClick={() => setSheet("menu")} aria-haspopup="dialog">{t.nav.menu}</button>
          </div>
        </div>
      </header>

      {sheet && (
        <div className="pf-sheet" role="dialog" aria-modal="true" aria-label={sheet === "contact" ? t.header.contactTitle : t.nav.menu} onClick={(e) => e.target === e.currentTarget && setSheet(null)}>
          <div className="pf-sheet-card" data-kind={sheet}>
            <div className="pf-sheet-head">
              <b>{sheet === "contact" ? t.header.contactTitle : t.nav.menu}</b>
              <button type="button" className="pf-btn pf-btn-sm" onClick={() => setSheet(null)} aria-label={t.header.close} autoFocus>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
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
              <nav aria-label={t.nav.label}>
                <ul className="pf-sheet-list pf-menu">
                  {nav.map((n) => (
                    <li key={n.href}><a className="pf-menu-link" href={n.href} onClick={() => setSheet(null)}>{n.label}</a></li>
                  ))}
                  <li className="pf-menu-group">
                    <span className="pf-menu-link">{t.nav.services}</span>
                    <ul>
                      {svc.items.map((x) => <li key={x.slug}><a href={withLang(lang, `/${x.slug}/`)}>{x.nav}</a></li>)}
                    </ul>
                  </li>
                  {lang === "uk" && <li><a className="pf-menu-link" href="/tekhnika/">{t.nav.tech}</a></li>}
                </ul>
                <p className="pf-menu-foot">
                  <a href={contacts.phone.tel}>{contacts.phone.display}</a>
                  <a href={lang === "uk" ? "/en/" : "/"} hrefLang={lang === "uk" ? "en" : "uk"}>{t.nav.lang}</a>
                </p>
              </nav>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Phones: «Подзвонити» + «Порахувати ціну» as two stickers on paper (answers 211, 638). */
export function PfMobileBar({ callOnly = false }: { callOnly?: boolean }) {
  const t = useDict().pf;
  const lang = useLang();
  return (
    <div className="pf-mobilebar" data-call-only={callOnly || undefined}>
      <a className="pf-btn" href={contacts.phone.tel}>
        <PhoneIcon /> {t.mobileBar.call}
      </a>
      {!callOnly && <a className="pf-btn pf-btn-amber" href={withLang(lang, "/cina/")}>{t.mobileBar.calc}</a>}
    </div>
  );
}
