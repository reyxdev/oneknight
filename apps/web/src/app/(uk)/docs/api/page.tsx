import type { Metadata } from "next";
import { getDict } from "@/i18n";
import { DocsPage } from "@/features/page/DocsPage";

const t = getDict("uk").docsPage.meta;
export const metadata: Metadata = { title: t.title, description: t.description, alternates: { canonical: "/docs/api/", languages: { uk: "/docs/api/", en: "/en/docs/api/" } } };

export default function Page() {
  return <DocsPage lang="uk" />;
}
