import "@/styles/globals.css";
import type { Metadata } from "next";
import { geologica, unbounded } from "./fonts";
import { bootScript } from "@/lib/prefs";
import { uk } from "@/i18n/uk";
import { en } from "@/i18n/en";
import { KnightMark } from "@/components/global/Logo";

export const metadata: Metadata = { title: "404 | ONEKNIGHT", robots: { index: false } };

/**
 * The portfolio's 404 (answers 337, 338). Bilingual on purpose: this page is served for any unmatched URL, so the
 * language is unknown. Both versions are in the HTML; a tiny script hides the wrong one by pathname.
 */
export default function GlobalNotFound() {
  const langScript = `(function(){var en=/^\\/en(\\/|$)/.test(location.pathname);document.documentElement.lang=en?'en':'uk';document.querySelectorAll('[data-l]').forEach(function(n){n.hidden=n.dataset.l!==(en?'en':'uk')});})();`;
  return (
    <html lang="uk" className={`${geologica.variable} ${unbounded.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body>
        <div className="pf" style={{ display: "grid", placeItems: "center", padding: "2rem 1rem" }}>
          <main className="pf-wrap pf-404" style={{ display: "grid", justifyItems: "start", gap: "1rem" }}>
            <span className="pf-brand" aria-hidden="true"><KnightMark size={44} /></span>
            <p className="pf-404-code" aria-hidden="true">404</p>
            {([["uk", uk.pf.notFound, "/"], ["en", en.pf.notFound, "/en/"]] as const).map(([l, t, href]) => (
              <div key={l} data-l={l} hidden={l !== "uk"} style={{ display: "grid", justifyItems: "start", gap: "1.5rem" }}>
                <h1 className="pf-h1 pf-page-h1">{t.title}</h1>
                <div className="pf-actions">
                  <a className="pf-btn pf-btn-ghost pf-btn-lg" href={href}>{t.home}</a>
                  <a className="pf-btn pf-btn-amber pf-btn-lg" href={`${href}cina/`}>{t.calc}</a>
                </div>
              </div>
            ))}
          </main>
        </div>
        <script dangerouslySetInnerHTML={{ __html: langScript }} />
      </body>
    </html>
  );
}
