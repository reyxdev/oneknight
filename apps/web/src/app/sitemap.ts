import type { MetadataRoute } from "next";
import { abs } from "@/lib/seo";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: abs("/"), alternates: { languages: { uk: abs("/"), en: abs("/en/") } } },
    { url: abs("/en/"), alternates: { languages: { uk: abs("/"), en: abs("/en/") } } },
    { url: abs("/panel/"), alternates: { languages: { uk: abs("/panel/"), en: abs("/en/panel/") } } },
    { url: abs("/en/panel/"), alternates: { languages: { uk: abs("/panel/"), en: abs("/en/panel/") } } },
  ];
}
