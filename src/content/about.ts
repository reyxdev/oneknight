/** Owner-provided profile data. Null until provided (see TODO.md). Never generate a face or a name. */
export const aboutContent = {
  fullName: { uk: null as string | null, en: null as string | null },
  portrait: null as { src: string; width: number; height: number } | null,
} as const;
