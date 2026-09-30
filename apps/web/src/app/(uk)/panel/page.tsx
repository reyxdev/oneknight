import type { Metadata } from "next";
import { getDict } from "@/i18n";
import { PanelPage } from "@/features/page/PanelPage";

const t = getDict("uk").panelPage.meta;
export const metadata: Metadata = {
  title: t.title,
  description: t.description,
  alternates: { canonical: "/panel/", languages: { uk: "/panel/", en: "/en/panel/" } },
  openGraph: { title: t.title, description: t.description, url: "/panel/" },
};

export default function Page() {
  return <PanelPage lang="uk" />;
}
