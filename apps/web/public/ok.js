/*! ONEKNIGHT for client websites: analytics (no cookies, no personal data) and unfinished carts
 *  (the phone only from a field the site marked with data-ok-phone, with a consent line under it).
 *  <script src="https://oneknight.pro/ok.js" data-key="sk_..." defer></script> */
(function () {
  var s = document.currentScript;
  // "Do Not Track" turns analytics off.
  var dnt = navigator.doNotTrack === "1";
  if (!s || !s.dataset.key) {
    window.oneknight = { track: function () {}, context: function () { return null; }, cart: function () {} };
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

  // Unfinished carts: <input data-ok-phone>, optional <input data-ok-name>, and the cart as JSON in
  // data-ok-cart='[{"id":"<product id>","qty":1}]' (or oneknight.cart([...]) from the site's code).
  var cartApi = new URL(s.src).origin + "/api/public/carts";
  var items = null;
  var timer = 0;
  function field(sel) { var el = document.querySelector(sel); return el && el.value ? String(el.value).trim() : ""; }
  function cartNow() {
    if (items) return items;
    var el = document.querySelector("[data-ok-cart]");
    if (!el) return null;
    try { var v = JSON.parse(el.getAttribute("data-ok-cart") || "[]"); return Array.isArray(v) ? v : null; } catch (e) { return null; }
  }
  function sendCart() {
    var phone = field("[data-ok-phone]");
    var list = cartNow();
    if (!list || phone.replace(/\D/g, "").length < 10) return;
    var body = JSON.stringify({ session: session, phone: phone.slice(0, 20), name: field("[data-ok-name]").slice(0, 100) || undefined, items: list.slice(0, 50).map(function (i) { return { id: String(i.id), qty: Math.max(1, Math.min(99, parseInt(i.qty, 10) || 1)) }; }) });
    if (body === get("ok_cart")) return;
    set("ok_cart", body);
    try {
      fetch(cartApi, { method: "POST", keepalive: true, headers: { "content-type": "application/json", "x-site-key": key }, body: body }).catch(function () {});
    } catch (e) {}
  }
  function later() { clearTimeout(timer); timer = setTimeout(sendCart, 800); }
  document.addEventListener("change", function (e) { if (e.target && e.target.matches && e.target.matches("[data-ok-phone], [data-ok-name]")) later(); }, true);
  document.addEventListener("input", function (e) { if (e.target && e.target.matches && e.target.matches("[data-ok-phone]")) later(); }, true);
  if (window.MutationObserver) new MutationObserver(later).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-ok-cart"] });

  window.oneknight = {
    /** Call when a visitor submits a request form: oneknight.track(). */
    track: function () { send("lead"); },
    /** Pass as `analytics` with POST /api/public/orders to attribute the order to its source. */
    context: function () { var c = { session: session }; for (var k in ctx) c[k] = ctx[k]; return c; },
    /** The current cart from the site's code: oneknight.cart([{ id: "<product id>", qty: 2 }]). */
    cart: function (list) { items = Array.isArray(list) ? list : null; later(); },
  };
})();
