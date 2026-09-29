import type { SVGProps } from "react";

const paths = {
  chat: "M4 5h16v11H9l-5 4V5z",
  send: "M21 4L3 11l7 3 3 7 8-17z",
  cart: "M3 4h3l2 11h10l2-8H7M9 20a1 1 0 100-2 1 1 0 000 2zM17 20a1 1 0 100-2 1 1 0 000 2z",
  table: "M3 5h18v14H3V5zM3 10h18M3 15h18M9 5v14M15 5v14",
  megaphone: "M4 10v4h3l7 4V6L7 10H4zM17 9a4 4 0 010 6",
  doc: "M6 3h9l4 4v14H6V3zM14 3v5h5M9 13h7M9 17h7",
  person: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 3.5-6 8-6s8 2 8 6",
  box: "M3 7l9-4 9 4v10l-9 4-9-4V7zM3 7l9 4 9-4M12 11v10",
  bell: "M6 16V11a6 6 0 1112 0v5l2 2H4l2-2zM10 21h4",
  chart: "M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z",
  arrow: "M5 12h14M13 6l6 6-6 6",
  check: "M4 12.5l5 5L20 6.5",
  globe: "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7l1-8z",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM8.5 12l2.5 2.5 4.5-5",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
  puzzle: "M10 4a2 2 0 114 0v2h4v4h-2a2 2 0 100 4h2v4h-4v-2a2 2 0 10-4 0v2H6v-4h2a2 2 0 100-4H6V6h4V4z",
  home: "M4 11l8-7 8 7v9h-5v-6H9v6H4v-9z",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 00-2-1.2L14.2 3h-4.4l-.4 2.7a7 7 0 00-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1c.6.5 1.3.9 2 1.2l.4 2.7h4.4l.4-2.7c.7-.3 1.4-.7 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z",
  plus: "M12 5v14M5 12h14",
  close: "M5 5l14 14M19 5L5 19",
  play: "M7 4l13 8-13 8V4z",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  image: "M4 5h16v14H4V5zM4 16l5-5 4 4 3-3 4 4M9 9.5a1 1 0 100-2 1 1 0 000 2z",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z",
  card: "M3 6h18v12H3V6zM3 10h18M7 15h4",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  lock: "M6 11h12v9H6v-9zM8 11V8a4 4 0 118 0v3",
  refresh: "M20 11a8 8 0 00-14-4L4 9M4 5v4h4M4 13a8 8 0 0014 4l2-2M20 19v-4h-4",
  filter: "M4 5h16l-6 8v6l-4-2v-4L4 5z",
  truck: "M2 6h12v10H2V6zM14 10h4l3 3v3h-7v-6zM6 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z",
  cursor: "M5 3l14 7-6 2-2 6L5 3z",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, className, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} {...rest}>
      <path d={paths[name]} />
    </svg>
  );
}
