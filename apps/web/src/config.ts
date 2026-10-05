/** Feature flags and tunables. Nothing secret lives here (this file ships to the browser). */
export const config = {
  siteUrl: "https://oneknight.pro",
  sound: { defaultEnabled: false },
  motion: { defaultMode: "full" as "full" | "calm" },
  subscription: { graceDaysMin: 3, graceDaysMax: 7, graceDaysDefault: 5 },
  reviews: { trashRetentionDays: 30 },
  /**
   * «soon»: the public site shows only the «скоро» page while the new portfolio is built (owner's decision 348);
   * the panel itself is closed to everyone but the admin (API: PANEL_CLOSED); a signed-in admin sees the new portfolio.
   * «portfolio»: the new portfolio is the public site (indexed); the old ONEKNIGHT pages stay hidden.
   * «full»: the old ONEKNIGHT site.
   */
  siteMode: "soon" as "soon" | "portfolio" | "full",
} as const;

export type Lang = "uk" | "en";
export const langs: Lang[] = ["uk", "en"];
