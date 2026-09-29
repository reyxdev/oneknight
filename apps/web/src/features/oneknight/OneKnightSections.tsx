import dynamic from "next/dynamic";
import type { Dict } from "@/i18n";
import { Icon, type IconName } from "@/components/ui/Icon";
import { KnightMark } from "@/components/global/Logo";
import { PlaygroundMount } from "./PlaygroundMount";
import { OrderButton } from "@/features/cta/OrderButton";

const Marketplace = dynamic(() => import("./Marketplace"));

export function OneKnightIntro({ dict }: { dict: Dict }) {
  const t = dict.ok.intro;
  return (
    <section id="oneknight" data-chapter data-scene data-stops="0,0.28,0.62,1" className="okx scheme-dark" aria-labelledby="okx-title">
      <div className="stage okx-stage">
        <div className="okx-glow" aria-hidden="true" />
        <div className="okx-mark" aria-hidden="true"><KnightMark size={120} /></div>
        <div className="wrap okx-wrap">
          <p className="eyebrow okx-eyebrow">{t.eyebrow}</p>
          <p className="okx-word display" aria-hidden="true">ONEKNIGHT</p>
          <h2 id="okx-title" className="okx-title">{t.title}</h2>
          <p className="lead okx-lead">{t.lead}</p>
          <ul className="okx-points">
            {t.points.map((p, i) => (
              <li key={p.t} style={{ ["--i" as string]: i }}>
                <Icon name={p.icon as IconName} size={20} />
                <b>{p.t}</b>
                <span>{p.d}</span>
              </li>
            ))}
          </ul>
          <a href="#playground" className="btn btn-lg okx-cta" data-cursor="link">{t.cta}<Icon name="arrow" size={18} /></a>
        </div>
      </div>
    </section>
  );
}

export function OneKnightPlayground({ dict }: { dict: Dict }) {
  const t = dict.ok;
  return (
    <section id="playground" data-chapter className="section okpg" aria-labelledby="okpg-title">
      <div className="wrap">
        <div className="services-head">
          <p className="eyebrow" data-reveal="up">ONEKNIGHT</p>
          <h2 id="okpg-title" className="h2" data-reveal="up" style={{ ["--i" as string]: 1 }}>{t.playgroundTitle}</h2>
          <p className="lead" data-reveal="up" style={{ ["--i" as string]: 2 }}>{t.playgroundLead}</p>
          <p data-reveal="up" style={{ ["--i" as string]: 3 }}><span className="pill pill-demo">{t.demoBadge}</span> <span className="pill">{t.demoLive}</span></p>
        </div>
        <PlaygroundMount />
        <div className="okpg-cta" data-reveal="up">
          <OrderButton authAware={false} className="btn btn-lg">{dict.nav.order}</OrderButton>
        </div>
      </div>
    </section>
  );
}

export function ModulesSection({ dict }: { dict: Dict }) {
  const t = dict.ok.modules;
  return (
    <section id="modules" data-chapter className="section okm" aria-labelledby="okm-title">
      <div className="wrap">
        <div className="services-head">
          <p className="eyebrow" data-reveal="up">{t.title}</p>
          <h2 id="okm-title" className="h2" data-reveal="up" style={{ ["--i" as string]: 1 }}>{dict.okMarket.title}</h2>
          <p className="lead" data-reveal="up" style={{ ["--i" as string]: 2 }}>{dict.okMarket.lead}</p>
        </div>
        <Marketplace />
      </div>
    </section>
  );
}
