import type { ReactNode } from "react";
import type { Lang } from "@/config";
import { getDict } from "@/i18n";
import { I18nProvider } from "@/i18n/provider";
import { geologica, jetbrains } from "@/app/fonts";
import { bootScript } from "@/lib/prefs";
import { ToastProvider } from "@/components/ui/Toast";
import { ModalProvider } from "./ModalProvider";
import { PrefsInit } from "./PrefsInit";

/** Root layout for the ONEKNIGHT account (/app): no marketing header, footer, cursor or guided scroll. */
export function AppShell({ lang, children }: { lang: Lang; children: ReactNode }) {
  const dict = getDict(lang);
  return (
    <html lang={lang} suppressHydrationWarning className={`${geologica.variable} ${jetbrains.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body className="app-body">
        <I18nProvider lang={lang} dict={dict}>
          <ToastProvider>
            <ModalProvider>
              {children}
              <PrefsInit />
            </ModalProvider>
          </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
