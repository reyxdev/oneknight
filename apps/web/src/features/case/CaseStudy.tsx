import type { Dict } from "@/i18n";
import type { Lang } from "@/config";
import { karpatu } from "@/content/karpatu";
import { WebsitePreview } from "./WebsitePreview";
import { CaseLayers } from "./CaseLayers";
import { Testimonial } from "./Testimonial";
import { Icon } from "@/components/ui/Icon";

export function CaseStudy({ dict, lang }: { dict: Dict; lang: Lang }) {
  const t = dict.karpatu;
  return (
    <section id="work" data-chapter className="case" aria-labelledby="case-title">
      <div data-scene data-stops="0,0.5,1" className="case-intro">
        <div className="stage case-stage">
          <p className="eyebrow case-eyebrow">{t.eyebrow} 01</p>
          <h2 id="case-title" className="case-title display" aria-label="Karpatu.shop">
            {karpatu.domain.split("").map((c, i) => (
              <span key={i} aria-hidden="true" style={{ ["--i" as string]: i }}>{c}</span>
            ))}
          </h2>
          <p className="case-lead">{t.intro}</p>
        </div>
      </div>

      <div className="wrap case-body">
        <ul className="case-tags" data-reveal="up">
          {t.tags.map((x) => (
            <li key={x} className="pill">{x}</li>
          ))}
        </ul>
        <div data-reveal="up"><WebsitePreview /></div>
        <div data-reveal="up"><CaseLayers /></div>
        <div className="case-grid">
          <Testimonial dict={dict} lang={lang} />
          <div className="card case-results" data-reveal="up">
            <h3 className="h3">{t.results.title}</h3>
            {karpatu.metrics.length ? (
              <dl>
                {karpatu.metrics.map((m) => (
                  <div key={m.value}><dt>{m.label[lang]}</dt><dd className="num">{m.value}</dd></div>
                ))}
              </dl>
            ) : (
              <p className="small">{t.results.pending}</p>
            )}
          </div>
        </div>
        <p className="case-real" data-reveal="up">
          <span>{t.real}</span>
          <a href={karpatu.url} target="_blank" rel="noopener" className="btn btn-lg" data-cursor="view" data-cursor-label="VIEW">
            karpatu.shop <Icon name="arrow" size={18} />
          </a>
        </p>
      </div>
    </section>
  );
}
