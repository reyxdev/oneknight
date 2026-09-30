/*! ONEKNIGHT widgets, loaded by ok.js only when switched on in the panel: social proof, reviews, stars,
 *  «Зроблено на ONEKNIGHT». Everything is built with textContent: nothing from the API becomes HTML. */
(function () {
  var W = window.oneknight && window.oneknight._w;
  if (!W || window.oneknight._wLoaded) return;
  window.oneknight._wLoaded = true;
  var en = /^en/i.test(document.documentElement.lang || "");
  var T = en
    ? { ordered: "New order", ago: function (m) { return m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago"; }, close: "Close", reviews: function (n) { return n + (n === 1 ? " review" : " reviews"); }, reply: "Store reply", by: "Made with ONEKNIGHT", verified: "bought here" }
    : { ordered: "Нове замовлення", ago: function (m) { return m < 60 ? m + " хв тому" : Math.round(m / 60) + " год тому"; }, close: "Закрити", reviews: function (n) { var d = n % 10, h = n % 100; return n + (d === 1 && h !== 11 ? " відгук" : d >= 2 && d <= 4 && (h < 12 || h > 14) ? " відгуки" : " відгуків"); }, reply: "Відповідь магазину", by: "Зроблено на ONEKNIGHT", verified: "купував(ла) тут" };
  function get(path) {
    return fetch(W.origin + "/api/public" + path, { headers: { "x-site-key": W.key } }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function stars(n) {
    var s = el("span", "okw-stars");
    s.setAttribute("aria-label", n + "/5");
    s.textContent = "★★★★★".slice(0, Math.round(n)) + "☆☆☆☆☆".slice(0, 5 - Math.round(n));
    return s;
  }
  var css = el("style");
  css.textContent =
    ".okw-sp{position:fixed;left:16px;bottom:16px;z-index:2147483000;display:flex;gap:10px;align-items:center;max-width:min(340px,calc(100vw - 32px));padding:10px 36px 10px 10px;border-radius:14px;background:#fff;color:#111;box-shadow:0 8px 28px rgba(0,0,0,.18);font:inherit;font-size:14px;line-height:1.35;opacity:0;transform:translateY(12px);transition:opacity .3s,transform .3s}" +
    ".okw-sp[data-on]{opacity:1;transform:none}.okw-sp img{width:48px;height:48px;border-radius:10px;object-fit:cover;flex:none}.okw-sp b{display:block}.okw-sp small{color:#666}" +
    ".okw-sp button{position:absolute;top:6px;right:8px;border:0;background:none;font-size:18px;line-height:1;cursor:pointer;color:#666}" +
    ".okw-stars{color:#f5a623;letter-spacing:1px}.okw-rating{display:inline-flex;gap:6px;align-items:center;font:inherit}" +
    ".okw-reviews{display:grid;gap:12px;font:inherit}.okw-review{padding:12px 14px;border-radius:12px;border:1px solid rgba(0,0,0,.1)}.okw-review p{margin:6px 0 0;white-space:pre-wrap}" +
    ".okw-review small{opacity:.7}.okw-reply{margin-top:8px;padding-left:10px;border-left:3px solid rgba(0,0,0,.15)}" +
    ".okw-by{display:block;text-align:center;padding:12px;font-size:12px;opacity:.7;color:inherit}" +
    "@media (prefers-reduced-motion:reduce){.okw-sp{transition:none}}";
  document.head.appendChild(css);

  // Social proof: real orders of 48 hours, one at a time, at most every 45 s; closed until the end of the visit.
  if (W.cfg.socialProof && !sessionStorage.getItem("okw_sp_closed")) {
    get("/social-proof").then(function (list) {
      if (!list || !list.length) return;
      var i = 0;
      var box = el("div", "okw-sp");
      box.setAttribute("role", "status");
      var close = el("button", "", "×");
      close.setAttribute("aria-label", T.close);
      close.onclick = function () { box.remove(); clearInterval(timer); try { sessionStorage.setItem("okw_sp_closed", "1"); } catch (e) {} };
      document.body.appendChild(box);
      function show() {
        var x = list[i++ % list.length];
        while (box.firstChild) box.removeChild(box.firstChild);
        if (x.photo) { var img = el("img"); img.src = W.origin + x.photo; img.alt = ""; box.appendChild(img); }
        var t = el("span");
        t.appendChild(el("small", "", T.ordered));
        t.appendChild(el("b", "", x.product));
        t.appendChild(el("small", "", x.name + (x.city ? ", " + x.city : "") + " · " + T.ago(x.minutes)));
        box.appendChild(t);
        box.appendChild(close);
        box.setAttribute("data-on", "");
        setTimeout(function () { box.removeAttribute("data-on"); }, 8000);
      }
      // Not earlier than 8 s after the page (owner's decision H55).
      setTimeout(show, 8000);
      var timer = setInterval(show, 45000);
    });
  }

  // Stars: <span data-ok-stars></span> → ★★★★★ 4.8 · 23 відгуки.
  if (W.cfg.stars || W.cfg.reviews) {
    get("/reviews/summary").then(function (s) {
      if (!s || !s.count) return;
      if (W.cfg.stars)
        document.querySelectorAll("[data-ok-stars]").forEach(function (node) {
          var r = el("span", "okw-rating");
          r.appendChild(stars(s.average));
          r.appendChild(el("span", "", String(s.average).replace(".", en ? "." : ",") + " · " + T.reviews(s.count)));
          node.textContent = "";
          node.appendChild(r);
        });
    });
  }

  // Reviews: <div data-ok-reviews></div> → the latest published reviews with the store's replies.
  if (W.cfg.reviews) {
    var spots = document.querySelectorAll("[data-ok-reviews]");
    if (spots.length)
      get("/reviews").then(function (list) {
        if (!list) return;
        spots.forEach(function (node) {
          var limit = Number(node.getAttribute("data-ok-reviews")) || 10;
          var wrap = el("div", "okw-reviews");
          list.slice(0, limit).forEach(function (r) {
            var card = el("article", "okw-review");
            var head = el("div");
            head.appendChild(stars(r.rating));
            head.appendChild(el("b", "", " " + r.name));
            head.appendChild(el("small", "", " · " + new Date(r.date).toLocaleDateString(en ? "en-GB" : "uk-UA") + (r.verified ? " · " + T.verified : "")));
            card.appendChild(head);
            if (r.text) card.appendChild(el("p", "", r.text));
            if (r.reply) {
              var rep = el("div", "okw-reply");
              rep.appendChild(el("small", "", T.reply));
              rep.appendChild(el("p", "", r.reply.text));
              card.appendChild(rep);
            }
            wrap.appendChild(card);
          });
          node.textContent = "";
          node.appendChild(wrap);
        });
      });
  }

  // «Зроблено на ONEKNIGHT» at the bottom, when the business wants it.
  if (W.cfg.poweredBy) {
    var a = el("a", "okw-by", T.by);
    a.href = "https://oneknight.pro/";
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
  }
})();
