import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { config } from "@/config";
import { fmt, getDict } from "@/i18n";
import { ComingSoon } from "@/features/soon/ComingSoon";
import { WorkPage } from "@/features/portfolio/PortfolioHome";
import { PreviewGate } from "@/features/portfolio/PreviewGate";

const lang = "en" as const;
const soon = config.siteMode === "soon";
const items = getDict(lang).pf.works.items;
export const dynamicParams = false;

export function generateStaticParams() {
  return items.map((w) => ({ id: w.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const w = items.find((x) => x.id === id);
  if (!w) return {};
  if (soon) return { title: getDict(lang).soon.meta.title, robots: { index: false, follow: false } };
  return { title: fmt(getDict(lang).pf.pages.work.title, { host: w.host }), description: w.what, alternates: { canonical: `/en/roboty/${id}/`, languages: { uk: `/roboty/${id}/`, en: `/en/roboty/${id}/` } } };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!items.some((x) => x.id === id)) notFound();
  return soon ? (
    <PreviewGate soon={<ComingSoon lang={lang} />}>
      <WorkPage lang={lang} id={id} />
    </PreviewGate>
  ) : (
    <WorkPage lang={lang} id={id} />
  );
}
