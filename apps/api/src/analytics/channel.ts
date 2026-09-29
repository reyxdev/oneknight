/** Turns utm_source / referrer into a channel a business owner recognises. */
const ALIASES: [RegExp, string][] = [
  [/^(ig|insta|instagram)$|instagram\./, "instagram"],
  [/^(fb|facebook|meta)$|facebook\.|fb\.com|l\.facebook/, "facebook"],
  [/^(google|adwords|gads)$|google\./, "google"],
  [/^(tg|telegram)$|t\.me|telegram\./, "telegram"],
  [/^(tiktok|tt)$|tiktok\./, "tiktok"],
  [/^(youtube|yt)$|youtube\.|youtu\.be/, "youtube"],
  [/^(viber)$|viber\./, "viber"],
  [/^(email|newsletter|mail)$/, "email"],
  [/bing\.|duckduckgo\.|yahoo\.|ecosia\./, "search"],
];

export function channelOf(utmSource: string | null | undefined, referrer: string | null | undefined, ownHost: string): string {
  const src = utmSource?.trim().toLowerCase();
  if (src) {
    for (const [re, name] of ALIASES) if (re.test(src)) return name;
    return `other:${src.slice(0, 40)}`;
  }
  if (!referrer) return "direct";
  let host = "";
  try {
    host = new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return "direct";
  }
  if (!host || host === ownHost || host.endsWith(`.${ownHost}`)) return "direct";
  for (const [re, name] of ALIASES) if (re.test(host)) return name;
  return `other:${host.slice(0, 60)}`;
}
