import type { ReactNode } from "react";
import type { Lang } from "@/config";
import { getDict } from "@/i18n";
import { I18nProvider } from "@/i18n/provider";
import { geologica, jetbrains } from "@/app/fonts";
import { bootScript } from "@/lib/prefs";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { Cursor } from "./Cursor";
import { ScrollProgress, type ChapterId } from "./ScrollProgress";
import { ModalProvider } from "./ModalProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { MotionRuntime } from "@/components/motion/MotionRuntime";
import { ReducedMotionHint } from "./ReducedMotionHint";

export function RootShell({ lang, chapters, children }: { lang: Lang; chapters: readonly ChapterId[]; children: ReactNode }) {
  const dict = getDict(lang);
  return (
    <html lang={lang} suppressHydrationWarning className={`${geologica.variable} ${jetbrains.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body>
        <I18nProvider lang={lang} dict={dict}>
          <ToastProvider>
            <ModalProvider>
              <a href="#main" className="skip-link">{dict.a11y.skip}</a>
              <ScrollProgress dict={dict} present={chapters} />
              <Header />
              <main id="main">{children}</main>
              <Footer lang={lang} dict={dict} />
              <Cursor />
              <MotionRuntime />
              <ReducedMotionHint />
            </ModalProvider>
          </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
