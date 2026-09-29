/**
 * Karpatu.shop case. Every technical fact below was checked on the live site (headers, HTML, robots.txt,
 * llms.txt, sitemap.xml) on `verifiedOn`. Owner data and results stay null until the owner provides them.
 * Never fill these with invented values.
 */
export const karpatu = {
  url: "https://karpatu.shop",
  domain: "KARPATU.SHOP",
  brand: "Промисли Карпат",
  verifiedOn: "2026-09-29",
  facts: {
    languages: 5,
    catalogVariants: 41,
    sitemapUrls: 148,
    structuredData: ["Organization", "Manufacturer", "WebSite", "OfferCatalog", "FAQPage", "MerchantReturnPolicy"],
  },
  owner: {
    name: null as string | null,
    photo: null as string | null,
    rating: null as number | null,
    testimonial: null as { uk: string; en: string } | null,
    video: null as string | null,
  },
  /** Verified metrics only. Empty until real, shareable numbers are provided. */
  metrics: [] as { label: { uk: string; en: string }; value: string }[],
  shots: {
    desktop: ["home", "catalog", "material", "products", "ornament", "process"],
    mobile: ["home", "catalog", "filters", "material", "products", "ornament", "process"],
  },
} as const;
