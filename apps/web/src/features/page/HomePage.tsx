import type { Lang } from "@/config";
import { getDict } from "@/i18n";
import { homeJsonLd } from "@/lib/jsonld";
import { HeroScene } from "@/features/hero/HeroScene";
import { ChaosScene } from "@/features/chaos/ChaosScene";
import { FunnelSection } from "@/features/funnel/FunnelSection";
import { ServicesSection } from "@/features/services/ServicesSection";
import { PricingSection } from "@/features/pricing/PricingSection";
import { NotTemplate } from "@/features/template/NotTemplate";
import { CaseStudy } from "@/features/case/CaseStudy";
import { ModulesSection, OneKnightIntro, OneKnightPlayground } from "@/features/oneknight/OneKnightSections";
import { OfferSection } from "@/features/offer/OfferSection";
import { TrustSection } from "@/features/trust/TrustSection";
import { ProcessTimeline } from "@/features/process/ProcessTimeline";
import { SupportSection } from "@/features/support/SupportSection";
import { AboutSection } from "@/features/about/AboutSection";
import { FinalSection } from "@/features/cta/FinalSection";
import { FaqSection } from "@/features/faq/FaqSection";

export function HomePage({ lang }: { lang: Lang }) {
  const dict = getDict(lang);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(homeJsonLd(lang)).replace(/</g, "\\u003c") }} />
      <HeroScene dict={dict} />
      <ChaosScene />
      <FunnelSection dict={dict} />
      <ServicesSection dict={dict} />
      <PricingSection dict={dict} />
      <NotTemplate dict={dict} />
      <CaseStudy dict={dict} lang={lang} />
      <OneKnightIntro dict={dict} lang={lang} />
      <OneKnightPlayground dict={dict} />
      <ModulesSection dict={dict} />
      <OfferSection dict={dict} lang={lang} />
      <TrustSection dict={dict} />
      <ProcessTimeline dict={dict} />
      <SupportSection dict={dict} lang={lang} />
      <AboutSection dict={dict} lang={lang} />
      <FaqSection dict={dict} lang={lang} />
      <FinalSection dict={dict} />
    </>
  );
}
