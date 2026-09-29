import type { Dict } from "@/i18n";
import { PricingPicker } from "./PricingPicker";

export function PricingSection({ dict }: { dict: Dict }) {
  const p = dict.pricing;
  return (
    <section id="pricing" data-chapter className="section pricing-section" aria-labelledby="pricing-title">
      <div className="wrap">
        <div className="services-head">
          <p className="eyebrow" data-reveal="up">{p.eyebrow}</p>
          <h2 id="pricing-title" className="h2" data-reveal="up" style={{ ["--i" as string]: 1 }}>{p.title}</h2>
          <p className="lead" data-reveal="up" style={{ ["--i" as string]: 2 }}>{p.lead}</p>
        </div>
        <PricingPicker />
      </div>
    </section>
  );
}
