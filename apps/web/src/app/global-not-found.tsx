import "@/styles/globals.css";
import type { Metadata } from "next";
import { geologica } from "./fonts";
import { bootScript } from "@/lib/prefs";
import { uk } from "@/i18n/uk";
import { en } from "@/i18n/en";
import { KnightMark } from "@/components/global/Logo";

export const metadata: Metadata = { title: "404 | ONEKNIGHT", robots: { index: false } };

/**
 * Bilingual on purpose: this page is served for any unmatched URL, so the language is unknown.
 * Both versions are in the HTML; a tiny script hides the wrong one by pathname.
 */
export default function GlobalNotFound() {
  const langScript = `(function(){var en=/^\\/en(\\/|$)/.test(location.pathname);document.documentElement.lang=en?'en':'uk';document.querySelectorAll('[data-l]').forEach(function(n){n.hidden=n.dataset.l!==(en?'en':'uk')});})();`;
  return (
    <html lang="uk" className={geologica.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body className="scheme-dark" style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "2rem" }}>
        <main className="wrap grid justify-items-start gap-6" style={{ maxWidth: 900 }}>
          <span aria-hidden="true"><KnightMark size={56} /></span>
          <p className="eyebrow">404</p>
          {([["uk", uk.notFound, "/"], ["en", en.notFound, "/en/"]] as const).map(([l, t, href]) => (
            <div key={l} data-l={l} hidden={l !== "uk"} className="grid justify-items-start gap-6">
              <h1 className="display" style={{ fontSize: "clamp(3rem, 12vw, 9rem)" }}>{t.title}</h1>
              <p className="lead">{t.text}</p>
              <a className="btn btn-lg" href={href} style={{ background: "var(--paper)", color: "var(--ink)" }}>{t.cta}</a>
              <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="404">
                <a className="underline underline-offset-4" href={`${href}#services`}>{t.links.services}</a>
                <a className="underline underline-offset-4" href={`${href}panel/`}>{t.links.panel}</a>
                <a className="underline underline-offset-4" href={`${href}app/`}>{t.links.login}</a>
              </nav>
            </div>
          ))}
        </main>
        <script dangerouslySetInnerHTML={{ __html: langScript }} />
      </body>
    </html>
  );
}
