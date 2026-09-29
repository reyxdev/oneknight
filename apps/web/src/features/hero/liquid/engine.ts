import { FRAG, VERT } from "./shaders";
import { tick } from "@/lib/motion/ticker";
import { clamp, makeSpring, stepSpring } from "@/lib/motion/spring";

export type Layout = "one" | "two";

/** Font-size as a fraction of container width. Measured for Geologica 900, letter-spacing -0.045em, slant 12deg. */
export const FS_PER_WIDTH: Record<Layout, number> = { one: 1 / 6.15, two: 1 / 4.05 };
/** Container height as a multiple of font-size. */
export const HEIGHT_PER_FS: Record<Layout, number> = { one: 1.0, two: 2.0 };

const SKEW = Math.tan((12 * Math.PI) / 180);
const MAX_RIPPLES = 16;

type Palette = { base: [number, number, number]; low: [number, number, number]; high: [number, number, number] };

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const mixRgb = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function readTokens() {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => hexToRgb(s.getPropertyValue(n) || d);
  const ink = v("--ink", "#0b0e13");
  const deep = v("--alby-deep", "#26364a");
  const alby = v("--alby", "#566f88");
  const mist = v("--alby-mist", "#dde4eb");
  const paper = v("--paper", "#ffffff");
  const onLight: Palette = { base: mixRgb(ink, deep, 0.7), low: ink, high: mixRgb(alby, mist, 0.35) };
  const onDark: Palette = { base: mixRgb(deep, alby, 0.55), low: mixRgb(ink, deep, 0.6), high: mixRgb(alby, mist, 0.75) };
  return { onLight, onDark, glow: mixRgb(alby, paper, 0.55) };
}

export type LiquidController = {
  resize: () => void;
  setLayout: (l: Layout) => void;
  setCalm: (calm: boolean) => void;
  refreshTheme: () => void;
  destroy: () => void;
};

type Opts = {
  canvas: HTMLCanvasElement;
  lines: (layout: Layout) => string[];
  family: () => string;
  /** 0..1 scroll progress of the hero scene. */
  progress: () => number;
  isDarkPage: () => boolean;
  onReady: () => void;
  onFail: () => void;
};

