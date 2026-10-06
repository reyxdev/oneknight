import * as THREE from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { CAP_HEIGHT, GLYPHS } from "./glyphs";

/**
 * ONEKNIGHT as glass jars of Carpathian honey (owner's 50 answers, October 2026): 3D glass letters with smoky walls
 * and window reflections; light honey poured in by a stream up to 70%, a meniscus, constant small waves; it sloshes
 * from scrolling, the pointer, a tap and the phone's tilt (keeping the horizon); bubbles, drips and traces on the
 * walls; amber shadow and moving caustics on the paper; cloth lids with a rope and a bee once a minute.
 */

export type HoneyParams = {
  /** 1 (water) … 10 (thick resin). */
  viscosity: number;
  /** Honey level, part of the letter height. */
  level: number;
  /** 1 (opaque) … 10 (clear). */
  transparency: number;
  /** 1 … 10: how strongly it sloshes. */
  slosh: number;
  /** 1 … 10: letter depth. */
  depth: number;
  /** 0 … 1: smoky glass. */
  smoke: number;
  /** Light direction in degrees (135 = from the upper left). */
  light: number;
  /** 0 … 1.5: brightness of the light spots on the paper. */
  caustics: number;
  /** Bubbles per letter. */
  bubbles: number;
  /** Seconds between drips. */
  dripEvery: number;
  lids: boolean;
  bee: boolean;
  /** Seconds between bee visits. */
  beeEvery: number;
};

export const HONEY_DEFAULTS: HoneyParams = { viscosity: 4, level: 0.7, transparency: 4, slosh: 7, depth: 3, smoke: 0.35, light: 135, caustics: 0.8, bubbles: 3, dripEvery: 10, lids: true, bee: true, beeEvery: 60 };

export type HoneyController = {
  setParams: (p: Partial<HoneyParams>) => void;
  pour: () => void;
  splash: (letter?: number) => void;
  setVisible: (v: boolean) => void;
  /** iPhone asks for the motion sensor only after a tap. */
  requestTilt: () => Promise<boolean>;
  resize: () => void;
  destroy: () => void;
};

type Opts = {
  canvas: HTMLCanvasElement;
  /** Lines of the word, e.g. ["ONEKNIGHT"] or ["ONE", "KNIGHT"]. */
  lines: string[];
  params?: Partial<HoneyParams>;
  /** Render once, at rest, without motion («less motion», snapshots). */
  still?: boolean;
  onReady?: () => void;
  onFail?: () => void;
};

const SLANT = Math.tan((12 * Math.PI) / 180);
const MAX_RIP = 4;
const MAX_INT = 6;
const NX = 22;
const NZ = 4;
const MEN = 0.016;
const PAPER = new THREE.Color("#f4eee3");

type Ring = { x: number[]; y: number[] };
type Letter = {
  ch: string;
  rings: Ring[];
  x0: number;
  x1: number;
  cx: number;
  y0: number;
  y1: number;
  glass: THREE.Mesh;
  honey: THREE.Mesh;
  cap: THREE.Mesh;
  u: Record<string, THREE.IUniform>;
  lvl: number;
  target: number;
  tilt: number;
  tiltV: number;
  bob: number;
  bobV: number;
  film: number;
  rip: { x: number; t0: number; a: number }[];
  pourStart: number;
  stream: THREE.Mesh;
  streamX: number;
  lid: THREE.Group | null;
  lastRip: number;
};

/* ------------------------------------------------------------------ waves (same in JS and GLSL) */
const GLSL_SURF = /* glsl */ `
uniform float uL; uniform float uM; uniform float uCx; uniform float uT; uniform float uAmb; uniform float uDecay;
uniform float uPhase; uniform float uFilm; uniform float uMen; uniform float uY0; uniform float uY1;
uniform vec3 uRip[${MAX_RIP}];
float surf(float x, float z) {
  float s = uL + uM * (x - uCx);
  s += uAmb * (0.6 * sin(x * 7.0 + uT * 1.3 + uPhase) + 0.3 * sin(x * 13.0 - uT * 1.9 + uPhase * 2.0) + 0.1 * sin(z * 20.0 + uT * 1.1));
  for (int i = 0; i < ${MAX_RIP}; i++) {
    vec3 r = uRip[i];
    float age = uT - r.y;
    if (r.z > 0.0 && age > 0.0) { float d = abs(x - r.x); s += r.z * exp(-age * uDecay) * exp(-d * 3.0) * sin(d * 18.0 - age * 9.0); }
  }
  return s;
}
`;

function surfJS(l: Letter, x: number, z: number, t: number) {
  const u = l.u;
  let s = u.uL!.value + u.uM!.value * (x - l.cx);
  const ph = u.uPhase!.value as number;
  s += (u.uAmb!.value as number) * (0.6 * Math.sin(x * 7 + t * 1.3 + ph) + 0.3 * Math.sin(x * 13 - t * 1.9 + ph * 2) + 0.1 * Math.sin(z * 20 + t * 1.1));
  for (const r of l.rip) {
    const age = t - r.t0;
    if (r.a > 0 && age > 0) {
      const d = Math.abs(x - r.x);
      s += r.a * Math.exp(-age * u.uDecay!.value) * Math.exp(-d * 3) * Math.sin(d * 18 - age * 9);
    }
  }
  return s;
}

