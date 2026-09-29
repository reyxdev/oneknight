import type { Dict } from "@/i18n";
import type { Lang } from "@/config";
import { fmt } from "@/i18n";
import { formatUAH, oneknightPricing as P } from "@/data/pricing";
import { OfferCalc } from "./OfferCalc";
import { OrderButton } from "@/features/cta/OrderButton";

export function OfferSection({ dict, lang }: { dict: Dict; lang: Lang }) {
  const t = dict.offer;
  const per = (n: number) => fmt(dict.common.perMonth, { price: formatUAH(n, lang) });
  return (
    <section id="offer" data-chapter className="section offer scheme-dark" aria-labelledby="offer-title">
      <div className="wrap offer-wrap">
        <p className="eyebrow" data-reveal="up">{t.eyebrow}</p>
        <h2 id="offer-title" className="h1 offer-title" data-reveal="up">{t.title}</h2>
        <div className="offer-zeros">
          <div className="offer-zero" data-reveal="scale">
            <span>{t.a}</span>
            <b>{t.zero}</b>
          </div>
          <span className="offer-plus" aria-hidden="true">+</span>
          <div className="offer-zero" data-reveal="scale" style={{ ["--i" as string]: 1 }}>
            <span>{fmt(t.b, { n: P.freeModules })}</span>
            <b>{t.zero}</b>
          </div>
        </div>
        <div className="offer-after">
          <div className="offer-table" data-reveal="up">
            <h3 className="h3">{fmt(t.afterTitle, { m: P.freeMonths })}</h3>
            <dl>
              <div><dt>{t.rows.ok}</dt><dd className="num">{per(P.perMonth)}</dd></div>
              <div><dt>{t.rows.module}</dt><dd className="num">{per(P.modulePerMonth)}</dd></div>
              <div><dt>{t.rows.support} <small>{t.optional}</small></dt><dd className="num">{per(P.supportPerMonth)}</dd></div>
            </dl>
            <p className="small">{t.honest}</p>
          </div>
          <div data-reveal="up" style={{ ["--i" as string]: 1 }}><OfferCalc /></div>
        </div>
        <div data-reveal="up">
          <OrderButton authAware={false} className="btn btn-lg offer-cta">{dict.nav.order}</OrderButton>
        </div>
      </div>
    </section>
  );
}
