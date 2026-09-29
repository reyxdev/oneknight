/** Knight monogram. The brand name is exposed through the accessible name, not repeated as visible text. */
export function KnightMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <path
        d="M11 24.5v-3.2l3.3-3-.2-2.6-3.1 1.1L8.5 14l5.2-6.7c.6-.8 1.5-1.3 2.6-1.3 3.7 0 6.2 3.1 6.2 7.1V24.5H11Z"
        fill="var(--bg)"
      />
      <circle cx="15.6" cy="11.4" r="1.05" fill="currentColor" />
    </svg>
  );
}
