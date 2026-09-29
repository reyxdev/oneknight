import type { Dict } from "@/i18n";
import { OrderButton } from "./OrderButton";
import { FinalChoices } from "./FinalCTA";

export function FinalSection({ dict }: { dict: Dict }) {
  const t = dict.final;
  return (
    <section id="start" className="section final scheme-dark" aria-labelledby="final-title">
      <div className="wrap final-wrap">
        <h2 id="final-title" className="final-title" data-reveal="up">{t.title}</h2>
        <div data-reveal="up"><OrderButton className="btn btn-lg final-cta">{t.cta}</OrderButton></div>
        <p className="final-how" data-reveal="up">{t.how}</p>
        <div data-reveal="up"><FinalChoices /></div>
      </div>
    </section>
  );
}
