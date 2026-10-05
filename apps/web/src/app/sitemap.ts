import type { MetadataRoute } from "next";
import { abs } from "@/lib/seo";
import { config } from "@/config";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  // Nothing to index while the «скоро» page stands (answer 354).
  if (config.siteMode === "soon") return [];
  if (config.siteMode === "portfolio") {
    // The portfolio pages (uk + en); computer help is Ukrainian only.
    const both = ["/", "/cina/", "/roboty/", "/roboty/karpatu/", "/roboty/vivcharuk/", "/sait-dlya-magazynu/", "/internet-magazyn/", "/google-karty/", "/reklama/", "/poshuk-google/"];
    return [
      ...both.flatMap((p) => {
        const languages = { uk: abs(p), en: abs(`/en${p}`) };
        return [{ url: abs(p), alternates: { languages } }, { url: abs(`/en${p}`), alternates: { languages } }];
      }),
      { url: abs("/tekhnika/") },
    ];
  }
  return [
    { url: abs("/"), alternates: { languages: { uk: abs("/"), en: abs("/en/") } } },
    { url: abs("/en/"), alternates: { languages: { uk: abs("/"), en: abs("/en/") } } },
    { url: abs("/panel/"), alternates: { languages: { uk: abs("/panel/"), en: abs("/en/panel/") } } },
    { url: abs("/en/panel/"), alternates: { languages: { uk: abs("/panel/"), en: abs("/en/panel/") } } },
    { url: abs("/cases/"), alternates: { languages: { uk: abs("/cases/"), en: abs("/en/cases/") } } },
    { url: abs("/en/cases/"), alternates: { languages: { uk: abs("/cases/"), en: abs("/en/cases/") } } },
    { url: abs("/status/"), alternates: { languages: { uk: abs("/status/"), en: abs("/en/status/") } } },
    { url: abs("/en/status/"), alternates: { languages: { uk: abs("/status/"), en: abs("/en/status/") } } },
    { url: abs("/docs/api/"), alternates: { languages: { uk: abs("/docs/api/"), en: abs("/en/docs/api/") } } },
    { url: abs("/en/docs/api/"), alternates: { languages: { uk: abs("/docs/api/"), en: abs("/en/docs/api/") } } },
  ];
}
