import type { Metadata } from "next";
import { config, type Lang } from "@/config";
import { getDict } from "@/i18n";

export const abs = (path: string) => new URL(path, config.siteUrl).toString();

/** Site-wide metadata. Per-page overrides (canonical, legal titles) are set in each page. */
export function siteMetadata(lang: Lang): Metadata {
  const dict = getDict(lang);
  return {
    metadataBase: new URL(config.siteUrl),
    title: dict.meta.title,
    description: dict.meta.description,
    applicationName: "ONEKNIGHT",
    alternates: {
      canonical: lang === "uk" ? "/" : "/en/",
      languages: { uk: "/", en: "/en/", "x-default": "/" },
    },
    openGraph: {
      type: "website",
      siteName: "ONEKNIGHT",
      title: dict.meta.title,
      description: dict.meta.description,
      locale: dict.meta.locale,
      alternateLocale: [getDict(lang === "uk" ? "en" : "uk").meta.locale],
      url: lang === "uk" ? "/" : "/en/",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "ONEKNIGHT" }],
    },
    twitter: { card: "summary_large_image", title: dict.meta.title, description: dict.meta.description, images: ["/og.png"] },
    robots: { index: true, follow: true },
  };
}
