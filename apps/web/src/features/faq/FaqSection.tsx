import type { Dict } from "@/i18n";
import type { Lang } from "@/config";
import { fmt } from "@/i18n";
import { formatUAH, oneknightPricing as P, websiteTypes } from "@/data/pricing";

/** Prices come from the domain package, never from the texts. */
function vars(lang: Lang) {
  const t = Object.fromEntries(websiteTypes.map((w) => [w.id, formatUAH(w.from, lang)]));
  return { ...t, month: formatUAH(P.perMonth, lang), module: formatUAH(P.modulePerMonth, lang), site: formatUAH(P.extraSitePerMonth, lang), freeMonths: P.freeMonths, freeModules: P.freeModules, gift: P.yearGiftMonths };
}

export function faqItems(dict: Dict, lang: Lang, page: "home" | "panel") {
  const v = vars(lang);
  return dict.faq.items.filter((x) => x.on.includes(page)).map((x) => ({ q: x.q, a: x.a.map((p) => fmt(p, v)) }));
}

/** FAQ on the home page and on /panel (7 topics, owner's decision H27), with FAQPage data for search engines. */
export function FaqSection({ dict, lang, page = "home" }: { dict: Dict; lang: Lang; page?: "home" | "panel" }) {
  const items = faqItems(dict, lang, page);
  const ld = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a.join(" ") } })) };
  return (
    <section id="faq" className="section faq" aria-labelledby="faq-title">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <div className="wrap faq-grid">
        <div>
          <p className="eyebrow" data-reveal="up">{dict.faq.eyebrow}</p>
          <h2 id="faq-title" className="h2" data-reveal="up">{dict.faq.title}</h2>
        </div>
        <div className="faq-list">
          {items.map((x) => (
            <details key={x.q} className="faq-item">
              <summary>{x.q}</summary>
              {x.a.map((p) => <p key={p}>{p}</p>)}
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
