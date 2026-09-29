export const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/**
 * Liquid text. The text mask (mipmapped) gives a soft dome height inside the letters.
 * Flowing noise and analytic pointer ripples deform that height. Normals come from finite differences,
 * shading is a studio-style reflection (soft boxes + fresnel + pointer-driven specular).
 * The silhouette wobbles with the surface, and uDissolve eats it away with a glowing edge.
 */
export const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uMask;
uniform vec2 uRes;
uniform float uTime;
uniform float uDissolve;
uniform float uPalette;      // 0 = letters for a light page, 1 = letters for a dark page
uniform vec2 uLight;         // pointer in uv
uniform int uCount;
uniform vec4 uRip[16];       // xy: aspect-corrected uv, z: age (s), w: amplitude
uniform vec3 uBase[2];
uniform vec3 uLow[2];
uniform vec3 uHigh[2];
uniform vec3 uGlow;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; }
  return v;
}

vec4 cubicW(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  float w = 6.0 - x - y - z;
  return vec4(x, y, z, w) * (1.0 / 6.0);
}
// C2-smooth sample of one mip level (4 bilinear taps): no visible mip facets in the derived normals.
float smoothMask(vec2 uv, float lod) {
  vec2 size = vec2(textureSize(uMask, int(lod)));
  vec2 tc = uv * size - 0.5;
  vec2 f = fract(tc);
  tc -= f;
  vec4 xc = cubicW(f.x);
  vec4 yc = cubicW(f.y);
  vec4 c = tc.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 o = (c + vec4(xc.yw, yc.yw) / s) / size.xxyy;
  float s0 = textureLod(uMask, o.xz, lod).a;
  float s1 = textureLod(uMask, o.yz, lod).a;
  float s2 = textureLod(uMask, o.xw, lod).a;
  float s3 = textureLod(uMask, o.yw, lod).a;
  return mix(mix(s3, s2, s.x / (s.x + s.y)), mix(s1, s0, s.x / (s.x + s.y)), s.z / (s.z + s.w));
}

vec2 asp;

float height(vec2 uv) {
  vec2 p = uv * asp;
  float dome = smoothMask(uv, 3.0);
  float rim = smoothMask(uv, 1.0);
  float flow = 0.62 * noise(p * 1.25 + vec2(uTime * 0.07, -uTime * 0.045)) + 0.38 * noise(p * 2.7 + vec2(-uTime * 0.05, uTime * 0.06) + 7.0);
  float h = dome * 1.15 + rim * 0.3 + (flow - 0.5) * 0.7 * dome;
  for (int i = 0; i < 16; i++) {
    if (i >= uCount) break;
    vec4 r = uRip[i];
    float d = length(p - r.xy);
    h += sin(d * 34.0 - r.z * 7.5) * exp(-d * 3.8) * exp(-r.z * 1.3) * r.w * 0.11;
  }
  return h;
}

void main() {
  asp = vec2(uRes.x / uRes.y, 1.0);
  vec2 uv = vUv;
  float e = 1.6 / uRes.y;
  float h0 = height(uv);
  float hx = height(uv + vec2(e / asp.x, 0.0));
  float hy = height(uv + vec2(0.0, e));
  vec2 g = vec2(hx - h0, hy - h0) / e;

  vec2 gd = g / max(1.0, length(g) / 18.0);
  vec2 uvd = uv - gd * 0.00028;
  float m = texture(uMask, uvd).a;
  float alpha = smoothstep(0.32, 0.68, m);
  if (alpha < 0.002) { outColor = vec4(0.0); return; }

  vec3 n = normalize(vec3(-g * 0.11, 1.0));
  vec3 v = vec3(0.0, 0.0, 1.0);
  vec3 r = reflect(-v, n);

  vec3 base = mix(uBase[0], uBase[1], uPalette);
  vec3 low = mix(uLow[0], uLow[1], uPalette);
  vec3 high = mix(uHigh[0], uHigh[1], uPalette);

  float sky = clamp(r.y * 0.5 + 0.5 + (h0 - 0.5) * 0.25, 0.0, 1.0);
  vec3 env = mix(low, high, smoothstep(0.12, 0.92, sky));
  float band1 = smoothstep(0.06, 0.0, abs(r.y - 0.36 + r.x * 0.35) - 0.05);
  float band2 = smoothstep(0.05, 0.0, abs(r.y + 0.42 - r.x * 0.25) - 0.025);
  env += vec3(1.0) * (band1 * 0.85 + band2 * 0.4);

  float fres = pow(1.0 - max(n.z, 0.0), 2.4);
  vec3 lp = vec3((uLight - uv) * vec2(asp.x, 1.0) * 1.1, 0.5);
  vec3 hv = normalize(normalize(lp) + v);
  float spec = pow(max(dot(n, hv), 0.0), 70.0);

  vec3 col = mix(base, env, 0.5 + 0.45 * fres);
  col += vec3(1.0) * spec * 0.85;
  col = mix(col, high, smoothstep(0.55, 1.0, h0) * 0.18);

  float k = 1.0;
  if (uDissolve > 0.001) {
    float nz = fbm(uv * asp * 4.5 + 3.0) * 0.85 + (1.0 - uv.y) * 0.18;
    float thr = uDissolve * 1.25 - 0.12;
    k = smoothstep(thr, thr + 0.07, nz);
    float edge = smoothstep(thr - 0.03, thr, nz) * (1.0 - smoothstep(thr, thr + 0.06, nz));
    col += uGlow * edge * 1.6;
    alpha = max(alpha * k, edge * alpha);
  }
  outColor = vec4(col * alpha, alpha);
}`;
