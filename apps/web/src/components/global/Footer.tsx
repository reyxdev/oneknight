import type { Dict } from "@/i18n";
import type { Lang } from "@/config";
import { withLang } from "@/i18n";
import { contacts } from "@/data/contacts";
import { legalDocs } from "@/data/legal";
import { KnightMark } from "./Logo";

export function Footer({ lang, dict }: { lang: Lang; dict: Dict }) {
  const year = new Date().getFullYear();
  return (
    <footer className="scheme-dark" id="contacts" data-chapter>
      <div className="wrap py-16 md:py-24">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="grid content-start gap-4">
            <span className="text-fg"><KnightMark size={44} /></span>
            <p className="h3 max-w-[14ch]">{dict.footer.tagline}</p>
          </div>
          <div>
            <h2 className="eyebrow mb-4">{dict.footer.contacts}</h2>
            <ul className="grid gap-2">
              <li><a className="ok-footer-link" href={contacts.telegram.url} rel="noopener" target="_blank">{dict.footer.telegram}<small>@{contacts.telegram.handle}</small></a></li>
              <li><a className="ok-footer-link" href={contacts.viber.url}>{dict.footer.viber}<small>{contacts.phone.display}</small></a></li>
              <li><a className="ok-footer-link" href={contacts.whatsapp.url} rel="noopener" target="_blank">{dict.footer.whatsapp}<small>{contacts.phone.display}</small></a></li>
              <li><a className="ok-footer-link" href={contacts.facebook.url} rel="noopener" target="_blank">{dict.footer.facebook}</a></li>
            </ul>
          </div>
          <div>
            <h2 className="eyebrow mb-4">{dict.footer.legal}</h2>
            <ul className="grid gap-2 text-[0.9375rem]">
              {legalDocs.map((d) => (
                <li key={d}>
                  <a className="text-muted transition-colors hover:text-fg" href={withLang(lang, `/legal/${d}/`)}>
                    {dict.legal.docs[d]}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="small mt-16 border-t border-line pt-6">© {year} ONEKNIGHT. {dict.footer.rights}</p>
      </div>
    </footer>
  );
}
