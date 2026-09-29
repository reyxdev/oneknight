import type { Dict } from "@/i18n";
import { ServiceDemo, type ServiceId } from "./ServiceDemo";

const TONE: Record<ServiceId, "light" | "soft" | "dark"> = { websites: "light", automation: "soft", analytics: "dark", advertising: "soft", seo: "light" };

export function ServicesSection({ dict }: { dict: Dict }) {
  const s = dict.services;
  return (
    <section id="services" data-chapter className="section services" aria-labelledby="services-title">
      <div className="wrap">
        <div className="services-head">
          <p className="eyebrow" data-reveal="up">{s.eyebrow}</p>
          <h2 id="services-title" className="h2" data-reveal="up" style={{ ["--i" as string]: 1 }}>{s.title}</h2>
          <p className="lead" data-reveal="up" style={{ ["--i" as string]: 2 }}>{s.lead}</p>
        </div>
        <div className="svc-stack">
          {s.cards.map((c, i) => {
            const id = c.id as ServiceId;
            const tone = TONE[id];
            return (
              <article key={c.id} className={`svc-card ${tone === "dark" ? "scheme-dark" : ""}`} data-tone={tone} style={{ ["--n" as string]: i }} aria-labelledby={`svc-${c.id}`}>
                <div className="svc-copy">
                  <span className="svc-num num">{String(i + 1).padStart(2, "0")}</span>
                  <h3 id={`svc-${c.id}`} className="h2 svc-title">{c.title}</h3>
                  <p className="lead svc-text">{c.text}</p>
                  <ul className="svc-points">
                    {c.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                  <p className="svc-hint"><span className="pill">{s.tryIt}</span> {c.hint}</p>
                </div>
                <div className="svc-demo">
                  <ServiceDemo id={id} />
                  {id !== "websites" && <p className="svc-note">{s.demoNote}</p>}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
