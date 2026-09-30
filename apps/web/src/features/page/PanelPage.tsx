import type { Lang } from "@/config";
import { fmt, getDict, withLang } from "@/i18n";
import { contacts } from "@/data/contacts";
import { formatUAH, oneknightPricing as P } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { ModulesSection, OneKnightPlayground } from "@/features/oneknight/OneKnightSections";
import { FaqSection } from "@/features/faq/FaqSection";

/**
 * /panel: ONEKNIGHT for those who already have a website — headline and «Спробувати 30 днів» → a day with ONEKNIGHT →
 * demo → modules → comparison → price → a sample content week → FAQ → call to action (owner's decisions H21–H23).
 */
export function PanelPage({ lang }: { lang: Lang }) {
  const dict = getDict(lang);
  const t = dict.panelPage;
  const register = withLang(lang, "/app/?start=register");
  const v = { month: formatUAH(P.perMonth, lang), module: formatUAH(P.modulePerMonth, lang), site: formatUAH(P.extraSitePerMonth, lang), gift: P.yearGiftMonths, freeMonths: P.freeMonths, freeModules: P.freeModules };
  const actions = (
    <div className="panel-actions">
      <a className="btn btn-lg" href={register} data-magnetic>{t.cta}<Icon name="arrow" size={18} /></a>
      <a className="btn btn-lg btn-secondary" href={contacts.telegram.url} target="_blank" rel="noopener"><Icon name="send" size={18} />{t.ask}</a>
    </div>
  );
  return (
    <>
      <section className="section panel-hero" aria-labelledby="panel-title">
        <div className="wrap">
          <p className="eyebrow" data-reveal="up">{t.eyebrow}</p>
          <h1 id="panel-title" className="h1" data-reveal="up" style={{ ["--i" as string]: 1 }}>{t.title}</h1>
          <p className="lead" data-reveal="up" style={{ ["--i" as string]: 2 }}>{t.lead}</p>
          <div data-reveal="up" style={{ ["--i" as string]: 3 }}>{actions}</div>
          <p className="small" data-reveal="up" style={{ ["--i" as string]: 4 }}>{t.ctaNote}</p>
        </div>
      </section>

      <section className="section panel-day" aria-labelledby="day-title">
        <div className="wrap">
          <div className="services-head">
            <p className="eyebrow" data-reveal="up">{t.day.eyebrow}</p>
            <h2 id="day-title" className="h2" data-reveal="up">{t.day.title}</h2>
          </div>
          <ol className="panel-timeline">
            {t.day.steps.map((s, i) => (
              <li key={s.time} data-reveal="up" style={{ ["--i" as string]: i }}>
                <span className="panel-time num">{s.time}</span>
                <div><b>{s.h}</b><p>{s.p}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <OneKnightPlayground dict={dict} cta={<a className="btn btn-lg" href={register}>{t.cta}</a>} />
      <ModulesSection dict={dict} />

      <section className="section panel-compare" aria-labelledby="compare-title">
        <div className="wrap">
          <div className="services-head">
            <p className="eyebrow" data-reveal="up">{t.compare.eyebrow}</p>
            <h2 id="compare-title" className="h2" data-reveal="up">{t.compare.title}</h2>
          </div>
          <div className="compare-table" role="table" aria-labelledby="compare-title" data-reveal="up">
            <div role="row" className="compare-head">
              <span role="columnheader" />
              <span role="columnheader">{t.compare.before}</span>
              <span role="columnheader">{t.compare.after}</span>
            </div>
            {t.compare.rows.map((r) => (
              <div role="row" key={r.h}>
                <b role="rowheader">{r.h}</b>
                <span role="cell" className="compare-before">{r.a}</span>
                <span role="cell" className="compare-after"><Icon name="check" size={16} />{r.b}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section panel-price" aria-labelledby="price-title">
        <div className="wrap">
          <div className="card panel-price-card" data-reveal="up">
            <div>
              <p className="eyebrow">{t.price.eyebrow}</p>
              <h2 id="price-title" className="h2 num">{fmt(t.price.title, v)}</h2>
            </div>
            <ul>
              {t.price.points.map((p) => <li key={p}><Icon name="check" size={16} />{fmt(p, v)}</li>)}
            </ul>
            <a className="btn btn-lg" href={register}>{t.cta}</a>
          </div>
        </div>
      </section>

      <section className="section panel-content" aria-labelledby="content-title">
        <div className="wrap">
          <div className="services-head">
            <p className="eyebrow" data-reveal="up">{t.content.eyebrow}</p>
            <h2 id="content-title" className="h2" data-reveal="up">{t.content.title}</h2>
            <p className="lead" data-reveal="up">{t.content.lead}</p>
            <p data-reveal="up"><span className="pill pill-demo">{t.content.badge}</span></p>
          </div>
          <ul className="panel-week" data-reveal="up">
            {t.content.week.map((x) => (
              <li key={x.day}><span className="num">{x.day}</span><span className="pill">{x.ch}</span><span>{x.t}</span></li>
            ))}
          </ul>
        </div>
      </section>

      <FaqSection dict={dict} lang={lang} page="panel" />

      <section className="section panel-final scheme-dark" aria-labelledby="panel-final-title">
        <div className="wrap">
          <h2 id="panel-final-title" className="h2">{t.final.title}</h2>
          <p className="lead">{t.final.lead}</p>
          {actions}
        </div>
      </section>
    </>
  );
}
