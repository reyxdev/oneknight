import type { Dict } from "@/i18n";
import { Icon, type IconName } from "@/components/ui/Icon";

const ICON: Record<string, IconName> = { work: "globe", client: "person", product: "shield" };

export function TrustSection({ dict }: { dict: Dict }) {
  const t = dict.trust;
  return (
    <section id="trust" data-chapter className="section trust" aria-labelledby="trust-title">
      <div className="wrap">
        <p className="eyebrow" data-reveal="up">{t.eyebrow}</p>
        <h2 id="trust-title" className="h2" data-reveal="up">{t.title}</h2>
        <ol className="trust-list">
          {t.items.map((x, i) => (
            <li key={x.k} className="trust-item" data-reveal="up" style={{ ["--i" as string]: i }}>
              <span className="trust-n num">0{i + 1}</span>
              <span className="trust-ic"><Icon name={ICON[x.k]!} size={22} /></span>
              <h3 className="h3">{x.t}</h3>
              <p className="small">{x.d}</p>
              <a href={x.href} className="trust-link">{x.cta}<Icon name="arrow" size={16} /></a>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
