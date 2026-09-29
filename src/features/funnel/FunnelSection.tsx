import type { Dict } from "@/i18n";
import { Funnel } from "./Funnel";
import { Icon } from "@/components/ui/Icon";

export function FunnelSection({ dict }: { dict: Dict }) {
  const f = dict.funnel;
  return (
    <section id="funnel" data-chapter className="section funnel-section" aria-labelledby="funnel-title">
      <div className="wrap">
        <div className="funnel-head">
          <p className="eyebrow" data-reveal="up">{f.eyebrow}</p>
          <h2 id="funnel-title" className="h2" data-reveal="up" style={{ ["--i" as string]: 1 }}>{f.title}</h2>
          <p className="lead" data-reveal="up" style={{ ["--i" as string]: 2 }}>{f.lead}</p>
          <p data-reveal="up" style={{ ["--i" as string]: 3 }}><span className="pill pill-demo">{f.demo}</span></p>
        </div>
        <Funnel />
        <p className="funnel-next" data-reveal="up">
          <a href="#services" className="btn btn-secondary" data-cursor="link">{f.next}<Icon name="arrow" size={18} /></a>
        </p>
      </div>
    </section>
  );
}
