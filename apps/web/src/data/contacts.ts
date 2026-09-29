/** Only the contact channels supplied by the owner. Do not add others. */
export const contacts = {
  telegram: { handle: "poulpefounder", url: "https://t.me/poulpefounder" },
  // The supplied number is listed as Viber / WhatsApp. The call button dials the same number. TODO: confirm it accepts voice calls.
  phone: { display: "+380 68 358 75 59", e164: "+380683587559", tel: "tel:+380683587559" },
  whatsapp: { url: "https://wa.me/380683587559" },
  viber: { url: "viber://chat?number=%2B380683587559" },
  facebook: { url: "https://www.facebook.com/profile.php?id=61592465315317" },
} as const;

/** Builds a prefilled hand-off link. Used by the brief flow: nothing is "sent" by the site itself. */
export function messengerLink(kind: "telegram" | "whatsapp", text: string): string {
  const q = encodeURIComponent(text);
  return kind === "telegram" ? `${contacts.telegram.url}?text=${q}` : `${contacts.whatsapp.url}?text=${q}`;
}
