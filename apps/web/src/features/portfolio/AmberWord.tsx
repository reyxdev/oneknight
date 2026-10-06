/**
 * ONEKNIGHT as a glass of honey (owner's request, October 2026): the letters are filled with amber from the bottom up
 * to 80%, the top 20% is empty but outlined, so the word stands out from the paper. A slow wave on the surface;
 * «less motion» stops it. Plain SVG: no WebGL, light on weak phones.
 */
export function AmberWord({ text = "ONEKNIGHT" }: { text?: string }) {
  const id = "pf-amber-word";
  const W = 1000;
  const H = 170;
  const base = H * 0.86; // where the letters stand
  const cap = H * 0.72; // the height of the capitals
  const level = base - cap * 0.8; // the honey surface: 80% of the letter height
  // Two periods of a gentle wave, so sliding it by one period loops seamlessly.
  const line = (y: number) => {
    let d = `M0 ${y}`;
    for (let x = 0; x < W * 2; x += 125) d += " q 31 -9 62 0 t 63 0";
    return d;
  };
  const wave = (y: number) => `${line(y)} V ${H + 20} H 0 Z`;
  const letters = { x: W / 2, y: base, textAnchor: "middle" as const, fontSize: H, textLength: W - 12, lengthAdjust: "spacingAndGlyphs" as const };
  return (
    <svg className="pf-amber-word" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={text}>
      <defs>
        <clipPath id={`${id}-clip`}>
          <text {...letters}>{text}</text>
        </clipPath>
        <linearGradient id={`${id}-honey`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#b8680c" />
          <stop offset="0.65" stopColor="#eb9a1c" />
          <stop offset="1" stopColor="#f7c25a" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${id}-clip)`}>
        <rect width={W} height={H} fill="#eb9a1c" fillOpacity="0.16" />
        <path className="pf-amber-wave" d={wave(level)} fill={`url(#${id}-honey)`} />
        <path className="pf-amber-wave pf-amber-shine" d={line(level + 3)} fill="none" stroke="#fff3cf" strokeWidth="3" strokeOpacity="0.7" />
      </g>
      <text {...letters} fill="none" stroke="#3b2a1e" strokeWidth="2.5" strokeLinejoin="round">{text}</text>
    </svg>
  );
}
