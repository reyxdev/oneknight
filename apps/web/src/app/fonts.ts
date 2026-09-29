import { Geologica, JetBrains_Mono } from "next/font/google";

/** Geologica: Cyrillic, variable weight + true oblique (slnt). One family for display, UI and body. */
export const geologica = Geologica({
  subsets: ["latin", "cyrillic"],
  axes: ["slnt"],
  display: "swap",
  variable: "--font-geologica",
});

/** Labels and dashboard numerals only. Not preloaded. */
export const jetbrains = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  display: "swap",
  variable: "--font-jetbrains",
  preload: false,
});
