/*! ONEKNIGHT for client websites: analytics (no cookies, no personal data) and look-and-feel settings.
 *  <script src="https://oneknight.pro/ok.js" data-key="sk_..." data-appearance defer></script>
 *  Buttons with the data-ok-button attribute follow the settings from the ONEKNIGHT account. */
(function () {
  var s = document.currentScript;
  // "Do Not Track" turns analytics off; the look-and-feel settings still apply.
  var dnt = navigator.doNotTrack === "1";
  if (!s || !s.dataset.key) {
    // ---- Look and feel (opt-in with data-appearance) ----
  var look = null;
  var audio = null;
  function tone(profile) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      var p = { soft: ["sine", 540, 380, 0.06], glass: ["triangle", 1134, 798, 0.13], wood: ["square", 227, 160, 0.035] }[profile];
      if (!p) return;
      var t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
      o.type = p[0];
      o.frequency.setValueAtTime(p[1], t);
      o.frequency.exponentialRampToValueAtTime(p[2], t + p[3]);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + p[3]);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + p[3] + 0.02);
    } catch (e) {}
  }
  function applyLook(a) {
    look = a;
    var r = document.documentElement;
    r.style.setProperty("--ok-accent", a.accent);
    r.setAttribute("data-ok-anim", a.buttonAnim);
    r.setAttribute("data-ok-hover", a.hover);
    if (document.getElementById("ok-look")) return;
    var css = document.createElement("style");
    css.id = "ok-look";
    css.textContent = [
      "[data-ok-button]{position:relative;overflow:hidden;transition:transform .24s cubic-bezier(.22,1,.36,1),box-shadow .24s,text-decoration-color .24s}",
      "[data-ok-anim=lift] [data-ok-button]:hover{transform:translateY(-3px);box-shadow:0 10px 20px -8px var(--ok-accent)}",
      "[data-ok-anim=pulse] [data-ok-button]{animation:okpulse 1.8s cubic-bezier(.22,1,.36,1) infinite}",
      "@keyframes okpulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--ok-accent) 60%,transparent)}70%,100%{box-shadow:0 0 0 14px transparent}}",
      "[data-ok-anim=shine] [data-ok-button]::after{content:'';position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.55) 50%,transparent 70%);transform:translateX(-120%);animation:okshine 2.4s ease-in-out infinite;pointer-events:none}",
      "@keyframes okshine{60%,100%{transform:translateX(120%)}}",
      "[data-ok-hover=glow] [data-ok-button]:hover{box-shadow:0 0 0 4px color-mix(in srgb,var(--ok-accent) 30%,transparent),0 0 24px color-mix(in srgb,var(--ok-accent) 60%,transparent)}",
      "[data-ok-hover=underline] [data-ok-button]{text-decoration:underline 2px transparent;text-underline-offset:4px}[data-ok-hover=underline] [data-ok-button]:hover{text-decoration-color:currentColor}",
      "[data-ok-hover=scale] [data-ok-button]:hover{transform:scale(1.06)}",
      "[data-ok-button]:active{transform:scale(.96)!important}",
      ".ok-notice{position:fixed;z-index:2147483000;font:600 15px/1.4 system-ui,sans-serif;animation:okin .4s cubic-bezier(.22,1,.36,1)}",
      ".ok-notice[data-style=toast]{right:16px;bottom:16px;padding:12px 16px;border-radius:12px;background:#0b0e13;color:#fff;box-shadow:0 20px 40px -12px rgba(0,0,0,.5)}",
      ".ok-notice[data-style=banner]{left:0;right:0;top:0;padding:12px;text-align:center;background:var(--ok-accent);color:#fff}",
      ".ok-notice[data-style=minimal]{right:16px;bottom:16px;padding:8px 12px;border-radius:10px;background:#fff;color:#0b0e13;border:1px solid rgba(0,0,0,.12)}",
      "@keyframes okin{from{opacity:0;transform:translateY(12px)}}",
    ].join("");
    document.head.appendChild(css);
  }
  if (s.hasAttribute("data-appearance")) {
    fetch(new URL(s.src).origin + "/api/public/appearance", { headers: { "x-site-key": key } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (a) { if (a) applyLook(a); })
      .catch(function () {});
    document.addEventListener("pointerdown", function (e) {
      if (look && look.sound !== "off" && e.target.closest && e.target.closest("[data-ok-button]")) tone(look.sound);
    }, { passive: true });
  }
  function notify(text) {
    var n = document.createElement("div");
    n.className = "ok-notice";
    n.setAttribute("role", "status");
    n.setAttribute("data-style", (look && look.notice) || "toast");
    n.textContent = text;
    document.body.appendChild(n);
    setTimeout(function () { n.remove(); }, 3500);
  }

  window.oneknight = {
    /** Shows a notice in the style chosen in the ONEKNIGHT account. */
    notify: notify, track: function () {}, context: function () { return null; } };
    return;
  }
  var key = s.dataset.key;
  var api = new URL(s.src).origin + "/api/public/events";
  var store = window.sessionStorage;
  function get(k) { try { return store.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { store.setItem(k, v); } catch (e) {} }

  var session = get("ok_s");
  if (!session) {
    session = (Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^a-z0-9]/g, "").slice(0, 32);
    set("ok_s", session);
  }
  // First touch of this browsing session: where the visitor came from.
  var ctx = null;
  try { ctx = JSON.parse(get("ok_ctx") || "null"); } catch (e) {}
  if (!ctx) {
    var q = new URLSearchParams(location.search);
    ctx = {};
    ["source", "medium", "campaign", "content"].forEach(function (k) { var v = q.get("utm_" + k); if (v) ctx[k] = v.slice(0, 100); });
    if (document.referrer) ctx.referrer = document.referrer.slice(0, 500);
    set("ok_ctx", JSON.stringify(ctx));
  }
  function payload(type) {
    var p = { type: type, session: session, path: location.pathname.slice(0, 500) };
    for (var k in ctx) p[k] = ctx[k];
    return p;
  }
  function send(type) {
    if (dnt) return;
    try {
      fetch(api, { method: "POST", keepalive: true, headers: { "content-type": "application/json", "x-site-key": key }, body: JSON.stringify(payload(type)) }).catch(function () {});
    } catch (e) {}
  }
  var last = "";
  function view() {
    if (location.pathname === last) return;
    last = location.pathname;
    send("pageview");
  }
  // Single-page apps: count client-side navigation too.
  var push = history.pushState;
  history.pushState = function () { push.apply(this, arguments); setTimeout(view, 0); };
  window.addEventListener("popstate", view);
  view();

  // ---- Look and feel (opt-in with data-appearance) ----
  var look = null;
  var audio = null;
  function tone(profile) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      var p = { soft: ["sine", 540, 380, 0.06], glass: ["triangle", 1134, 798, 0.13], wood: ["square", 227, 160, 0.035] }[profile];
      if (!p) return;
      var t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
      o.type = p[0];
      o.frequency.setValueAtTime(p[1], t);
      o.frequency.exponentialRampToValueAtTime(p[2], t + p[3]);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + p[3]);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + p[3] + 0.02);
    } catch (e) {}
  }
  function applyLook(a) {
    look = a;
    var r = document.documentElement;
    r.style.setProperty("--ok-accent", a.accent);
    r.setAttribute("data-ok-anim", a.buttonAnim);
    r.setAttribute("data-ok-hover", a.hover);
    if (document.getElementById("ok-look")) return;
    var css = document.createElement("style");
    css.id = "ok-look";
    css.textContent = [
      "[data-ok-button]{position:relative;overflow:hidden;transition:transform .24s cubic-bezier(.22,1,.36,1),box-shadow .24s,text-decoration-color .24s}",
      "[data-ok-anim=lift] [data-ok-button]:hover{transform:translateY(-3px);box-shadow:0 10px 20px -8px var(--ok-accent)}",
      "[data-ok-anim=pulse] [data-ok-button]{animation:okpulse 1.8s cubic-bezier(.22,1,.36,1) infinite}",
      "@keyframes okpulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--ok-accent) 60%,transparent)}70%,100%{box-shadow:0 0 0 14px transparent}}",
      "[data-ok-anim=shine] [data-ok-button]::after{content:'';position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.55) 50%,transparent 70%);transform:translateX(-120%);animation:okshine 2.4s ease-in-out infinite;pointer-events:none}",
      "@keyframes okshine{60%,100%{transform:translateX(120%)}}",
      "[data-ok-hover=glow] [data-ok-button]:hover{box-shadow:0 0 0 4px color-mix(in srgb,var(--ok-accent) 30%,transparent),0 0 24px color-mix(in srgb,var(--ok-accent) 60%,transparent)}",
      "[data-ok-hover=underline] [data-ok-button]{text-decoration:underline 2px transparent;text-underline-offset:4px}[data-ok-hover=underline] [data-ok-button]:hover{text-decoration-color:currentColor}",
      "[data-ok-hover=scale] [data-ok-button]:hover{transform:scale(1.06)}",
      "[data-ok-button]:active{transform:scale(.96)!important}",
      ".ok-notice{position:fixed;z-index:2147483000;font:600 15px/1.4 system-ui,sans-serif;animation:okin .4s cubic-bezier(.22,1,.36,1)}",
      ".ok-notice[data-style=toast]{right:16px;bottom:16px;padding:12px 16px;border-radius:12px;background:#0b0e13;color:#fff;box-shadow:0 20px 40px -12px rgba(0,0,0,.5)}",
      ".ok-notice[data-style=banner]{left:0;right:0;top:0;padding:12px;text-align:center;background:var(--ok-accent);color:#fff}",
      ".ok-notice[data-style=minimal]{right:16px;bottom:16px;padding:8px 12px;border-radius:10px;background:#fff;color:#0b0e13;border:1px solid rgba(0,0,0,.12)}",
      "@keyframes okin{from{opacity:0;transform:translateY(12px)}}",
    ].join("");
    document.head.appendChild(css);
  }
  if (s.hasAttribute("data-appearance")) {
    fetch(new URL(s.src).origin + "/api/public/appearance", { headers: { "x-site-key": key } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (a) { if (a) applyLook(a); })
      .catch(function () {});
    document.addEventListener("pointerdown", function (e) {
      if (look && look.sound !== "off" && e.target.closest && e.target.closest("[data-ok-button]")) tone(look.sound);
    }, { passive: true });
  }
  function notify(text) {
    var n = document.createElement("div");
    n.className = "ok-notice";
    n.setAttribute("role", "status");
    n.setAttribute("data-style", (look && look.notice) || "toast");
    n.textContent = text;
    document.body.appendChild(n);
    setTimeout(function () { n.remove(); }, 3500);
  }

  window.oneknight = {
    /** Shows a notice in the style chosen in the ONEKNIGHT account. */
    notify: notify,
    /** Call when a visitor submits a request form: oneknight.track(). */
    track: function () { send("lead"); },
    /** Pass as `analytics` with POST /api/public/orders to attribute the order to its source. */
    context: function () { var c = { session: session }; for (var k in ctx) c[k] = ctx[k]; return c; },
  };
})();
