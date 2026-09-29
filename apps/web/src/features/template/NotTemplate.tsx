import type { Dict } from "@/i18n";
import { Icon } from "@/components/ui/Icon";
import { KnightMark } from "@/components/global/Logo";

/** Wireframe used on both sides, so the difference is what gets added, not a different drawing. */
function Wire({ buy }: { buy?: string }) {
  return (
    <div className="wire">
      <i className="wire-head" />
      <i className="wire-hero" />
      <div className="wire-cards">
        {[0, 1, 2].map((n) => (
          <i key={n} className="wire-card">{buy && <em className="sys-buy">{buy}</em>}</i>
        ))}
      </div>
      <i className="wire-foot" />
    </div>
  );
}

export function NotTemplate({ dict }: { dict: Dict }) {
  const t = dict.template;
  return (
    <section id="template" data-chapter data-scene data-stops="0.02,0.185,0.375,0.565,0.755,0.85,0.97" className="tpl scheme-dark" aria-labelledby="tpl-title">
      <div className="stage tpl-stage">
        <div className="wrap tpl-wrap">
          <h2 id="tpl-title" className="h2 tpl-title">{t.title}</h2>
          <div className="tpl-grid">
            <figure className="tpl-col tpl-old">
              <span className="tpl-tag">{t.tagOld}</span>
              <div className="tpl-frame" aria-hidden="true">
                <div className="tpl-chrome"><i /><i /><i /></div>
                <Wire />
              </div>
              <figcaption>
                <ol className="tpl-caps">
                  {t.layers.map((l, i) => (
                    <li key={l.name} style={{ ["--c" as string]: `var(--c${i + 1})` }}><small>{String(i + 1).padStart(2, "0")}</small>{l.old}</li>
                  ))}
                </ol>
              </figcaption>
            </figure>

            <figure className="tpl-col tpl-new">
              <span className="tpl-tag tpl-tag-new">{t.tagNew}</span>
              <div className="tpl-frame tpl-sys" aria-hidden="true">
                <div className="tpl-chrome"><i /><i /><i /></div>
                <Wire buy={t.chips.buy} />
                <span className="sys-cart"><Icon name="cart" size={16} /><b>2</b></span>
                <div className="sys-phone"><i /><i /><i /></div>
                <span className="sys-chip sys-seo"><Icon name="search" size={14} />{t.chips.search}</span>
                <div className="sys-chart"><i /><i /><i /><i /><i /></div>
                <span className="sys-chip sys-ads"><Icon name="megaphone" size={14} />{t.chips.ads}</span>
                <div className="sys-ok"><KnightMark size={22} /><span>{t.chips.oneknight}</span></div>
                {t.chips.services.map((s, i) => (
                  <span key={s} className={`sys-chip sys-int sys-int-${i}`}><Icon name="link" size={13} />{s}</span>
                ))}
              </div>
              <figcaption>
                <ol className="tpl-caps">
                  {t.layers.map((l, i) => (
                    <li key={l.name} style={{ ["--c" as string]: `var(--c${i + 1})` }}><small>{String(i + 1).padStart(2, "0")}</small>{l.sys}</li>
                  ))}
                </ol>
              </figcaption>
            </figure>
          </div>
          <p className="tpl-final">{t.final}</p>
          <div className="tpl-ticks" aria-hidden="true">
            {t.layers.map((l, i) => (
              <i key={l.name} style={{ ["--k" as string]: `var(--k${i + 1})` }} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
