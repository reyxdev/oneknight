export type NavItem = { id: "services" | "work" | "oneknight" | "about" | "contacts"; href: string };

/** Order follows the spec. The product item leads to the ONEKNIGHT page (/panel). */
export const navItems: NavItem[] = [
  { id: "services", href: "#services" },
  { id: "work", href: "#work" },
  { id: "oneknight", href: "/panel/" },
  { id: "about", href: "#about" },
  { id: "contacts", href: "#contacts" },
];
