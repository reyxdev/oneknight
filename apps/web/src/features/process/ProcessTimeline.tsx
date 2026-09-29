import type { Dict } from "@/i18n";
import { Icon, type IconName } from "@/components/ui/Icon";

const ICONS: IconName[] = ["chat", "person", "table", "layers", "bolt", "search", "globe", "shield", "refresh"];

/** Desktop: sticky horizontal scene driven by --p. Mobile: vertical timeline (same markup). */
export function ProcessTimeline({ dict }: { dict: Dict }) {
  const t = dict.process;
  const n = t.steps.length;
  return (
    <section id="process" data-chapter data-scene data-stops="0.08,0.3,0.55,0.8,1" className="proc" aria-labelledby="proc-title" style={{ ["--n" as string]: n }}>
      <div className="stage proc-stage">
        <div className="wrap proc-head">
          <p className="eyebrow">{t.eyebrow}</p>
          <h2 id="proc-title" className="h2">{t.title}</h2>
          <p className="lead">{t.lead}</p>
        </div>
        <div className="proc-rail" aria-hidden="true"><i /></div>
        <ol className="proc-track">
          {t.steps.map((s, i) => (
            <li key={s.t} className="proc-step" style={{ ["--i" as string]: i }}>
              <span className="proc-num num">{String(i + 1).padStart(2, "0")}</span>
              <span className="proc-ic"><Icon name={ICONS[i]!} size={26} /></span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
              <span className="proc-vis" aria-hidden="true" data-k={i} />
            </li>
          ))}
        </ol>
        <p className="proc-hint small" aria-hidden="true">{t.hint}</p>
      </div>
    </section>
  );
}
