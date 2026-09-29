/** One shared rAF loop for every animation. Stops itself when nothing is subscribed. */
type Fn = (dt: number, now: number) => void;
const fns = new Set<Fn>();
let raf = 0;
let last = 0;

function loop(now: number) {
  const dt = Math.min(64, now - last);
  last = now;
  fns.forEach((f) => f(dt, now));
  raf = fns.size ? requestAnimationFrame(loop) : 0;
}

export function tick(fn: Fn): () => void {
  fns.add(fn);
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
  return () => {
    fns.delete(fn);
  };
}
