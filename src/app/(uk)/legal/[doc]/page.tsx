import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { legalDocs, type LegalDoc } from "@/data/legal";
import { getDict, withLang } from "@/i18n";
import { LegalPage } from "@/features/page/LegalPage";

const lang = "uk" as const;
export const dynamicParams = false;

export function generateStaticParams() {
  return legalDocs.map((doc) => ({ doc }));
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const { doc } = await params;
  if (!legalDocs.includes(doc as LegalDoc)) return {};
  const dict = getDict(lang);
  const path = withLang(lang, `/legal/${doc}/`);
  return {
    title: `${dict.legal.docs[doc as LegalDoc]} | ONEKNIGHT`,
    robots: { index: false, follow: true },
    alternates: { canonical: path, languages: { uk: `/legal/${doc}/`, en: `/en/legal/${doc}/` } },
  };
}

export default async function Page({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  if (!legalDocs.includes(doc as LegalDoc)) notFound();
  return <LegalPage lang={lang} doc={doc as LegalDoc} />;
}
