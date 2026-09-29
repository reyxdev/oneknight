/*! ONEKNIGHT analytics: no cookies, no personal data. <script src="https://oneknight.pro/ok.js" data-key="sk_..." defer></script> */
(function () {
  var s = document.currentScript;
  if (!s || !s.dataset.key || navigator.doNotTrack === "1") {
    window.oneknight = { track: function () {}, context: function () { return null; } };
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

  window.oneknight = {
    /** Call when a visitor submits a request form: oneknight.track(). */
    track: function () { send("lead"); },
    /** Pass as `analytics` with POST /api/public/orders to attribute the order to its source. */
    context: function () { var c = { session: session }; for (var k in ctx) c[k] = ctx[k]; return c; },
  };
})();
