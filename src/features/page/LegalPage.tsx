import type { Lang } from "@/config";
import { getDict, withLang } from "@/i18n";
import { legalSections, type LegalDoc } from "@/data/legal";

/** Structure only. The wording is pending legal review and must not be invented. */
export function LegalPage({ lang, doc }: { lang: Lang; doc: LegalDoc }) {
  const dict = getDict(lang);
  return (
    <article className="wrap section" style={{ maxWidth: 860, paddingTop: "8rem" }}>
      <a href={withLang(lang, "/")} className="small underline underline-offset-4">{dict.legal.back}</a>
      <h1 className="h1 mt-6 mb-6">{dict.legal.docs[doc]}</h1>
      <div className="card mb-10 p-5" role="note">
        <p className="font-bold">{dict.legal.pendingTitle}</p>
        <p className="small mt-1">{dict.legal.pendingText}</p>
      </div>
      <div className="grid gap-8">
        {legalSections.map((s, i) => (
          <section key={s} aria-labelledby={`s-${s}`}>
            <h2 id={`s-${s}`} className="h3">{i + 1}. {dict.legal.sections[s]}</h2>
            <p className="small mt-2 border-l-2 border-line-strong pl-4">TODO</p>
          </section>
        ))}
      </div>
    </article>
  );
}
