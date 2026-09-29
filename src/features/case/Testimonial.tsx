import type { Dict } from "@/i18n";
import type { Lang } from "@/config";
import { karpatu } from "@/content/karpatu";
import { Icon } from "@/components/ui/Icon";

/** Renders only what the owner actually provided. Nothing is filled in for them. */
export function Testimonial({ dict, lang }: { dict: Dict; lang: Lang }) {
  const t = dict.karpatu.testimonial;
  const o = karpatu.owner;
  return (
    <figure className="card case-quote" data-reveal="up">
      <h3 className="h3">{t.title}</h3>
      {o.testimonial ? (
        <>
          {o.rating !== null && (
            <p className="case-stars" aria-label={`${o.rating} / 5`}>
              {Array.from({ length: 5 }, (_, i) => (
                <Icon key={i} name="star" size={18} style={{ fill: i < o.rating! ? "currentColor" : "none" }} />
              ))}
            </p>
          )}
          <blockquote>{o.testimonial[lang]}</blockquote>
          <figcaption>
            {o.photo && <img src={o.photo} alt="" width={48} height={48} loading="lazy" />}
            <b>{o.name}</b>
          </figcaption>
          {o.video && (
            <video controls preload="none" src={o.video} aria-label={t.video} />
          )}
        </>
      ) : (
        <p className="small case-pending">
          <Icon name="clock" size={18} />
          {t.pending}
        </p>
      )}
    </figure>
  );
}