export function createLiquid(o: Opts): LiquidController | null {
  const { canvas } = o;
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!gl) return null;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  let prog: WebGLProgram;
  try {
    prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
  } catch {
    return null;
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = (n: string) => gl.getUniformLocation(prog, n);
  const uMask = U("uMask"), uRes = U("uRes"), uTime = U("uTime"), uDissolve = U("uDissolve"), uPalette = U("uPalette");
  const uLight = U("uLight"), uCount = U("uCount"), uRip = U("uRip"), uBase = U("uBase"), uLow = U("uLow"), uHigh = U("uHigh"), uGlow = U("uGlow");

  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.uniform1i(uMask, 0);

  const mask = document.createElement("canvas");
  const mctx = mask.getContext("2d")!;

  let layout: Layout = "one";
  let calm = false;
  let quality = 1;
  let tokens = readTokens();
  let W = 0, H = 0, cssW = 1, cssH = 1;
  let visible = true;
  let stopTick: (() => void) | null = null;
  let t = 0;
  let dirty = true;
  let slow = 0;
  let frames = 0;
  let failed = false;
  let ready = false;

  const ripples: { x: number; y: number; t0: number; amp: number }[] = [];
  let lastSpawn = { x: -1e4, y: -1e4, t: 0 };
  const light = { x: makeSpring(0.3), y: makeSpring(0.8) };
  let hasPointer = false;

  const drawMask = () => {
    const fs = (cssW * FS_PER_WIDTH[layout]) * (W / cssW);
    mask.width = W;
    mask.height = H;
    mctx.clearRect(0, 0, W, H);
    mctx.fillStyle = "#fff";
    mctx.font = `900 ${fs}px ${o.family()}`;
    mctx.textBaseline = "alphabetic";
    const lines = o.lines(layout);
    const lineH = 0.9 * fs;
    const capH = 0.72 * fs;
    const blockH = layout === "one" ? fs : lineH * lines.length + 0.2 * fs;
    const padTop = layout === "one" ? (fs - capH) / 2 : 0.1 * fs;
    const top = (H - blockH) / 2;
    const ls = -0.045 * fs;
    const useLS = "letterSpacing" in (mctx as object);
    lines.forEach((line, i) => {
      const y = top + padTop + capH + i * lineH;
      let inkW = 0;
      if (useLS) {
        (mctx as unknown as { letterSpacing: string }).letterSpacing = `${ls}px`;
        inkW = mctx.measureText(line).width;
      } else {
        for (const ch of line) inkW += mctx.measureText(ch).width + ls;
      }
      const x0 = (W - (inkW + capH * SKEW)) / 2;
      mctx.save();
      mctx.translate(x0, y);
      mctx.transform(1, 0, -SKEW, 1, 0, 0);
      if (useLS) mctx.fillText(line, 0, 0);
      else {
        let x = 0;
        for (const ch of line) {
          mctx.fillText(ch, x, 0);
          x += mctx.measureText(ch).width + ls;
        }
      }
      mctx.restore();
    });
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    if (r.width < 2) return;
    cssW = r.width;
    cssH = r.height;
    const maxDpr = window.matchMedia("(pointer: coarse)").matches ? 1.5 : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr) * quality;
    W = Math.max(2, Math.round(cssW * dpr));
    H = Math.max(2, Math.round(cssH * dpr));
    canvas.width = W;
    canvas.height = H;
    gl.viewport(0, 0, W, H);
    drawMask();
    dirty = true;
  };

  const setVec3Array = (loc: WebGLUniformLocation | null, a: [number, number, number], b: [number, number, number]) => gl.uniform3fv(loc, new Float32Array([...a, ...b]));

  const render = (now: number) => {
    const p = o.progress();
    const dark = o.isDarkPage();
    const palette = dark ? 1 : clamp((p - 0.32) / 0.38);
    const dissolve = calm ? 0 : clamp((p - 0.18) / 0.62);
    gl.uniform2f(uRes, W, H);
    gl.uniform1f(uTime, calm ? 0 : t);
    gl.uniform1f(uDissolve, dissolve);
    gl.uniform1f(uPalette, palette);
    const lx = light.x.x, ly = light.y.x;
    gl.uniform2f(uLight, calm ? 0.3 : lx, calm ? 0.8 : ly);
    setVec3Array(uBase, tokens.onLight.base, tokens.onDark.base);
    setVec3Array(uLow, tokens.onLight.low, tokens.onDark.low);
    setVec3Array(uHigh, tokens.onLight.high, tokens.onDark.high);
    gl.uniform3f(uGlow, ...tokens.glow);
    const aspect = W / H;
    const arr = new Float32Array(MAX_RIPPLES * 4);
    let n = 0;
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i]!;
      const age = (now - rp.t0) / 1000;
      if (age > 3.2) {
        ripples.splice(i, 1);
        continue;
      }
      arr[n * 4] = rp.x * aspect;
      arr[n * 4 + 1] = rp.y;
      arr[n * 4 + 2] = age;
      arr[n * 4 + 3] = rp.amp;
      n++;
    }
    gl.uniform1i(uCount, calm ? 0 : n);
    gl.uniform4fv(uRip, arr);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const frame = (dt: number, now: number) => {
    if (failed) return;
    if (!hasPointer) {
      light.x.target = 0.5 + Math.sin(t * 0.35) * 0.35;
      light.y.target = 0.75 + Math.cos(t * 0.27) * 0.15;
    }
    stepSpring(light.x, dt, 140);
    stepSpring(light.y, dt, 140);
    t += dt / 1000;
    if (!calm || dirty) {
      render(now);
      dirty = false;
    }
    if (!ready) {
      ready = true;
      o.onReady();
    }
    if (!calm) {
      frames++;
      if (dt > 26) slow++;
      if (frames === 90) {
        if (slow > 45) {
          if (quality > 0.55) {
            quality *= 0.75;
            resize();
          } else {
            failed = true;
            o.onFail();
          }
        }
        frames = 0;
        slow = 0;
      }
    }
  };

  const start = () => {
    if (stopTick || failed) return;
    stopTick = tick(frame);
  };
  const stop = () => {
    stopTick?.();
    stopTick = null;
  };

  const io = new IntersectionObserver(
    (e) => {
      visible = e[0]?.isIntersecting ?? true;
      if (visible) start();
      else stop();
    },
    { rootMargin: "10% 0px" },
  );
  io.observe(canvas);

  const spawn = (cx: number, cy: number, speed: number) => {
    const r = canvas.getBoundingClientRect();
    if (cx < r.left - 60 || cx > r.right + 60 || cy < r.top - 60 || cy > r.bottom + 60) return;
    const amp = clamp(0.3 + speed * 0.5, 0.3, 1);
    ripples.push({ x: (cx - r.left) / r.width, y: 1 - (cy - r.top) / r.height, t0: performance.now(), amp });
    if (ripples.length > MAX_RIPPLES) ripples.shift();
    dirty = true;
  };
  const onMove = (e: PointerEvent) => {
    if (calm) return;
    const r = canvas.getBoundingClientRect();
    hasPointer = true;
    light.x.target = (e.clientX - r.left) / r.width;
    light.y.target = 1 - (e.clientY - r.top) / r.height;
    const now = performance.now();
    const d = Math.hypot(e.clientX - lastSpawn.x, e.clientY - lastSpawn.y);
    if (d > 26) {
      const speed = d / Math.max(16, now - lastSpawn.t);
      spawn(e.clientX, e.clientY, speed);
      lastSpawn = { x: e.clientX, y: e.clientY, t: now };
    }
  };
  const onDown = (e: PointerEvent) => {
    if (calm) return;
    spawn(e.clientX, e.clientY, 1.4);
  };
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });

  const onLost = (e: Event) => {
    e.preventDefault();
    failed = true;
    stop();
    o.onFail();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);

  resize();
  start();

  return {
    resize,
    setLayout: (l) => {
      if (l === layout) return;
      layout = l;
      resize();
    },
    setCalm: (c) => {
      calm = c;
      dirty = true;
      if (!c) start();
    },
    refreshTheme: () => {
      tokens = readTokens();
      dirty = true;
    },
    destroy: () => {
      stop();
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("webglcontextlost", onLost);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
