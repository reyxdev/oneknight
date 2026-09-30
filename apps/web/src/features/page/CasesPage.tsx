import type { Lang } from "@/config";
import { getDict } from "@/i18n";
import { CaseStudy } from "@/features/case/CaseStudy";
import { OrderButton } from "@/features/cta/OrderButton";

/** /cases: every real project (owner's decision H35); the best one is also on the home page. */
export function CasesPage({ lang }: { lang: Lang }) {
  const dict = getDict(lang);
  const t = dict.casesPage;
  return (
    <>
      <section className="section panel-hero" aria-labelledby="cases-title">
        <div className="wrap">
          <p className="eyebrow" data-reveal="up">{t.eyebrow}</p>
          <h1 id="cases-title" className="h1" data-reveal="up">{t.title}</h1>
          <p className="lead" data-reveal="up">{t.lead}</p>
        </div>
      </section>
      <CaseStudy dict={dict} lang={lang} />
      <section className="section panel-final scheme-dark">
        <div className="wrap">
          <OrderButton authAware={false} className="btn btn-lg">{t.cta}</OrderButton>
        </div>
      </section>
    </>
  );
}
