"use client";

import { useEffect, useState } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt, withLang } from "@/i18n";
import { contacts } from "@/data/contacts";
import { brandIcons, type Brand } from "@/data/brand-icons";
import { BrandIcon, PhoneIcon } from "./PfTop";
import { PfLeadForm } from "./PfLeadForm";
import { usePortfolioSettings } from "./settings";

const WRITE: { brand: Brand; href: string }[] = [
  { brand: "viber", href: contacts.viber.url },
  { brand: "whatsapp", href: contacts.whatsapp.url },
  { brand: "telegram", href: contacts.telegram.url },
  { brand: "facebook", href: contacts.facebook.url },
];
const ext = (href: string) => (href.startsWith("http") ? { target: "_blank", rel: "noopener" } : {});

/** Final block and contacts (answers 189, 190, 212, 227, 285): price, a call, the number to copy, messengers, the form. */
export function PfFinal() {
  const t = useDict().pf.final;
  const lang = useLang();
  const { placesLeft } = usePortfolioSettings();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(contacts.phone.display);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard blocked: the number is on screen anyway */
    }
  };
  return (
    <section id="kontakty" className="pf-section pf-final" aria-labelledby="pf-final-title">
      <div className="pf-wrap pf-final-grid">
        <div className="pf-final-copy">
          <h2 id="pf-final-title" className="pf-h2" data-reveal="up">{t.title}</h2>
          {placesLeft > 0 && <p className="pf-final-places" data-reveal="up">{fmt(t.places, { n: placesLeft })}</p>}
          <div className="pf-actions" data-reveal="up">
            <a className="pf-btn pf-btn-amber pf-btn-lg" href={withLang(lang, "/cina/")}>{t.calc}</a>
            <a className="pf-btn pf-btn-ghost pf-btn-lg" href={contacts.phone.tel}><PhoneIcon /> {t.call}</a>
          </div>
          <div className="pf-contacts" data-reveal="up">
            <a className="pf-big-phone" href={contacts.phone.tel}>{contacts.phone.display}</a>
            <button type="button" className="pf-link" onClick={copy}>{copied ? t.copied : t.copy}</button>
            <p className="pf-hours">{t.hours}</p>
            <p className="pf-write">{t.write}</p>
            <ul className="pf-write-list">
              {WRITE.map((m) => (
                <li key={m.brand}>
                  <a href={m.href} {...ext(m.href)} style={{ ["--brand" as string]: brandIcons[m.brand].hex }}>
                    <BrandIcon brand={m.brand} size={22} />
                    <span>{brandIcons[m.brand].title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div data-reveal="up">
          <PfLeadForm />
        </div>
      </div>
    </section>
  );
}

/** Footer (answers 226, 333, 486) and «Нагору» (489). */
export function PfFooter() {
  const t = useDict().pf.footer;
  const f = useDict().pf.final;
  const svc = useDict().pf.services;
  const tech = useDict().pf.tech.homeCta;
  const lang = useLang();
  const [up, setUp] = useState(false);
  useEffect(() => {
    const on = () => setUp(window.scrollY > window.innerHeight * 1.5);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <footer className="pf-footer">
      <div className="pf-wrap pf-footer-grid">
        <p className="pf-footer-line">{t.line}</p>
        <p className="pf-footer-contact">
          <a href={contacts.phone.tel}>{contacts.phone.display}</a> · {f.hours}
        </p>
        <ul className="pf-footer-social">
          {WRITE.map((m) => (
            <li key={m.brand}>
              <a href={m.href} {...ext(m.href)} aria-label={brandIcons[m.brand].title} style={{ ["--brand" as string]: brandIcons[m.brand].hex }}>
                <BrandIcon brand={m.brand} />
              </a>
            </li>
          ))}
        </ul>
        <nav className="pf-footer-services" aria-label={svc.footer}>
          {svc.items.map((x) => <a key={x.slug} href={withLang(lang, `/${x.slug}/`)}>{x.nav}</a>)}
          {lang === "uk" && <a href="/tekhnika/">{tech}</a>}
        </nav>
        <nav className="pf-footer-links" aria-label={t.privacy}>
          <a href={withLang(lang, "/legal/privacy/")}>{t.privacy}</a>
          <a href={lang === "uk" ? "/en/" : "/"} hrefLang={lang === "uk" ? "en" : "uk"}>{t.other}</a>
        </nav>
        <p className="pf-footer-sign">{t.sign}</p>
      </div>
      <a href="#top" className="pf-totop" data-show={up || undefined} aria-label={t.top} tabIndex={up ? 0 : -1}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
      </a>
    </footer>
  );
}
