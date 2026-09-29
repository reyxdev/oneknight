import type { Lang } from "@/config";
import { config } from "@/config";
import { getDict } from "@/i18n";
import { contacts } from "@/data/contacts";
import { websiteTypes } from "@/data/pricing";
import { aboutContent } from "@/content/about";

/** Structured data built only from supplied facts: contacts, public prices, services. */
export function homeJsonLd(lang: Lang) {
  const d = getDict(lang);
  const url = lang === "uk" ? `${config.siteUrl}/` : `${config.siteUrl}/en/`;
  const person = {
    "@type": "Person",
    "@id": `${config.siteUrl}/#ivan`,
    name: aboutContent.fullName[lang] ?? d.about.first,
    jobTitle: d.about.text,
    knowsAbout: d.about.skills,
    sameAs: [contacts.telegram.url, contacts.facebook.url],
  };
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${config.siteUrl}/#website`,
        url,
        name: "ONEKNIGHT",
        inLanguage: lang === "uk" ? "uk-UA" : "en",
        description: d.meta.description,
      },
      {
        "@type": "ProfessionalService",
        "@id": `${config.siteUrl}/#business`,
        name: "ONEKNIGHT",
        url,
        description: d.meta.description,
        telephone: contacts.phone.e164,
        areaServed: { "@type": "Country", name: "Ukraine" },
        sameAs: [contacts.telegram.url, contacts.facebook.url],
        founder: { "@id": `${config.siteUrl}/#ivan` },
        hasOfferCatalog: {
          "@type": "OfferCatalog",
          name: d.pricing.title,
          itemListElement: websiteTypes.map((t) => ({
            "@type": "Offer",
            itemOffered: { "@type": "Service", name: d.siteTypes[t.id], description: d.pricing.types[t.id].for },
            priceSpecification: { "@type": "PriceSpecification", minPrice: t.from, priceCurrency: "UAH" },
          })),
        },
      },
      person,
    ],
  };
}