/* ------------------------------------------------------------------ geometry helpers */
function shapesOf(d: string) {
  const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`);
  return data.paths.flatMap((p) => p.toShapes());
}

/** Font units → word space: cap height = 1, slanted, shifted. */
function wordMatrix(ox: number, oy: number) {
  const s = 1 / CAP_HEIGHT;
  return new THREE.Matrix4().set(s, s * SLANT, 0, ox, 0, s, 0, oy, 0, 0, s, 0, 0, 0, 0, 1);
}

/** Inside intervals where the line y = L + m (x − cx) crosses the letter (even–odd rule). */
function intervals(rings: Ring[], L: number, m: number, cx: number) {
  const xs: number[] = [];
  for (const r of rings) {
    const n = r.x.length;
    for (let i = 0; i < n; i++) {
      const ax = r.x[i]!, ay = r.y[i]!, bx = r.x[(i + 1) % n]!, by = r.y[(i + 1) % n]!;
      const fa = ay - (L + m * (ax - cx)), fb = by - (L + m * (bx - cx));
      if ((fa <= 0 && fb > 0) || (fa > 0 && fb <= 0)) {
        const k = fa / (fa - fb);
        xs.push(ax + (bx - ax) * k);
      }
    }
  }
  xs.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1]! - xs[i]! > 0.01) out.push([xs[i]!, xs[i + 1]!]);
  return out.slice(0, MAX_INT);
}

/* ------------------------------------------------------------------ canvas textures */
function windowEnv(renderer: THREE.WebGLRenderer) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const g = c.getContext("2d")!;
  const wall = g.createLinearGradient(0, 0, 0, 512);
  wall.addColorStop(0, "#e9dcc6");
  wall.addColorStop(0.55, "#b99d7c");
  wall.addColorStop(1, "#6e5741");
  g.fillStyle = wall;
  g.fillRect(0, 0, 1024, 512);
  // A window to the upper left with the Carpathians in it (answers 22, 26).
  const wx = 300, wy = 90, ww = 230, wh = 190;
  const sky = g.createLinearGradient(0, wy, 0, wy + wh);
  sky.addColorStop(0, "#ffffff");
  sky.addColorStop(1, "#fff1d8");
  g.fillStyle = sky;
  g.fillRect(wx, wy, ww, wh);
  g.fillStyle = "#7d8a78";
  g.beginPath();
  g.moveTo(wx, wy + wh);
  for (let x = 0; x <= ww; x += 10) g.lineTo(wx + x, wy + wh * (0.62 + 0.13 * Math.sin(x / 31) + 0.07 * Math.sin(x / 11)));
  g.lineTo(wx + ww, wy + wh);
  g.fill();
  g.fillStyle = "#56664f";
  g.beginPath();
  g.moveTo(wx, wy + wh);
  for (let x = 0; x <= ww; x += 8) g.lineTo(wx + x, wy + wh * (0.78 + 0.08 * Math.sin(x / 17 + 2)));
  g.lineTo(wx + ww, wy + wh);
  g.fill();
  g.fillStyle = "#4a3a2c";
  g.fillRect(wx + ww / 2 - 4, wy, 8, wh);
  g.fillRect(wx, wy + wh / 2 - 4, ww, 8);
  g.lineWidth = 12;
  g.strokeStyle = "#4a3a2c";
  g.strokeRect(wx, wy, ww, wh);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromEquirectangular(tex).texture;
  tex.dispose();
  pm.dispose();
  return env;
}

function clothTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fbf3e6";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "rgba(196, 38, 38, 0.62)";
  for (let i = 0; i < 128; i += 32) {
    g.fillRect(i, 0, 16, 128);
    g.fillRect(0, i, 128, 16);
  }
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(80,40,20,${Math.random() * 0.08})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function beeTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 16;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? "#2a1d12" : "#f2b231";
    g.fillRect(i * 8, 0, 8, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ the engine */
export function createHoneyWord(o: Opts): HoneyController | null {
  const { canvas } = o;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  if (!renderer.capabilities.isWebGL2) {
    renderer.dispose();
    return null;
  }
  const P: HoneyParams = { ...HONEY_DEFAULTS, ...o.params };
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 1.75));
  renderer.setClearColor(PAPER, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.transmissionResolutionScale = coarse ? 0.6 : 0.8;

  const scene = new THREE.Scene();
  scene.environment = windowEnv(renderer);
  scene.environmentIntensity = 0.9;
  const camera = new THREE.PerspectiveCamera(20, 2, 0.1, 100);
  const sun = new THREE.DirectionalLight("#fff0d4", 2.4);
  scene.add(sun, new THREE.HemisphereLight("#fff6e6", "#8a6a48", 0.7));
  const word = new THREE.Group();
  scene.add(word);

  /* ---------------- layout of the letters */
  const depthW = () => 0.08 + P.depth * 0.05;
  const letters: Letter[] = [];
  const lineGap = 0.3;
  const lineW = o.lines.map((ln) => [...ln].reduce((a, ch) => a + (GLYPHS[ch]?.adv ?? 0), 0) / CAP_HEIGHT);
  const maxW = Math.max(...lineW);
  const totalH = o.lines.length * 1 + (o.lines.length - 1) * lineGap;

  const glassMat = () => {
    const m = new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#ffffff").lerp(new THREE.Color("#8d8170"), P.smoke), transparent: true, opacity: 0.02 + P.smoke * 0.08, roughness: 0.04, metalness: 0, ior: 1.5, clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1, envMapIntensity: 1.4, side: THREE.DoubleSide, depthWrite: false });
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        "#include <opaque_fragment>",
        `float fres = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.5);
         diffuseColor.a = clamp(diffuseColor.a + fres * 0.35 + dot(totalSpecular, vec3(0.3, 0.59, 0.11)) * 0.8, 0.0, 0.9);
         #include <opaque_fragment>`,
      );
    };
    return m;
  };
  const honeyMat = (u: Record<string, THREE.IUniform>) => {
    const t = P.transparency;
    const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.06, metalness: 0, transmission: 0.8 + t * 0.02, thickness: 0.45, ior: 1.49, attenuationColor: new THREE.Color("#eda93e"), attenuationDistance: 0.45 + t * 0.06, emissive: new THREE.Color("#b36a00"), emissiveIntensity: 0.1, clearcoat: 0.7, clearcoatRoughness: 0.08, specularIntensity: 0.8, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = "varying vec3 vLoc;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvLoc = position;");
      sh.fragmentShader =
        GLSL_SURF +
        "varying vec3 vLoc;\n" +
        sh.fragmentShader.replace(
          "void main() {",
          `void main() {
            float sY = surf(vLoc.x, vLoc.z) + uMen;
            if (vLoc.y > sY) {
              // traces on the walls after sloshing: only the wall faces, fading upwards (answer 18)
              float film = uFilm * (0.55 + 0.45 * sin(vLoc.x * 23.0 + vLoc.z * 9.0));
              if (!(gl_FrontFacing && vLoc.y < sY + film)) discard;
            }`,
        );
    };
    m.customProgramCacheKey = () => "honey";
    return m;
  };
  const streamMat = new THREE.MeshPhysicalMaterial({ color: "#eaa53a", roughness: 0.1, transmission: 0.5, thickness: 0.1, ior: 1.49, attenuationColor: new THREE.Color("#b0600a"), attenuationDistance: 0.3, clearcoat: 0.6 });
  const capMat = new THREE.MeshPhysicalMaterial({ color: "#f0b44a", roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, sheen: 0.3, sheenColor: new THREE.Color("#ffd58a"), envMapIntensity: 1.3, side: THREE.DoubleSide });
  const dropGeo = new THREE.SphereGeometry(1, 14, 10);

  let lineY = totalH - 1;
  let index = 0;
  for (const [li, ln] of o.lines.entries()) {
    let ox = (maxW - lineW[li]!) / 2;
    for (const ch of ln) {
      const gl = GLYPHS[ch]!;
      const mat = wordMatrix(ox, lineY);
      const shapes = shapesOf(gl.d);
      const dw = depthW();
      const glassGeo = new THREE.ExtrudeGeometry(shapes, { depth: dw * CAP_HEIGHT, bevelEnabled: true, bevelThickness: 0.028 * CAP_HEIGHT, bevelSize: 0.024 * CAP_HEIGHT, bevelSegments: coarse ? 2 : 4, curveSegments: coarse ? 8 : 14 });
      glassGeo.applyMatrix4(mat);
      glassGeo.computeVertexNormals();
      const honeyGeo = new THREE.ExtrudeGeometry(shapes, { depth: dw * CAP_HEIGHT, bevelEnabled: false, curveSegments: coarse ? 8 : 14 });
      honeyGeo.applyMatrix4(mat);
      // darker amber at the bottom, light and clear near the surface (answer 21)
      const pos = honeyGeo.attributes.position!;
      const col = new Float32Array(pos.count * 3);
      const dark = new THREE.Color("#f5b04a"), light = new THREE.Color("#fff4d2"), c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const k = THREE.MathUtils.clamp((pos.getY(i) - lineY) / 1, 0, 1);
        c.copy(dark).lerp(light, Math.pow(k, 0.8));
        col.set([c.r, c.g, c.b], i * 3);
      }
      honeyGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      const rings: Ring[] = [];
      for (const sh of shapes) {
        const pts = sh.extractPoints(12);
        for (const ring of [pts.shape, ...pts.holes]) {
          const r: Ring = { x: [], y: [] };
          for (const p of ring) {
            const v = new THREE.Vector3(p.x, p.y, 0).applyMatrix4(mat);
            r.x.push(v.x);
            r.y.push(v.y);
          }
          rings.push(r);
        }
      }
      const bb = new THREE.Box3().setFromBufferAttribute(honeyGeo.attributes.position as THREE.BufferAttribute);
      const u: Record<string, THREE.IUniform> = {
        uL: { value: lineY - 0.05 },
        uM: { value: 0 },
        uCx: { value: (bb.min.x + bb.max.x) / 2 },
        uT: { value: 0 },
        uAmb: { value: 0.005 },
        uDecay: { value: 1 },
        uPhase: { value: index * 1.7 },
        uFilm: { value: 0 },
        uMen: { value: MEN },
        uY0: { value: lineY },
        uY1: { value: lineY + 1 },
        uRip: { value: Array.from({ length: MAX_RIP }, () => new THREE.Vector3()) },
      };
      const glass = new THREE.Mesh(glassGeo, glassMat());
      glass.renderOrder = 3;
      const honey = new THREE.Mesh(honeyGeo, honeyMat(u));
      const capGeo = new THREE.BufferGeometry();
      const vCount = MAX_INT * (NX + 1) * (NZ + 1);
      capGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vCount * 3), 3));
      const idx: number[] = [];
      for (let s = 0; s < MAX_INT; s++)
        for (let i = 0; i < NX; i++)
          for (let j = 0; j < NZ; j++) {
            const a = s * (NX + 1) * (NZ + 1) + i * (NZ + 1) + j;
            idx.push(a, a + NZ + 1, a + 1, a + 1, a + NZ + 1, a + NZ + 2);
          }
      capGeo.setIndex(idx);
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.frustumCulled = false;
      // the pouring stream (answer 8)
      const sg = new THREE.CylinderGeometry(0.022, 0.032, 1, 14, 1, true);
      sg.translate(0, 0.5, 0);
      const stream = new THREE.Mesh(sg, streamMat);
      stream.visible = false;
      const mid = intervals(rings, lineY + 0.45, 0, u.uCx!.value);
      const widest = mid.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a), mid[0] ?? [bb.min.x, bb.max.x]);
      word.add(glass, honey, cap, stream);
      letters.push({ ch, rings, x0: bb.min.x, x1: bb.max.x, cx: u.uCx!.value, y0: lineY, y1: lineY + 1, glass, honey, cap, u, lvl: lineY, target: lineY + P.level, tilt: 0, tiltV: 0, bob: 0, bobV: 0, film: 0, rip: [], pourStart: -1, stream, streamX: (widest[0] + widest[1]) / 2, lid: null, lastRip: 0 });
      ox += gl.adv / CAP_HEIGHT;
      index++;
    }
    lineY -= 1 + lineGap;
  }
  word.position.set(-maxW / 2 - 0.1, -totalH / 2 + 0.05, -depthW() / 2);

  /* ---------------- paper with the amber shadow and caustics (answers 23, 24) */
  const maskW = 2048;
  const pad = 1.6;
  const mx0 = -pad, my0 = -pad, mw = maxW + 2 * pad, mh = totalH + 2 * pad;
  const maskH = Math.round((maskW * mh) / mw);
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = maskW;
  maskCanvas.height = maskH;
  const maskTex = new THREE.CanvasTexture(maskCanvas);
  const drawMask = () => {
    const g = maskCanvas.getContext("2d")!;
    g.fillStyle = "#000";
    g.fillRect(0, 0, maskW, maskH);
    g.filter = `blur(${Math.round(maskW / 240)}px)`;
    const sx = maskW / mw;
    letters.forEach((l, i) => {
      const grad = g.createLinearGradient(0, (mh - (l.y0 - my0)) * sx, 0, (mh - (l.y1 - my0)) * sx);
      grad.addColorStop(0, `rgb(255,0,${i * 16})`);
      grad.addColorStop(1, `rgb(255,255,${i * 16})`);
      g.fillStyle = grad;
      g.beginPath();
      for (const r of l.rings) {
        r.x.forEach((x, k) => {
          const px = (x - mx0) * sx, py = (mh - (r.y[k]! - my0)) * sx;
          if (k === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        });
        g.closePath();
      }
      g.fill("evenodd");
    });
    g.filter = "none";
    maskTex.needsUpdate = true;
  };
  drawMask();
  // a still word is drawn once: draw it again when the grain arrives
  const grain = new THREE.TextureLoader().load("/portfolio/grain.png", () => o.still && renderer.render(scene, camera));
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.colorSpace = THREE.SRGBColorSpace;
  grain.magFilter = grain.minFilter = THREE.NearestFilter;
  grain.generateMipmaps = false;
  const paperU = {
    uMask: { value: maskTex },
    uGrain: { value: grain },
    uPaper: { value: PAPER.clone() },
    uMaskMin: { value: new THREE.Vector2(mx0, my0) },
    uMaskSize: { value: new THREE.Vector2(mw, mh) },
    uShift: { value: new THREE.Vector2() },
    uLevels: { value: new Float32Array(16) },
    uT: { value: 0 },
    uCaustics: { value: P.caustics },
    uDpr: { value: renderer.getPixelRatio() },
  };
  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 40),
    new THREE.ShaderMaterial({
      uniforms: paperU,
      vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: /* glsl */ `
        uniform sampler2D uMask; uniform sampler2D uGrain; uniform vec3 uPaper; uniform vec2 uMaskMin; uniform vec2 uMaskSize;
        uniform vec2 uShift; uniform float uLevels[16]; uniform float uT; uniform float uCaustics; uniform float uDpr; varying vec3 vP;
        // a web of thin bright lines, like light through a jar of honey (answer 23)
        float caustic(vec2 p, float t) {
          float c = 0.0;
          for (int i = 0; i < 3; i++) {
            p += vec2(sin(p.y * 1.7 + t), cos(p.x * 1.3 - t * 0.8)) * 0.6;
            c += abs(sin(p.x * 2.0) * cos(p.y * 2.0));
          }
          return pow(1.0 - c / 3.0, 7.0);
        }
        void main() {
          vec2 w = vP.xy - uShift;
          vec2 uv = (w - uMaskMin) / uMaskSize;
          // the same grain as the page (a 180 px tile laid over the paper), so the canvas has no visible edge
          vec4 gr = texture2D(uGrain, gl_FragCoord.xy / (180.0 * uDpr));
          vec3 col = mix(uPaper, gr.rgb, gr.a);
          if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
            vec4 m = texture2D(uMask, uv);
            int idx = int(floor(m.b * 255.0 / 16.0 + 0.5));
            float honey = m.r * step(m.g, uLevels[idx]) * step(0.03, uLevels[idx]);
            float glass = max(m.r - honey, 0.0);
            col *= 1.0 - glass * 0.12;
            col = mix(col, col * vec3(0.9, 0.62, 0.3), honey * 0.7);
            float c = caustic(vP.xy * 5.0 + vec2(0.0, uT * 0.05), uT * 0.6);
            col += honey * uCaustics * vec3(1.0, 0.86, 0.55) * c * 1.4;
          }
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
      toneMapped: false,
    }),
  );
  paper.position.z = -0.55;
  word.add(paper);

  /* ---------------- bubbles, drips, splashes (answers 14, 16, 17) */
  const bubbleMat = new THREE.MeshPhysicalMaterial({ color: "#fff7df", roughness: 0, metalness: 0, transparent: true, opacity: 0.55, clearcoat: 1, envMapIntensity: 1.6 });
  const maxBub = letters.length * 6;
  const bubbles = new THREE.InstancedMesh(dropGeo, bubbleMat, maxBub);
  bubbles.frustumCulled = false;
  word.add(bubbles);
  type Bub = { l: number; x: number; y: number; z: number; r: number; v: number };
  const bub: Bub[] = [];
  const pickInside = (l: Letter, y: number) => {
    const iv = intervals(l.rings, y, 0, l.cx);
    if (!iv.length) return null;
    const total = iv.reduce((a, b) => a + b[1] - b[0], 0);
    let k = Math.random() * total;
    for (const [a, b] of iv) {
      if (k <= b - a) return a + 0.03 + k * ((b - a - 0.06) / (b - a));
      k -= b - a;
    }
    return null;
  };
  const spawnBubble = (b: Bub, low = true) => {
    const l = letters[b.l]!;
    const y = l.y0 + (low ? 0.04 + Math.random() * 0.15 : 0.05 + Math.random() * (P.level - 0.12));
    const x = pickInside(l, y);
    b.x = x ?? l.cx;
    b.y = y;
    b.z = 0.04 + Math.random() * (depthW() - 0.08);
    b.r = 0.006 + Math.random() * 0.011;
    b.v = (0.012 + Math.random() * 0.02) * (11 - P.viscosity) / 6;
  };
  const resetBubbles = () => {
    bub.length = 0;
    letters.forEach((_, i) => {
      for (let k = 0; k < Math.min(6, P.bubbles); k++) {
        const b = { l: i, x: 0, y: 0, z: 0, r: 0, v: 0 };
        spawnBubble(b, false);
        bub.push(b);
      }
    });
  };
  resetBubbles();

  const honeyDropMat = streamMat;
  type Drop = { m: THREE.Mesh; l: number; x: number; y: number; vx: number; vy: number; on: boolean; drip: boolean; t0: number };
  const drops: Drop[] = Array.from({ length: 16 }, () => {
    const m = new THREE.Mesh(dropGeo, honeyDropMat);
    m.visible = false;
    word.add(m);
    return { m, l: 0, x: 0, y: 0, vx: 0, vy: 0, on: false, drip: false, t0: 0 };
  });
  const freeDrop = () => drops.find((d) => !d.on);

  /* ---------------- lids with cloth and rope (answer 31) */
  const cloth = clothTexture();
  const clothMat = new THREE.MeshStandardMaterial({ map: cloth, roughness: 0.95, side: THREE.DoubleSide });
  const ropeMat = new THREE.MeshStandardMaterial({ color: "#9b7a4e", roughness: 0.9 });
  const buildLid = (l: Letter) => {
    const g = new THREE.Group();
    const dw = depthW();
    const topY = l.y1 + 0.024; // the glass top: outline grown by the bevel
    for (const [a0, b0] of intervals(l.rings, l.y1 - 0.02, 0, l.cx)) {
      const cx = (a0 + b0) / 2;
      const rx = (b0 - a0) / 2 + 0.05;
      const rz = dw / 2 + 0.06;
      // the cloth: a flat top with a skirt hanging down around the jar's neck, a little wavy (answer 31)
      const top = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.02, 40), clothMat);
      top.scale.set(rx, 1, rz);
      top.position.set(cx, topY + 0.01, dw / 2);
      const skirtGeo = new THREE.CylinderGeometry(1, 1.12, 0.11, 48, 3, true);
      const sp = skirtGeo.attributes.position!;
      for (let i = 0; i < sp.count; i++) {
        const y = sp.getY(i);
        if (y < 0) {
          const ang = Math.atan2(sp.getZ(i), sp.getX(i));
          sp.setY(i, y + Math.sin(ang * 9) * 0.012);
        }
      }
      skirtGeo.computeVertexNormals();
      const skirt = new THREE.Mesh(skirtGeo, clothMat);
      skirt.scale.set(rx, 1, rz);
      skirt.position.set(cx, topY - 0.045, dw / 2);
      // the rope: an even thin cord around the neck with a small knot in front
      const ropeCurve = new THREE.EllipseCurve(0, 0, rx * 0.98, rz * 0.98, 0, Math.PI * 2, false, 0);
      const pts = ropeCurve.getPoints(48).map((p) => new THREE.Vector3(p.x, 0, p.y));
      const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 64, 0.007, 6, true), ropeMat);
      rope.position.set(cx, topY - 0.06, dw / 2);
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), ropeMat);
      knot.position.set(cx, topY - 0.06, dw / 2 + rz * 0.98);
      g.add(top, skirt, rope, knot);
    }
    g.position.y = 0.8;
    g.visible = false;
    word.add(g);
    return g;
  };

  /* ---------------- the bee (answer 32) */
  const bee = new THREE.Group();
  const beeBody = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshStandardMaterial({ map: beeTexture(), roughness: 0.6 }));
  beeBody.scale.set(1.5, 1, 1);
  beeBody.rotation.z = Math.PI / 2;
  const beeHead = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 10), new THREE.MeshStandardMaterial({ color: "#2a1d12", roughness: 0.5 }));
  beeHead.position.x = 0.08;
  const wingMat = new THREE.MeshPhysicalMaterial({ color: "#ffffff", transparent: true, opacity: 0.45, roughness: 0.1, side: THREE.DoubleSide });
  const wingGeo = new THREE.CircleGeometry(0.05, 16);
  wingGeo.scale(1.3, 0.7, 1);
  const wingL = new THREE.Mesh(wingGeo, wingMat);
  const wingR = new THREE.Mesh(wingGeo, wingMat);
  wingL.position.set(-0.01, 0.045, 0.03);
  wingR.position.set(-0.01, 0.045, -0.03);
  bee.add(beeBody, beeHead, wingL, wingR);
  bee.visible = false;
  word.add(bee);
  let beeT0 = -1;
  let beePath: THREE.CatmullRomCurve3 | null = null;
  let beeNext = 18;
  const startBee = (now: number) => {
    const l = letters[Math.floor(Math.random() * letters.length)]!;
    const land = new THREE.Vector3(l.cx + 0.05, l.y1 + (l.lid?.visible ? 0.07 : 0.03), depthW() / 2);
    const from = Math.random() < 0.5 ? -1.5 : maxW + 1.5;
    beePath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(from, totalH + 0.8, 0.6),
      new THREE.Vector3((from + land.x) / 2, totalH + 0.4, 1.0),
      new THREE.Vector3(land.x - 0.4, land.y + 0.35, 0.5),
      land,
      land.clone(),
      new THREE.Vector3(land.x + 0.5, land.y + 0.5, 0.7),
      new THREE.Vector3(maxW + 2 - from, totalH + 1, 0.5),
    ]);
    beeT0 = now;
    bee.visible = true;
  };

  /* ---------------- input: scroll, pointer, tap, tilt, resize (answers 12–15) */
  const S = () => P.slosh / 7;
  let lastScrollY = window.scrollY, lastScrollT = performance.now(), scrollV = 0;
  const onScroll = () => {
    const now = performance.now();
    const v = (window.scrollY - lastScrollY) / Math.max(16, now - lastScrollT);
    const dv = v - scrollV;
    scrollV = v;
    lastScrollY = window.scrollY;
    lastScrollT = now;
    for (const l of letters) {
      l.bobV += THREE.MathUtils.clamp(dv, -3, 3) * 0.06 * S();
      l.tiltV += THREE.MathUtils.clamp(dv, -3, 3) * 0.25 * S() * (Math.random() - 0.5);
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const glassList = letters.map((l) => l.glass);
  const hit = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObjects(glassList, false)[0];
    if (!h) return null;
    const i = glassList.indexOf(h.object as THREE.Mesh);
    return { i, x: word.worldToLocal(h.point.clone()).x };
  };
  let lastPX = 0, lastPT = 0;
  const onMove = (e: PointerEvent) => {
    const now = performance.now();
    const speed = Math.min(2, Math.abs(e.clientX - lastPX) / Math.max(8, now - lastPT));
    lastPX = e.clientX;
    lastPT = now;
    const h = hit(e);
    if (!h) return;
    const l = letters[h.i]!;
    if (now - l.lastRip < 140) return;
    l.lastRip = now;
    addRipple(l, h.x, (0.006 + speed * 0.01) * S());
    l.tiltV += (e.movementX || 0) * 0.002 * S();
  };
  const onDown = (e: PointerEvent) => {
    const h = hit(e);
    if (h) splashAt(h.i, h.x);
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onDown);

  let tiltTarget = 0;
  const onOrient = (e: DeviceOrientationEvent) => {
    if (e.gamma == null) return;
    // the honey keeps the horizon: relative to the screen it tilts against the phone (answer 13)
    tiltTarget = THREE.MathUtils.clamp((-e.gamma * Math.PI) / 180, -0.6, 0.6);
  };
  window.addEventListener("deviceorientation", onOrient);

  let time = 0;
  const addRipple = (l: Letter, x: number, a: number) => {
    const slot = l.rip.length < MAX_RIP ? l.rip.length : l.rip.reduce((m, r, i, arr) => (r.t0 < arr[m]!.t0 ? i : m), 0);
    l.rip[slot] = { x, t0: time, a };
  };
  const splashAt = (i: number, x: number) => {
    const l = letters[i]!;
    addRipple(l, x, 0.04 * S());
    l.bobV -= 0.25 * S();
    l.film = Math.min(0.12, l.film + 0.05 * S());
    const top = surfJS(l, x, depthW() / 2, time);
    for (let k = 0; k < 4; k++) {
      const d = freeDrop();
      if (!d) break;
      Object.assign(d, { l: i, x: x + (Math.random() - 0.5) * 0.08, y: top, vx: (Math.random() - 0.5) * 0.4, vy: 0.7 + Math.random() * 0.6 * S(), on: true, drip: false, t0: time });
      const s = 0.012 + Math.random() * 0.012;
      d.m.scale.set(s, s * 1.2, s);
      d.m.visible = true;
    }
    for (let k = 0; k < 2; k++) {
      const b = bub.find((q) => q.l === i);
      if (b) spawnBubble(b);
    }
  };

  /* ---------------- pouring (answer 8) */
  const pourDur = 1.1;
  const startPour = () => {
    const t = time;
    letters.forEach((l, i) => {
      l.lvl = l.y0 - 0.02;
      l.pourStart = t + 0.12 * i;
      l.film = 0;
      if (l.lid) l.lid.visible = false;
    });
  };

  /* ---------------- size */
  const fit = () => {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const halfW = maxW / 2 + 0.25;
    const halfH = totalH / 2 + (o.lines.length > 1 ? 0.35 : 0.55);
    const vFov = (camera.fov * Math.PI) / 180;
    const dist = Math.max(halfH / Math.tan(vFov / 2), halfW / (Math.tan(vFov / 2) * camera.aspect));
    // straight on, a little from above to see the honey surface (answer 6)
    camera.position.set(0, dist * 0.12, dist);
    camera.lookAt(0, 0.05, 0);
    camera.updateProjectionMatrix();
    for (const l of letters) l.tiltV += (Math.random() - 0.5) * 0.4 * S();
  };
  fit();

  const applyParams = () => {
    const a = (P.light * Math.PI) / 180;
    sun.position.set(Math.cos(a) * 4, Math.sin(a) * 4, 3.5);
    paperU.uShift.value.set(-Math.cos(a) * 0.32, -Math.sin(a) * 0.32);
    paperU.uCaustics.value = P.caustics;
    for (const l of letters) {
      l.target = l.y0 + P.level;
      l.u.uDecay!.value = 0.8 + P.viscosity * 0.35;
      const gm = l.glass.material as THREE.MeshPhysicalMaterial;
      gm.color.set("#ffffff").lerp(new THREE.Color("#8d8170"), P.smoke);
      gm.opacity = 0.02 + P.smoke * 0.08;
      const hm = l.honey.material as THREE.MeshPhysicalMaterial;
      hm.transmission = 0.8 + P.transparency * 0.02;
      hm.attenuationDistance = 0.45 + P.transparency * 0.06;
      if (P.lids && !l.lid) l.lid = buildLid(l);
      if (!P.lids && l.lid) l.lid.visible = false;
    }
    if (bub.length !== letters.length * Math.min(6, P.bubbles)) resetBubbles();
    if (!P.bee) bee.visible = false;
  };
  applyParams();

  /* ---------------- frame */
  let visible = true;
  let raf = 0;
  let prev = performance.now();
  let slow = 0, frames = 0, skip = false, odd = false;
  let nextDrip = 3;
  const dummy = new THREE.Object3D();
  const ready = { done: false };

  const step = (dt: number) => {
    time += dt;
    const k = 18 - P.viscosity * 1.1;
    const c = 1.4 + P.viscosity * 0.55;
    let allPoured = true;
    for (const [i, l] of letters.entries()) {
      // pouring: the stream falls, the level rises, the stream thins away
      let streamOn = false, sTop = 0, sBot = 0;
      if (l.pourStart >= 0) {
        const t = time - l.pourStart;
        if (t < 0) allPoured = false;
        else if (t < pourDur + 0.5) {
          allPoured = false;
          const fall = Math.min(1, t / 0.25);
          const fill = THREE.MathUtils.clamp((t - 0.2) / pourDur, 0, 1);
          const ease = 1 - Math.pow(1 - fill, 2.2);
          l.lvl = l.y0 - 0.02 + (l.target - l.y0 + 0.02) * ease;
          sTop = l.y1 + 1.4 - Math.max(0, (t - pourDur) / 0.5) * (l.y1 + 1.4 - l.lvl);
          sBot = Math.max(l.lvl, l.y1 + 1.4 - fall * (l.y1 + 1.4 - l.lvl));
          streamOn = sTop - sBot > 0.01;
          if (fill > 0 && fill < 1 && Math.random() < dt * 10) addRipple(l, l.streamX + (Math.random() - 0.5) * 0.04, 0.012);
        } else {
          l.pourStart = -1;
        }
      }
      if (l.pourStart < 0) l.lvl += (l.target - l.lvl) * Math.min(1, dt * 3);
      l.stream.visible = streamOn;
      if (streamOn) {
        l.stream.position.set(l.streamX + Math.sin(time * 9 + i) * 0.004, sBot, depthW() / 2);
        l.stream.scale.set(1, sTop - sBot, 1);
      }
      // slosh: a damped pendulum for the tilt, a spring for the bob (answers 2, 15)
      l.tiltV += (-(l.tilt - tiltTarget) * k - l.tiltV * c) * dt;
      l.tilt += l.tiltV * dt;
      l.tilt = THREE.MathUtils.clamp(l.tilt, -0.5, 0.5);
      l.bobV += (-l.bob * k - l.bobV * c) * dt;
      l.bob += l.bobV * dt;
      l.film = Math.max(0, l.film - dt * 0.02 * (11 - P.viscosity) * 0.25);
      if (Math.abs(l.tiltV) > 0.3) l.film = Math.min(0.12, l.film + dt * 0.04);
      const u = l.u;
      u.uL!.value = l.lvl + l.bob * 0.15;
      u.uM!.value = Math.tan(l.tilt);
      u.uT!.value = time;
      u.uAmb!.value = 0.0045 * (0.6 + S() * 0.4);
      u.uFilm!.value = l.film;
      for (let r = 0; r < MAX_RIP; r++) {
        const rp = l.rip[r];
        (u.uRip!.value as THREE.Vector3[])[r]!.set(rp?.x ?? 0, rp?.t0 ?? 0, rp && time - rp.t0 < 6 ? rp.a : 0);
      }
      buildCap(l);
      paperU.uLevels.value[i] = THREE.MathUtils.clamp((u.uL!.value - l.y0) / (l.y1 - l.y0), 0, 1);
      if (l.lid) {
        const show = P.lids && allPoured && l.pourStart < 0;
        if (show && !l.lid.visible) {
          l.lid.visible = true;
          l.lid.position.y = 0.6;
        }
        if (l.lid.visible) l.lid.position.y += (0 - l.lid.position.y) * Math.min(1, dt * 7);
      }
    }
    // bubbles rise slowly and come back at the bottom
    bub.forEach((b, i) => {
      const l = letters[b.l]!;
      b.y += b.v * dt;
      b.x += Math.sin(time * 1.3 + i) * 0.0008;
      if (b.y + b.r > surfJS(l, b.x, b.z, time) - 0.004) spawnBubble(b);
      dummy.position.set(b.x, b.y, b.z);
      dummy.scale.setScalar(b.r);
      dummy.updateMatrix();
      bubbles.setMatrixAt(i, dummy.matrix);
    });
    bubbles.count = bub.length;
    bubbles.instanceMatrix.needsUpdate = true;
    // drops: splashes fall back; drips slide down the glass from above the honey
    nextDrip -= dt;
    if (nextDrip <= 0 && allPoured) {
      nextDrip = P.dripEvery * (0.7 + Math.random() * 0.6);
      const d = freeDrop();
      const li = Math.floor(Math.random() * letters.length);
      const l = letters[li]!;
      const x = pickInside(l, l.y1 - 0.12);
      if (d && x != null) {
        Object.assign(d, { l: li, x, y: l.y1 - 0.1, vx: 0, vy: -0.05, on: true, drip: true, t0: time });
        d.m.scale.set(0.012, 0.022, 0.008);
        d.m.visible = true;
      }
    }
    for (const d of drops) {
      if (!d.on) continue;
      const l = letters[d.l]!;
      const z = d.drip ? depthW() - 0.006 : depthW() / 2;
      if (d.drip) {
        d.vy = -0.05 - (time - d.t0) * 0.012 * (11 - P.viscosity) / 6;
        d.y += d.vy * dt;
        d.x += Math.sin(time * 2 + d.t0) * 0.0004;
      } else {
        d.vy -= 5.5 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
      }
      const s = surfJS(l, d.x, z, time);
      if (d.vy < 0 && d.y < s) {
        d.on = false;
        d.m.visible = false;
        addRipple(l, d.x, d.drip ? 0.006 : 0.012);
        continue;
      }
      d.m.position.set(d.x, d.y, z);
    }
    // the bee
    if (P.bee && allPoured) {
      if (beeT0 < 0 && time > beeNext) startBee(time);
      if (beeT0 >= 0 && beePath) {
        const dur = 7;
        const t = (time - beeT0) / dur;
        if (t >= 1) {
          bee.visible = false;
          beeT0 = -1;
          beeNext = time + P.beeEvery;
        } else {
          // slow down while sitting on the lid (the middle of the path)
          const tt = t < 0.4 ? (t / 0.4) * 0.5 : t < 0.65 ? 0.5 + ((t - 0.4) / 0.25) * 0.17 : 0.67 + ((t - 0.65) / 0.35) * 0.33;
          const p = beePath.getPointAt(Math.min(1, tt));
          const ahead = beePath.getPointAt(Math.min(1, tt + 0.01));
          bee.position.copy(p);
          bee.rotation.y = Math.atan2(-(ahead.z - p.z), ahead.x - p.x);
          const flap = Math.sin(time * (t > 0.42 && t < 0.63 ? 18 : 70)) * 0.7;
          wingL.rotation.x = flap;
          wingR.rotation.x = -flap;
        }
      }
    }
    // the word turns a little with the page (answer 35)
    const r = canvas.getBoundingClientRect();
    const prog = THREE.MathUtils.clamp((r.top + r.height / 2) / window.innerHeight - 0.5, -1, 1);
    word.rotation.x += (prog * 0.12 - word.rotation.x) * Math.min(1, dt * 4);
    word.rotation.y += (prog * -0.06 - word.rotation.y) * Math.min(1, dt * 4);
    paperU.uT.value = time;
  };

  const capPos = (l: Letter) => l.cap.geometry.attributes.position as THREE.BufferAttribute;
  const buildCap = (l: Letter) => {
    const u = l.u;
    const L = u.uL!.value as number, m = u.uM!.value as number;
    const iv = intervals(l.rings, L, m, l.cx);
    const arr = capPos(l).array as Float32Array;
    const dw = depthW();
    let n = 0;
    for (let s = 0; s < MAX_INT; s++) {
      const it = iv[s];
      for (let i = 0; i <= NX; i++)
        for (let j = 0; j <= NZ; j++) {
          if (!it) {
            arr[n++] = 0;
            arr[n++] = -100;
            arr[n++] = 0;
            continue;
          }
          const fx = i / NX, fz = j / NZ;
          const x = it[0] + (it[1] - it[0]) * fx;
          const z = dw * fz;
          // meniscus: the honey climbs a little up the walls (answer 11)
          const edge = Math.min(fx * (it[1] - it[0]), (1 - fx) * (it[1] - it[0]), fz * dw, (1 - fz) * dw);
          const men = MEN * Math.exp(-edge / 0.012);
          arr[n++] = x;
          arr[n++] = surfJS(l, x, z, time) + men;
          arr[n++] = z;
        }
    }
    capPos(l).needsUpdate = true;
    l.cap.geometry.computeVertexNormals();
  };

  const render = () => renderer.render(scene, camera);
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (!visible) {
      prev = now;
      return;
    }
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    // 60 fps when the device keeps up, otherwise 30 (answer 44)
    frames++;
    if (dt > 0.024) slow++;
    if (frames === 90) {
      skip = slow > 45;
      frames = slow = 0;
    }
    odd = !odd;
    if (skip && odd) return;
    step(skip ? dt * 2 : dt);
    render();
    if (!ready.done) {
      ready.done = true;
      o.onReady?.();
    }
  };

  if (o.still) {
    for (const l of letters) l.lvl = l.target;
    for (let i = 0; i < 3; i++) step(0.016);
    for (const l of letters) if (l.lid && P.lids) { l.lid.visible = true; l.lid.position.y = 0; }
    render();
    o.onReady?.();
  } else {
    startPour();
    raf = requestAnimationFrame(loop);
  }

  const onLost = (e: Event) => {
    e.preventDefault();
    o.onFail?.();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  return {
    /** Depth changes the glass itself: create the word again for it. */
    setParams: (p) => {
      Object.assign(P, p);
      applyParams();
      if (o.still) render();
    },
    pour: startPour,
    splash: (i) => {
      const li = i ?? Math.floor(Math.random() * letters.length);
      splashAt(li, letters[li]!.cx);
    },
    setVisible: (v) => {
      visible = v;
    },
    requestTilt: async () => {
      const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      if (typeof D.requestPermission !== "function") return true;
      try {
        return (await D.requestPermission()) === "granted";
      } catch {
        return false;
      }
    },
    resize: fit,
    destroy: () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("deviceorientation", onOrient);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("webglcontextlost", onLost);
      scene.traverse((ob) => {
        const m = ob as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        mats.forEach((x) => x.dispose());
      });
      renderer.dispose();
    },
  };
}
