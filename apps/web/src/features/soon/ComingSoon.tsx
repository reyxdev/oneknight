import type { Lang } from "@/config";
import { getDict, withLang } from "@/i18n";
import { contacts } from "@/data/contacts";
import { brandIcons, type Brand } from "@/data/brand-icons";
import { KnightMark } from "@/components/global/Logo";

const LINKS: { brand: Brand; href: string }[] = [
  { brand: "viber", href: contacts.viber.url },
  { brand: "whatsapp", href: contacts.whatsapp.url },
  { brand: "telegram", href: contacts.telegram.url },
  { brand: "facebook", href: contacts.facebook.url },
];

/**
 * «Скоро»: the only public page while the new portfolio is built (owner's answers 348, 351–356). Already in the new
 * style: dark, warm amber accent, Unbounded headings, large text and large buttons; no sign-in link.
 */
export function ComingSoon({ lang }: { lang: Lang }) {
  const t = getDict(lang).soon;
  return (
    <div className="soon">
      <main className="soon-main">
        <span className="soon-mark" aria-hidden="true"><KnightMark size={44} /></span>
        <p className="soon-badge"><span aria-hidden="true" />{t.badge}</p>
        <h1 className="soon-title">{t.title}</h1>
        <p className="soon-text">{t.text}</p>
        <div className="soon-card">
          <div className="soon-who">
            <b>{t.name}</b>
            <span>{t.role}</span>
          </div>
          <a className="soon-call" href={contacts.phone.tel}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" /></svg>
            <span><small>{t.call}</small>{contacts.phone.display}</span>
          </a>
          <p className="soon-hours">{t.hours}</p>
          <p className="soon-write">{t.write}</p>
          <ul className="soon-messengers">
            {LINKS.map(({ brand, href }) => (
              <li key={brand}>
                <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener" style={{ ["--brand" as string]: brandIcons[brand].hex }}>
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d={brandIcons[brand].path} /></svg>
                  <span>{brandIcons[brand].title}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <footer className="soon-footer">
        <p>{t.footer}</p>
        <nav aria-label={t.privacy}>
          <a href={withLang(lang, "/legal/privacy/")}>{t.privacy}</a>
          <a href={lang === "uk" ? "/en/" : "/"} hrefLang={lang === "uk" ? "en" : "uk"}>{t.other}</a>
        </nav>
      </footer>
    </div>
  );
}
