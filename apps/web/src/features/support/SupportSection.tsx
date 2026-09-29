import type { Dict } from "@/i18n";
import type { Lang } from "@/config";
import { fmt } from "@/i18n";
import { formatUAH, oneknightPricing as P } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { OrderButton } from "@/features/cta/OrderButton";

export function SupportSection({ dict, lang }: { dict: Dict; lang: Lang }) {
  const t = dict.supportPlan;
  return (
    <section id="support" data-chapter className="section support" aria-labelledby="support-title">
      <div className="wrap support-grid">
        <div className="support-copy">
          <p className="eyebrow" data-reveal="up">{t.eyebrow}</p>
          <h2 id="support-title" className="h2" data-reveal="up">{t.title}</h2>
          <p className="lead" data-reveal="up">{fmt(t.response, { h: P.supportResponseHours })} {t.separate}</p>
        </div>
        <div className="card support-card" data-reveal="up">
          <div className="support-price">
            <span>{t.plan}</span>
            <b className="num">{fmt(t.price, { price: formatUAH(P.supportPerMonth, lang) })}</b>
          </div>
          <ul>
            {t.includes.map((x) => (
              <li key={x}><Icon name="check" size={16} />{x}</li>
            ))}
          </ul>
          <OrderButton authAware={false} start="call" magnetic={false} className="btn btn-secondary">{t.cta}</OrderButton>
        </div>
        <details className="support-hw" data-reveal="up">
          <summary>{t.hardwareTitle}<Icon name="plus" size={16} /></summary>
          <ul>
            {t.hardware.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}
