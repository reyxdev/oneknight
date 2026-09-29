/** Critically damped spring, frame-rate independent. Feels physical, never laggy. */
export type Spring = { x: number; v: number; target: number };

export const makeSpring = (x = 0): Spring => ({ x, v: 0, target: x });

/** halfLife in ms: time to cover half the remaining distance. Smaller = snappier. */
export function stepSpring(s: Spring, dt: number, halfLife: number): number {
  const omega = (2 * Math.LN2) / Math.max(1, halfLife);
  const d = dt;
  const x = s.x - s.target;
  const e = Math.exp(-omega * d);
  const t = (s.v + omega * x) * d;
  s.x = s.target + (x + t) * e;
  s.v = (s.v - omega * t) * e;
  return s.x;
}

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
