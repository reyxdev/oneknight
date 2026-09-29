export type NavItem = { id: "services" | "work" | "oneknight" | "about" | "contacts"; href: string };

/** Order follows the spec. The product item points at the ONEKNIGHT section. */
export const navItems: NavItem[] = [
  { id: "services", href: "#services" },
  { id: "work", href: "#work" },
  { id: "oneknight", href: "#oneknight" },
  { id: "about", href: "#about" },
  { id: "contacts", href: "#contacts" },
];
