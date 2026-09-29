import type { Dict } from "@/i18n";
import { OrderButton } from "@/features/cta/OrderButton";
import { LiquidWord } from "./LiquidWord";

const PARTS = ["ONE", "KNIGHT"] as const;

/**
 * Sticky scene. --p (0..1) is written by the motion runtime while scrolling:
 * the word scales and dissolves, the copy lifts away, the page turns dark for the chaos scene.
 */
export function HeroScene({ dict }: { dict: Dict }) {
  return (
    <section id="hero" data-chapter data-scene data-stops="0" className="hero" aria-labelledby="hero-h1">
      <div className="stage hero-stage">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-dark" aria-hidden="true" />
        <div className="wrap hero-grid">
          <ul className="hero-tags" aria-label="ONEKNIGHT">
            {dict.hero.tags.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <div className="hero-word">
            <LiquidWord parts={PARTS} />
          </div>
          <div className="hero-copy">
            <h1 id="hero-h1" className="hero-h1">{dict.hero.h1}</h1>
            <div className="hero-actions">
              <OrderButton className="btn btn-lg">{dict.hero.cta}</OrderButton>
              <a href="#oneknight" className="hero-product" data-cursor="link">
                <span className="hero-dot" aria-hidden="true" />
                {dict.hero.product}
              </a>
            </div>
          </div>
        </div>
        <div className="hero-cue" aria-hidden="true">
          <span>{dict.hero.scroll}</span>
          <i />
        </div>
      </div>
    </section>
  );
}
