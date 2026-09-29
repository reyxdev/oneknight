import type { Dict } from "@/i18n";
import type { Lang } from "@/config";
import { aboutContent } from "@/content/about";
import { contacts } from "@/data/contacts";
import { KnightMark } from "@/components/global/Logo";
import { Icon } from "@/components/ui/Icon";

export function AboutSection({ dict, lang }: { dict: Dict; lang: Lang }) {
  const t = dict.about;
  const name = aboutContent.fullName[lang] ?? t.first;
  const p = aboutContent.portrait;
  return (
    <section id="about" data-chapter data-scene="pass" className="section about" aria-labelledby="about-title">
      <div className="wrap about-grid">
        <figure className="about-photo" data-reveal="scale">
          {p ? (
            <img src={p.src} width={p.width} height={p.height} alt={name} loading="lazy" decoding="async" />
          ) : (
            <div className="about-ph" role="img" aria-label={t.photoPending}>
              <KnightMark size={88} />
              <span>{t.photoPending}</span>
            </div>
          )}
        </figure>
        <div className="about-copy">
          <p className="eyebrow" data-reveal="up">{t.eyebrow}</p>
          <h2 id="about-title" className="about-name" data-reveal="up">
            {name}
            <span className="about-age"><b className="num">{t.age}</b><small>{t.ageLabel}</small></span>
          </h2>
          <p className="about-text" data-reveal="up">{t.text}</p>
          <ul className="about-skills" data-reveal="up">
            {t.skills.map((s) => (
              <li key={s} className="pill">{s}</li>
            ))}
          </ul>
          <a className="btn btn-secondary" href={contacts.telegram.url} target="_blank" rel="noopener" data-reveal="up">
            <Icon name="send" size={16} />{t.write}
          </a>
        </div>
      </div>
    </section>
  );
}
