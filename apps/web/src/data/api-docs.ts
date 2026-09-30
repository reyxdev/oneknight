/**
 * Public API documentation (the /api/public/* routes and ok.js), Ukrainian first, English second.
 * Written from the code: apps/api/src/public/routes.ts, reviews/, analytics/, carts/, security/guard.ts, app.ts,
 * apps/web/public/ok.js and ok-widgets.js. When those change, change this file too.
 */

export type DocBlock =
  | { kind: "p"; uk: string; en: string }
  | { kind: "list"; uk: string[]; en: string[] }
  | { kind: "endpoint"; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; uk: string; en: string }
  | { kind: "fields"; rows: { name: string; type: string; uk: string; en: string }[] }
  | { kind: "code"; lang: "json" | "html" | "http"; code: string }
  | { kind: "examples"; js: string; curl: string; php: string };

export type DocSection = {
  id: "start" | "key" | "products" | "orders" | "reviews" | "pages" | "okjs" | "webhooks" | "errors";
  uk: string;
  en: string;
  blocks: DocBlock[];
};

const BASE = "https://oneknight.pro/api/public";

/** Short GET examples in the three languages. */
function getExamples(path: string, js: string, php: string): DocBlock {
  return {
    kind: "examples",
    js: `const res = await fetch("${BASE}${path}", {
  headers: { "x-site-key": "YOUR_SITE_KEY" },
});
const data = await res.json();
${js}`,
    curl: `curl -H "x-site-key: YOUR_SITE_KEY" ${BASE}${path}`,
    php: `<?php
$ctx = stream_context_create(["http" => [
  "header" => ["x-site-key: YOUR_SITE_KEY"],
]]);
$data = json_decode(file_get_contents("${BASE}${path}", false, $ctx), true);
${php}`,
  };
}

/** Short POST examples: the same JSON body in the three languages (`jsBody`: a JS expression, defaults to the JSON). */
function postExamples(path: string, json: string, js: string, php: string, jsBody = json): DocBlock {
  const oneLine = JSON.stringify(JSON.parse(json));
  return {
    kind: "examples",
    js: `const res = await fetch("${BASE}${path}", {
  method: "POST",
  headers: { "content-type": "application/json", "x-site-key": "YOUR_SITE_KEY" },
  body: JSON.stringify(${jsBody.replace(/\n/g, "\n  ")}),
});
${js}`,
    curl: `curl -X POST ${BASE}${path} \\
  -H "content-type: application/json" \\
  -H "x-site-key: YOUR_SITE_KEY" \\
  -d '${oneLine}'`,
    php: `<?php
$body = '${oneLine}';
$ctx = stream_context_create(["http" => [
  "method" => "POST",
  "header" => ["content-type: application/json", "x-site-key: YOUR_SITE_KEY"],
  "content" => $body,
  "ignore_errors" => true, // read the JSON of 4xx answers too
]]);
$raw = file_get_contents("${BASE}${path}", false, $ctx);
$status = (int) explode(" ", $http_response_header[0])[1];
${php}`,
  };
}

/** In the browser: the order with the traffic source from ok.js (only when there is one; null is refused). */
const ORDER_BODY = `{
  customer: { name: "Олена", phone: "+380671112233" },
  items: [{ productId: "PRODUCT_ID", qty: 2 }],
  delivery: { method: "novaposhta", city: "Львів", branch: "5" },
  payment: "cod",
  ...(window.oneknight?.context() ? { analytics: window.oneknight.context() } : {}),
}`;

const ORDER_JSON = `{
  "customer": { "name": "Олена", "phone": "+380671112233" },
  "items": [{ "productId": "PRODUCT_ID", "qty": 2 }],
  "delivery": { "method": "novaposhta", "city": "Львів", "branch": "5" },
  "payment": "cod"
}`;

const REVIEW_JSON = `{
  "name": "Оксана",
  "rating": 5,
  "text": "Все прийшло вчасно, дякую!",
  "consent": true
}`;

export const apiDocs: DocSection[] = [
  {
    id: "start",
    uk: "Початок роботи",
    en: "Getting started",
    blocks: [
      {
        kind: "p",
        uk: "API дає вашому сайту товари й відгуки з кабінету ONEKNIGHT і приймає з сайту замовлення, відгуки, кошики та події аналітики.",
        en: "The API gives your website the products and reviews from the ONEKNIGHT account and takes orders, reviews, carts and analytics events from the site.",
      },
      {
        kind: "list",
        uk: [
          "Базова адреса: https://oneknight.pro/api/public",
          "Ключ сайту: кабінет «Сайт → API й ok.js».",
          "Формат: JSON. Для запитів з тілом потрібен заголовок content-type: application/json.",
          "Без cookies і входу: сайт визначається лише за ключем.",
          "Ціни в гривнях, звичайним числом (наприклад, 1100 або 249.5).",
          "Дати в форматі ISO 8601 (UTC).",
        ],
        en: [
          "Base URL: https://oneknight.pro/api/public",
          "Site key: in the account, «Сайт → API й ok.js» (Site → API and ok.js).",
          "Format: JSON. Requests with a body need the content-type: application/json header.",
          "No cookies and no login: the site is identified by its key only.",
          "Prices are in hryvnias as plain numbers (e.g. 1100 or 249.5).",
          "Dates are ISO 8601 (UTC).",
        ],
      },
      {
        kind: "code",
        lang: "http",
        code: `GET /api/public/products HTTP/1.1
Host: oneknight.pro
x-site-key: YOUR_SITE_KEY`,
      },
      {
        kind: "p",
        uk: "Є два входи. /api/public — для браузера (ok.js, сторінки сайту) з публічним ключем. /api/v1 — для сервера вашого сайту з секретним ключем: ті самі товари, категорії й замовлення, плюс сторінка замовлення за номером. /v1 — версія: несумісні зміни підуть у /v2, а /v1 працюватиме ще щонайменше 6 місяців.",
        en: "There are two entry points. /api/public is for the browser (ok.js, site pages) with the public key. /api/v1 is for your site's server with the secret key: the same products, categories and orders, plus an order's page data by number. /v1 is a version: breaking changes go to /v2, and /v1 keeps working for at least 6 months.",
      },
    ],
  },

  {
    id: "key",
    uk: "Ключ сайту",
    en: "Site key",
    blocks: [
      {
        kind: "p",
        uk: "Ключ має вигляд sk_ і 32 символи 0-9 та a-f. У прикладах замість нього стоїть YOUR_SITE_KEY.",
        en: "The key looks like sk_ followed by 32 characters 0-9 and a-f. The examples use YOUR_SITE_KEY instead.",
      },
      {
        kind: "list",
        uk: [
          "Заголовок x-site-key: YOUR_SITE_KEY (так робить ok.js).",
          "Або параметр в адресі: /api/public/products?key=YOUR_SITE_KEY. Якщо є обидва, діє заголовок.",
          "Ключа немає, він іншого вигляду чи не знайдений: 401 { \"error\": \"invalid_site_key\" }.",
        ],
        en: [
          "Header x-site-key: YOUR_SITE_KEY (this is what ok.js does).",
          "Or a query parameter: /api/public/products?key=YOUR_SITE_KEY. When both are present, the header wins.",
          "Missing, malformed or unknown key: 401 { \"error\": \"invalid_site_key\" }.",
        ],
      },
      {
        kind: "p",
        uk: "Ключ не секретний: він стоїть у коді ok.js на кожній сторінці. Сайт захищає перевірка домену та ліміти запитів.",
        en: "The key is not a secret: it sits in the ok.js tag on every page. The site is protected by the domain check and rate limits.",
      },
      {
        kind: "list",
        uk: [
          "Браузер додає до запиту заголовок Origin. Дозволені лише https://ваш-домен і https://www.ваш-домен сайту, якому належить ключ.",
          "Інший домен або http:// без s: 403 { \"error\": \"bad_origin\" }.",
          "Запити з вашого сервера (PHP, Node.js, curl) не мають Origin і дозволені.",
          "Попередній запит браузера (OPTIONS) дозволяє методи GET, POST і заголовки content-type, x-site-key.",
        ],
        en: [
          "The browser adds an Origin header. Only https://your-domain and https://www.your-domain of the site that owns the key are allowed.",
          "Any other domain, or plain http://: 403 { \"error\": \"bad_origin\" }.",
          "Requests from your server (PHP, Node.js, curl) have no Origin and are allowed.",
          "The browser preflight (OPTIONS) allows the GET and POST methods and the content-type and x-site-key headers.",
        ],
      },
      {
        kind: "p",
        uk: "Ключ можна замінити в кабінеті кнопкою «Замінити ключ». Старий ключ перестає працювати одразу, тому відразу оновіть його на сайті.",
        en: "The key can be replaced in the account with «Замінити ключ» (Replace key). The old key stops working at once, so update it on the site right away.",
      },
      {
        kind: "p",
        uk: "Секретний ключ (ok_sec_…) — для сервера сайту. Його створює власник бізнесу в «Сайт → API й ok.js», показується один раз, у базі зберігається лише хеш. Надсилайте його в заголовку Authorization: Bearer. Запит, зроблений браузером (із заголовком Origin, Sec-Fetch-Site чи Sec-Fetch-Dest), із секретним ключем відхиляється з 403 secret_key_in_browser. Після заміни старий ключ працює ще 24 години. Ліміти — на сайт, а не на IP: 600 запитів за хвилину на читання, 300 замовлень за 10 хвилин.",
        en: "The secret key (ok_sec_…) is for the site's server. The business owner creates it in «Сайт → API й ok.js»; it is shown once and only its hash is stored. Send it as Authorization: Bearer. A request made by a browser (with an Origin, Sec-Fetch-Site or Sec-Fetch-Dest header) carrying the secret key is refused with 403 secret_key_in_browser. After a replacement the old key keeps working for 24 hours. Limits are per site, not per IP: 600 reads a minute, 300 orders per 10 minutes.",
      },
      { kind: "endpoint", method: "GET", path: "/api/v1/site", uk: "Сайт і бізнес, до яких належить ключ: id, domain, name, business, verified, publicKey.", en: "The site and business the key belongs to: id, domain, name, business, verified, publicKey." },
      { kind: "endpoint", method: "GET", path: "/api/v1/products · /api/v1/products/{id} · /api/v1/categories", uk: "Те саме, що в /api/public, але з секретним ключем і без перевірки домену.", en: "The same as in /api/public, but with the secret key and without the domain check." },
      { kind: "endpoint", method: "POST", path: "/api/v1/orders", uk: "Те саме тіло, що в /api/public/orders, плюс необов'язковий customerIp — IP покупця для запису в замовленні.", en: "The same body as /api/public/orders, plus an optional customerIp — the buyer's IP kept with the order." },
      { kind: "endpoint", method: "GET", path: "/api/v1/orders/{number}", uk: "Замовлення цього сайту за номером — для сторінки «Ваше замовлення»: status, statusName, paymentStatus, prepaid, total, items, delivery, payment, waybill, createdAt, history.", en: "This site's order by number — for a «Your order» page: status, statusName, paymentStatus, prepaid, total, items, delivery, payment, waybill, createdAt, history." },
      {
        kind: "examples",
        js: `// Node.js, on the site's server (the key comes from the environment)
const res = await fetch("https://oneknight.pro/api/v1/products", {
  headers: { authorization: \`Bearer \${process.env.ONEKNIGHT_SECRET_KEY}\` },
});
const products = await res.json();`,
        curl: `curl https://oneknight.pro/api/v1/products \\
  -H "Authorization: Bearer $ONEKNIGHT_SECRET_KEY"`,
        php: `<?php
$ctx = stream_context_create(["http" => [
  "header" => "Authorization: Bearer " . getenv("ONEKNIGHT_SECRET_KEY"),
]]);
$products = json_decode(file_get_contents("https://oneknight.pro/api/v1/products", false, $ctx), true);`,
      },
    ],
  },

  {
    id: "products",
    uk: "Товари й категорії",
    en: "Products and categories",
    blocks: [
      {
        kind: "endpoint",
        method: "GET",
        path: "/products",
        uk: "Усі товари сайту з позначкою «Показувати на сайті», крім архівних, у порядку з кабінету. Параметрів і сторінок немає: приходить увесь список.",
        en: "All products of the site marked «Показувати на сайті» (Show on the site), except archived ones, in the order set in the account. No parameters and no paging: the whole list comes at once.",
      },
      {
        kind: "fields",
        rows: [
          { name: "id", type: "string (uuid)", uk: "Ідентифікатор товару. Його передають у замовленні та кошику.", en: "Product id. Used in orders and carts." },
          { name: "sku", type: "string | null", uk: "Артикул.", en: "SKU." },
          { name: "name", type: "string", uk: "Назва.", en: "Name." },
          { name: "description", type: "string", uk: "Опис, може бути порожнім рядком.", en: "Description, may be an empty string." },
          { name: "categoryId", type: "string | null", uk: "Категорія з GET /categories.", en: "Category from GET /categories." },
          { name: "price", type: "number", uk: "Ціна в гривнях.", en: "Price in UAH." },
          { name: "oldPrice", type: "number | null", uk: "Стара (закреслена) ціна. Лише коли вона більша за price.", en: "Old (crossed out) price. Only when it is higher than price." },
          { name: "discountPercent", type: "number | null", uk: "Знижка у відсотках, округлена. Є разом з oldPrice.", en: "Discount in percent, rounded. Present together with oldPrice." },
          { name: "availability", type: "string", uk: "in_stock (в наявності), to_order (під замовлення), expected (очікується), out (немає). Товар «в наявності» із залишком 0 приходить як out.", en: "in_stock, to_order (made to order), expected, out. An in_stock product with stock 0 comes as out." },
          { name: "orderDays", type: "number | null", uk: "За скільки днів виготовлять товар. Лише для to_order.", en: "Days to make the product. Only for to_order." },
          { name: "inStock", type: "boolean", uk: "Чи можна замовити зараз: true для in_stock і to_order.", en: "Whether it can be ordered now: true for in_stock and to_order." },
          { name: "stock", type: "number | null", uk: "Залишок у штуках. null: залишок не ведеться.", en: "Stock in pieces. null: stock is not tracked." },
          { name: "fewLeft", type: "boolean", uk: "«Залишилось мало»: товар в наявності і залишок не більший за поріг з кабінету (типово 2).", en: "«Few left»: in stock and the stock is at or below the threshold set in the account (2 by default)." },
          { name: "photo", type: "string | null", uk: "Головне фото: відносний шлях /api/files/...", en: "Main photo: a relative path /api/files/..." },
          { name: "photos", type: "string[]", uk: "Усі фото в порядку з кабінету, теж відносні шляхи.", en: "All photos in the account's order, also relative paths." },
          { name: "attributes", type: "{ name, value }[]", uk: "Характеристики: пари назва й значення.", en: "Attributes: name and value pairs." },
          { name: "warrantyMonths", type: "number | null", uk: "Гарантія в місяцях.", en: "Warranty in months." },
          { name: "weightG", type: "number | null", uk: "Вага в грамах.", en: "Weight in grams." },
        ],
      },
      {
        kind: "p",
        uk: "Шляхи фото відносні: повна адреса це https://oneknight.pro + photo. Собівартість, пороги й історія товару в API не потрапляють.",
        en: "Photo paths are relative: the full URL is https://oneknight.pro + photo. Cost, thresholds and product history never appear in the API.",
      },
      {
        kind: "code",
        lang: "json",
        code: `[
  {
    "id": "5f0c7a52-2b1e-4c3e-9a41-0d7e6f1b2a90",
    "sku": "HL-01",
    "name": "Хлібниця «Маки»",
    "description": "",
    "categoryId": null,
    "price": 1100,
    "oldPrice": 1300,
    "discountPercent": 15,
    "availability": "in_stock",
    "orderDays": null,
    "inStock": true,
    "stock": 2,
    "fewLeft": true,
    "photo": "/api/files/9b1d3c1e-7a2f-4f7e-8c55-3e2a1f0d4b6c",
    "photos": ["/api/files/9b1d3c1e-7a2f-4f7e-8c55-3e2a1f0d4b6c"],
    "attributes": [{ "name": "Матеріал", "value": "Дерево" }],
    "warrantyMonths": null,
    "weightG": 800
  }
]`,
      },
      getExamples(
        "/products",
        `for (const p of data) console.log(p.name, p.price, p.inStock);`,
        `foreach ($data as $p) {
  echo $p["name"] . ": " . $p["price"] . " грн" . PHP_EOL;
}`,
      ),
      {
        kind: "endpoint",
        method: "GET",
        path: "/categories",
        uk: "Категорії каталогу в порядку з кабінету. Це дерево: вкладені категорії мають parentId.",
        en: "Catalogue categories in the account's order. It is a tree: nested categories have parentId.",
      },
      {
        kind: "fields",
        rows: [
          { name: "id", type: "string (uuid)", uk: "Ідентифікатор категорії (categoryId у товарі).", en: "Category id (categoryId of a product)." },
          { name: "name", type: "string", uk: "Назва.", en: "Name." },
          { name: "parentId", type: "string | null", uk: "Батьківська категорія. null: верхній рівень.", en: "Parent category. null: top level." },
        ],
      },
      getExamples(
        "/categories",
        `const top = data.filter((c) => c.parentId === null);`,
        `$top = array_filter($data, fn($c) => $c["parentId"] === null);`,
      ),
    ],
  },

  {
    id: "orders",
    uk: "Замовлення",
    en: "Orders",
    blocks: [
      {
        kind: "endpoint",
        method: "POST",
        path: "/orders",
        uk: "Створює замовлення. Воно одразу з'являється в кабінеті зі статусом new.",
        en: "Creates an order. It appears in the account at once with the status new.",
      },
      {
        kind: "fields",
        rows: [
          { name: "customer.name", type: "string", uk: "Ім'я покупця, від 2 до 100 символів.", en: "Buyer's name, 2 to 100 characters." },
          { name: "customer.phone", type: "string", uk: "Телефон: 9-20 символів, цифри, пробіли, дужки, дефіс, можна + на початку.", en: "Phone: 9-20 characters, digits, spaces, brackets, dashes, an optional leading +." },
          { name: "customer.email", type: "string?", uk: "Email, необов'язково (можна порожній рядок).", en: "Email, optional (an empty string is fine)." },
          { name: "items", type: "{ productId, qty }[]", uk: "Від 1 до 50 рядків. productId з GET /products, qty від 1 до 99. Однакові товари додаються разом.", en: "1 to 50 lines. productId from GET /products, qty 1 to 99. Lines with the same product are added up." },
          { name: "delivery.method", type: "string", uk: "novaposhta (Нова пошта), ukrposhta (Укрпошта), pickup (самовивіз), courier (кур'єр).", en: "novaposhta (Nova Poshta), ukrposhta (Ukrposhta), pickup, courier." },
          { name: "delivery.city", type: "string?", uk: "Місто, до 100 символів.", en: "City, up to 100 characters." },
          { name: "delivery.branch", type: "string?", uk: "Відділення, до 200 символів.", en: "Branch, up to 200 characters." },
          { name: "delivery.address", type: "string?", uk: "Адреса, до 300 символів.", en: "Address, up to 300 characters." },
          { name: "payment", type: "string", uk: "cod (при отриманні), iban (переказ на рахунок), card (карткою).", en: "cod (cash on delivery), iban (bank transfer), card." },
          { name: "comment", type: "string?", uk: "Коментар, до 1000 символів.", en: "Comment, up to 1000 characters." },
          { name: "website", type: "string?", uk: "Пастка для ботів: приховане поле форми. Має бути порожнім або відсутнім.", en: "Bot trap: a hidden form field. Must be empty or absent." },
          { name: "analytics", type: "object?", uk: "Результат oneknight.context() з ok.js: пов'язує замовлення з джерелом трафіку. Не передавайте null.", en: "The result of oneknight.context() from ok.js: ties the order to its traffic source. Do not send null." },
        ],
      },
      {
        kind: "list",
        uk: [
          "Місто, відділення й адреса не обов'язкові для жодного способу доставки: перевіряйте їх у своїй формі.",
          "Назви й ціни ONEKNIGHT бере з каталогу, а не із запиту.",
          "Замовити можна лише товари з inStock: true (in_stock і to_order). Інші дають 409 unavailable.",
          "Якщо залишок ведеться, його перевіряють і зменшують разом зі створенням замовлення. Не вистачає: 409 out_of_stock.",
          "Незавершені кошики з тим самим телефоном або сесією ok.js закриваються цим замовленням.",
        ],
        en: [
          "City, branch and address are optional for every delivery method: check them in your own form.",
          "ONEKNIGHT takes names and prices from the catalogue, never from the request.",
          "Only products with inStock: true (in_stock and to_order) can be ordered. Others give 409 unavailable.",
          "When stock is tracked, it is checked and reduced together with creating the order. Not enough: 409 out_of_stock.",
          "Unfinished carts with the same phone or ok.js session are closed by this order.",
        ],
      },
      { kind: "code", lang: "json", code: ORDER_JSON },
      {
        kind: "p",
        uk: "Успіх: 201 з номером замовлення, сумою в гривнях і статусом.",
        en: "Success: 201 with the order number, the total in UAH and the status.",
      },
      { kind: "code", lang: "json", code: `{ "number": 1041, "total": 2200, "status": "new" }` },
      {
        kind: "fields",
        rows: [
          { name: "400", type: "invalid_input", uk: "Тіло не пройшло перевірку (поле відсутнє, задовге, невідоме значення, заповнене website).", en: "The body failed validation (missing or too long field, unknown value, filled website)." },
          { name: "409", type: "unknown_product", uk: "Товару немає на сайті, він прихований або в архіві. Тіло: { \"ok\": false, \"error\": \"unknown_product\" }.", en: "The product is not on the site, hidden or archived. Body: { \"ok\": false, \"error\": \"unknown_product\" }." },
          { name: "409", type: "out_of_stock", uk: "Не вистачає залишку. Тіло містить productId.", en: "Not enough stock. The body has productId." },
          { name: "409", type: "unavailable", uk: "Товар expected або out. Тіло містить productId.", en: "The product is expected or out. The body has productId." },
          { name: "429", type: "too_many_requests", uk: "Понад 10 замовлень за 10 хвилин з однієї IP-адреси.", en: "More than 10 orders in 10 minutes from one IP address." },
        ],
      },
      { kind: "code", lang: "json", code: `{ "ok": false, "error": "out_of_stock", "productId": "5f0c7a52-2b1e-4c3e-9a41-0d7e6f1b2a90" }` },
      {
        kind: "p",
        uk: "Ліміт рахується за IP-адресою. Якщо замовлення надсилає ваш сервер, усі вони йдуть з його адреси і ділять один ліміт.",
        en: "The limit is per IP address. If your server sends the orders, they all come from its address and share one limit.",
      },
      postExamples(
        "/orders",
        ORDER_JSON,
        `const data = await res.json();
if (res.status === 201) alert("Замовлення №" + data.number);
else console.warn(res.status, data.error);`,
        `$data = json_decode($raw, true);
if ($status === 201) echo "Замовлення №" . $data["number"];
else echo "Помилка: " . $data["error"];`,
        ORDER_BODY,
      ),
    ],
  },

  {
    id: "reviews",
    uk: "Відгуки",
    en: "Reviews",
    blocks: [
      {
        kind: "p",
        uk: "Потрібен модуль «Відгуки». Без нього всі адреси цього розділу відповідають 403 { \"error\": \"module_not_active\" }.",
        en: "The «Відгуки» (Reviews) module is required. Without it every address in this section answers 403 { \"error\": \"module_not_active\" }.",
      },
      {
        kind: "endpoint",
        method: "GET",
        path: "/reviews",
        uk: "Опубліковані відгуки сайту, спершу нові. Не більше 100.",
        en: "Published reviews of the site, newest first. At most 100.",
      },
      {
        kind: "fields",
        rows: [
          { name: "id", type: "string (uuid)", uk: "Ідентифікатор відгуку.", en: "Review id." },
          { name: "name", type: "string", uk: "Ім'я автора.", en: "Author's name." },
          { name: "rating", type: "number", uk: "Оцінка від 1 до 5.", en: "Rating 1 to 5." },
          { name: "text", type: "string", uk: "Текст.", en: "Text." },
          { name: "verified", type: "boolean", uk: "Підтверджена покупка (див. orderNumber нижче).", en: "Verified purchase (see orderNumber below)." },
          { name: "product", type: "{ id, name } | null", uk: "Товар, про який відгук.", en: "The product the review is about." },
          { name: "photo", type: "string | null", uk: "Фото, відносний шлях /api/files/...", en: "Photo, a relative path /api/files/..." },
          { name: "videoUrl", type: "string | null", uk: "Посилання на відео (https).", en: "Video link (https)." },
          { name: "date", type: "string", uk: "Дата відгуку.", en: "Review date." },
          { name: "reply", type: "{ text, date } | null", uk: "Публічна відповідь магазину.", en: "The store's public reply." },
          { name: "source", type: "string", uk: "Звідки відгук: site або назва майданчика імпорту (наприклад, rozetka).", en: "Where the review came from: site or the import marketplace (e.g. rozetka)." },
        ],
      },
      getExamples(
        "/reviews",
        `for (const r of data) console.log(r.rating, r.name, r.text);`,
        `foreach ($data as $r) {
  echo str_repeat("★", $r["rating"]) . " " . $r["name"] . PHP_EOL;
}`,
      ),
      {
        kind: "endpoint",
        method: "POST",
        path: "/reviews",
        uk: "Новий відгук з сайту.",
        en: "A new review from the site.",
      },
      {
        kind: "fields",
        rows: [
          { name: "name", type: "string", uk: "Ім'я, від 2 до 100 символів.", en: "Name, 2 to 100 characters." },
          { name: "rating", type: "number", uk: "Ціле число від 1 до 5.", en: "Integer 1 to 5." },
          { name: "text", type: "string", uk: "Текст, від 3 до 3000 символів.", en: "Text, 3 to 3000 characters." },
          { name: "consent", type: "boolean", uk: "Згода на публікацію. Без неї відгук зберігається, але опублікувати його не можна.", en: "Consent to publish. Without it the review is stored but can never be published." },
          { name: "productId", type: "string?", uk: "Товар цього сайту. Чужий або невідомий ідентифікатор просто ігнорується.", en: "A product of this site. An unknown id is simply ignored." },
          { name: "photo", type: "{ name?, data }?", uk: "Фото: data у base64 або як data:-адреса. PNG, JPEG або WebP, до 4 МБ.", en: "Photo: data as base64 or a data: URL. PNG, JPEG or WebP, up to 4 MB." },
          { name: "videoUrl", type: "string?", uk: "Посилання на відео, лише https://, до 500 символів.", en: "Video link, https:// only, up to 500 characters." },
          { name: "orderNumber", type: "number?", uk: "Номер замовлення для позначки «купував(ла) тут».", en: "Order number for the «bought here» mark." },
          { name: "phone", type: "string?", uk: "Телефон з цього замовлення, до 30 символів.", en: "The phone used in that order, up to 30 characters." },
          { name: "website", type: "string?", uk: "Пастка для ботів, має бути порожнім або відсутнім.", en: "Bot trap, must be empty or absent." },
        ],
      },
      {
        kind: "list",
        uk: [
          "orderNumber разом з телефоном того замовлення (збіг останніх 9 цифр) роблять відгук підтвердженим, якщо замовлення не скасоване. Якщо товар не вказано, а в замовленні один товар, відгук прив'язується до нього.",
          "Модерацію вмикають у кабінеті. Коли вона вимкнена, відгук зі згодою публікується одразу, інакше чекає на перевірку.",
          "Фото стає публічним лише разом з публікацією відгуку.",
        ],
        en: [
          "orderNumber together with the phone of that order (the last 9 digits match) makes the review verified, unless the order is cancelled. If no product is given and the order has one product, the review is tied to it.",
          "Moderation is set in the account. When it is off, a review with consent is published at once, otherwise it waits for approval.",
          "The photo becomes public only when the review is published.",
        ],
      },
      { kind: "code", lang: "json", code: REVIEW_JSON },
      {
        kind: "p",
        uk: "Успіх: 201 { \"id\": \"...\", \"status\": \"pending\" | \"published\", \"verified\": true | false }. Помилки: 400 invalid_input, 400 unsupported_file (не PNG, JPEG чи WebP), 400 file_too_large (понад 4 МБ), 403 module_not_active, 429 (понад 5 відгуків за 10 хвилин з однієї IP-адреси). Тіло запиту до 7 МБ.",
        en: "Success: 201 { \"id\": \"...\", \"status\": \"pending\" | \"published\", \"verified\": true | false }. Errors: 400 invalid_input, 400 unsupported_file (not PNG, JPEG or WebP), 400 file_too_large (over 4 MB), 403 module_not_active, 429 (over 5 reviews in 10 minutes from one IP address). Request body up to 7 MB.",
      },
      postExamples(
        "/reviews",
        REVIEW_JSON,
        `const data = await res.json();
if (res.status === 201) console.log(data.status === "published" ? "Опубліковано" : "На перевірці");`,
        `$data = json_decode($raw, true);
echo $status === 201 ? $data["status"] : "Помилка: " . $data["error"];`,
      ),
      {
        kind: "endpoint",
        method: "GET",
        path: "/reviews/summary",
        uk: "Рейтинг сайту за опублікованими відгуками.",
        en: "The site's rating from published reviews.",
      },
      {
        kind: "fields",
        rows: [
          { name: "count", type: "number", uk: "Кількість опублікованих відгуків.", en: "Number of published reviews." },
          { name: "average", type: "number | null", uk: "Середня оцінка з одним знаком після крапки. null, коли відгуків немає.", en: "Average rating with one decimal. null when there are no reviews." },
        ],
      },
      getExamples(
        "/reviews/summary",
        `if (data.count) console.log(data.average + " / 5, " + data.count);`,
        `if ($data["count"]) echo $data["average"] . " / 5";`,
      ),
      {
        kind: "endpoint",
        method: "GET",
        path: "/reviews/schema",
        uk: "Готовий JSON-LD schema.org (тип Store) з рейтингом і 5 останніми відгуками. Вставте його в сторінку на своєму сервері в <script type=\"application/ld+json\">. Чи показувати зірки в пошуку, вирішує Google.",
        en: "Ready schema.org JSON-LD (type Store) with the rating and the 5 latest reviews. Put it into the page on your server inside <script type=\"application/ld+json\">. Google decides whether to show stars in search.",
      },
      {
        kind: "p",
        uk: "Поки опублікованих відгуків немає, приходять лише @context, @type, name і url.",
        en: "While there are no published reviews, only @context, @type, name and url come back.",
      },
      {
        kind: "code",
        lang: "json",
        code: `{
  "@context": "https://schema.org",
  "@type": "Store",
  "name": "Мій магазин",
  "url": "https://example.com/",
  "aggregateRating": { "@type": "AggregateRating", "ratingValue": 4.8, "reviewCount": 23, "bestRating": 5, "worstRating": 1 },
  "review": [
    {
      "@type": "Review",
      "author": { "@type": "Person", "name": "Оксана" },
      "datePublished": "2026-09-12",
      "reviewBody": "Все прийшло вчасно, дякую!",
      "reviewRating": { "@type": "Rating", "ratingValue": 5, "bestRating": 5, "worstRating": 1 }
    }
  ]
}`,
      },
      getExamples(
        "/reviews/schema",
        `// On your server (Node.js): put it into the page HTML.
const tag = '<script type="application/ld+json">' + JSON.stringify(data).replace(/</g, "\\\\u003c") + "</script>";`,
        `// Put it into the page <head>.
echo '<script type="application/ld+json">' . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG) . '</script>';`,
      ),
    ],
  },

  {
    id: "pages",
    uk: "Сторінки",
    en: "Pages",
    blocks: [
      {
        kind: "p",
        uk: "API для сторінок сайту (тексти, банери, меню) поки в розробці. Зараз API віддає лише товари, категорії, відгуки й налаштування віджетів.",
        en: "An API for site pages (texts, banners, menus) is in development. For now the API returns only products, categories, reviews and widget settings.",
      },
    ],
  },

  {
    id: "okjs",
    uk: "Скрипт ok.js",
    en: "The ok.js script",
    blocks: [
      {
        kind: "p",
        uk: "Вставте тег на кожну сторінку сайту. Готовий тег з вашим ключем є в кабінеті «Сайт → API й ok.js». Скрипт звертається до API з того ж домену, звідки завантажений.",
        en: "Put the tag on every page of the site. The ready tag with your key is in the account, «Сайт → API й ok.js». The script calls the API on the same domain it was loaded from.",
      },
      { kind: "code", lang: "html", code: `<script src="https://oneknight.pro/ok.js" data-key="YOUR_SITE_KEY" defer></script>` },
      {
        kind: "list",
        uk: [
          "Перегляди сторінок надсилаються самі, зокрема при переходах у односторінкових застосунках (history.pushState і кнопка «Назад»).",
          "Кліки на посилання tel:, viber:, tg:, t.me, telegram.me, whatsapp:, wa.me та api.whatsapp.com рахуються як контакти.",
          "Джерело візиту (utm_source, utm_medium, utm_campaign, utm_content і referrer) запам'ятовується з першої сторінки візиту.",
          "Без cookies: сесія й джерело лежать у sessionStorage і зникають разом із вкладкою.",
          "Якщо в браузері ввімкнено Do Not Track, події аналітики не надсилаються.",
          "Події зберігаються лише з модулем «Аналітика». Без нього сервер відповідає 204 і нічого не записує.",
          "Без data-key скрипт нічого не надсилає, а функції oneknight.* нічого не роблять.",
        ],
        en: [
          "Page views are sent automatically, including navigation in single-page apps (history.pushState and the Back button).",
          "Clicks on tel:, viber:, tg:, t.me, telegram.me, whatsapp:, wa.me and api.whatsapp.com links count as contacts.",
          "The visit source (utm_source, utm_medium, utm_campaign, utm_content and the referrer) is kept from the first page of the visit.",
          "No cookies: the session and the source live in sessionStorage and disappear with the tab.",
          "With Do Not Track on in the browser, analytics events are not sent.",
          "Events are stored only with the «Аналітика» (Analytics) module. Without it the server answers 204 and stores nothing.",
          "Without data-key the script sends nothing and the oneknight.* functions do nothing.",
        ],
      },
      {
        kind: "fields",
        rows: [
          { name: "data-key", type: "<script>", uk: "Ключ сайту. Обов'язковий.", en: "Site key. Required." },
          { name: "data-ok-product", type: "\"PRODUCT_ID\"", uk: "На сторінці товару: подія «перегляд товару», раз на сторінку.", en: "On a product page: a «product view» event, once per page." },
          { name: "data-ok-phone", type: "<input>", uk: "Поле телефону в кошику чи формі замовлення. З нього ok.js бере телефон для незавершеного кошика. Додайте під полем рядок про згоду.", en: "The phone field of the cart or checkout. ok.js takes the phone for the unfinished cart from it. Add a consent line under the field." },
          { name: "data-ok-name", type: "<input>", uk: "Поле імені, необов'язково.", en: "Name field, optional." },
          { name: "data-ok-cart", type: "JSON", uk: "Кошик як JSON: [{\"id\":\"PRODUCT_ID\",\"qty\":1}]. Зміни атрибута ok.js помічає сам.", en: "The cart as JSON: [{\"id\":\"PRODUCT_ID\",\"qty\":1}]. ok.js notices changes to the attribute itself." },
          { name: "data-ok-reviews", type: "\"10\"", uk: "Блок відгуків. Значення: скільки показати (типово 10).", en: "Reviews block. The value: how many to show (10 by default)." },
          { name: "data-ok-stars", type: "<span>", uk: "Зірки й кількість відгуків сайту, наприклад «★★★★★ 4,8 · 23 відгуки».", en: "Stars and the number of the site's reviews, e.g. «★★★★★ 4.8 · 23 reviews»." },
        ],
      },
      {
        kind: "fields",
        rows: [
          { name: "oneknight.track()", type: "function", uk: "Викличте після відправки форми заявки: подія «заявка».", en: "Call after a request form is sent: a «lead» event." },
          { name: "oneknight.context()", type: "function", uk: "Сесія й джерело візиту. Передайте як analytics у POST /orders. Без data-key повертає null.", en: "The session and visit source. Pass it as analytics in POST /orders. Returns null without data-key." },
          { name: "oneknight.cart(list)", type: "function", uk: "Поточний кошик з коду сайту: oneknight.cart([{ id: \"PRODUCT_ID\", qty: 2 }]). Замінює data-ok-cart.", en: "The current cart from the site's code: oneknight.cart([{ id: \"PRODUCT_ID\", qty: 2 }]). Replaces data-ok-cart." },
          { name: "oneknight.product(id)", type: "function", uk: "Відкрито сторінку товару в односторінковому застосунку.", en: "A product page was opened in a single-page app." },
        ],
      },
      {
        kind: "p",
        uk: "Незавершені кошики. Щойно в полі data-ok-phone щонайменше 10 цифр, ok.js надсилає кошик (через 0,8 с після останньої зміни, без повторів однакового). Якщо за 2 години замовлення немає, кошик з'являється в кабінеті для дзвінка. Кошики зберігаються 30 днів. Кожен товар, доданий у кошик, також дає подію аналітики «кошик», раз за візит.",
        en: "Unfinished carts. As soon as the data-ok-phone field has at least 10 digits, ok.js sends the cart (0.8 s after the last change, never the same one twice). If no order comes within 2 hours, the cart shows up in the account for a call. Carts are kept for 30 days. Each product added to the cart also gives a «cart» analytics event, once per visit.",
      },
      {
        kind: "code",
        lang: "html",
        code: `<div data-ok-cart='[{"id":"PRODUCT_ID","qty":1}]'></div>
<input name="phone" data-ok-phone>
<small>Залишаючи телефон, ви погоджуєтесь, що ми можемо зателефонувати щодо замовлення.</small>
<input name="name" data-ok-name>`,
      },
      {
        kind: "p",
        uk: "Віджети (соціальний доказ, відгуки, зірки, посилання «Зроблено на ONEKNIGHT») вмикають у кабінеті. ok.js після повного завантаження сторінки питає GET /widgets і довантажує ok-widgets.js лише тоді, коли щось увімкнено. Мова віджетів англійська, якщо lang сторінки починається з en, інакше українська.",
        en: "Widgets (social proof, reviews, stars, the «Зроблено на ONEKNIGHT» link) are switched on in the account. After the page has fully loaded, ok.js asks GET /widgets and loads ok-widgets.js only when something is on. Widgets are in English when the page lang starts with en, otherwise in Ukrainian.",
      },
      {
        kind: "list",
        uk: [
          "Соціальний доказ: справжні замовлення за 48 годин унизу ліворуч. Перше через 8 с, далі раз на 45 с, кожне видно 8 с. Закрите не з'являється до кінця візиту.",
          "Відгуки: <div data-ok-reviews=\"5\"></div> показує останні опубліковані відгуки з відповідями магазину. Потрібен модуль «Відгуки».",
          "Зірки: <span data-ok-stars></span> показує рейтинг сайту. Потрібен модуль «Відгуки», поки відгуків немає, нічого не показується.",
          "«Зроблено на ONEKNIGHT»: посилання внизу сторінки.",
        ],
        en: [
          "Social proof: real orders of the last 48 hours at the bottom left. The first after 8 s, then every 45 s, each shown for 8 s. Once closed, it stays hidden until the end of the visit.",
          "Reviews: <div data-ok-reviews=\"5\"></div> shows the latest published reviews with the store's replies. Needs the «Відгуки» (Reviews) module.",
          "Stars: <span data-ok-stars></span> shows the site's rating. Needs the «Відгуки» module; nothing is shown while there are no reviews.",
          "«Зроблено на ONEKNIGHT» (Made with ONEKNIGHT): a link at the bottom of the page.",
        ],
      },
      {
        kind: "p",
        uk: "Нижче адреси, які використовує сам ok.js. Їх можна викликати й напряму, якщо ви не ставите скрипт.",
        en: "Below are the addresses ok.js itself uses. You can call them directly if you do not use the script.",
      },
      {
        kind: "endpoint",
        method: "POST",
        path: "/events",
        uk: "Подія аналітики. Відповідь завжди 204 без тіла або 400 invalid_input. Запити ботів (за user-agent) мовчки пропускаються. Не більше 120 на хвилину з однієї IP-адреси.",
        en: "An analytics event. The answer is 204 with no body, or 400 invalid_input. Bot requests (by user agent) are silently skipped. At most 120 per minute from one IP address.",
      },
      {
        kind: "fields",
        rows: [
          { name: "type", type: "string", uk: "pageview, lead, product, cart або contact.", en: "pageview, lead, product, cart or contact." },
          { name: "session", type: "string", uk: "Ідентифікатор візиту: 16-64 символи a-z і 0-9.", en: "Visit id: 16-64 characters a-z and 0-9." },
          { name: "path", type: "string?", uk: "Шлях сторінки, до 500 символів.", en: "Page path, up to 500 characters." },
          { name: "ref", type: "string?", uk: "Для product і cart: id товару (обов'язково). Для contact: phone, viber, telegram або whatsapp (обов'язково).", en: "For product and cart: the product id (required). For contact: phone, viber, telegram or whatsapp (required)." },
          { name: "source, medium", type: "string?", uk: "utm_source і utm_medium, до 100 символів.", en: "utm_source and utm_medium, up to 100 characters." },
          { name: "campaign, content", type: "string?", uk: "utm_campaign і utm_content, до 150 символів.", en: "utm_campaign and utm_content, up to 150 characters." },
          { name: "referrer", type: "string?", uk: "Звідки прийшли, до 500 символів.", en: "Referrer, up to 500 characters." },
        ],
      },
      postExamples(
        "/events",
        `{ "type": "lead", "session": "k3v9x0a1b2c3d4e5f6g7", "path": "/contacts" }`,
        `console.log(res.status); // 204`,
        `echo $status; // 204`,
      ),
      {
        kind: "endpoint",
        method: "POST",
        path: "/carts",
        uk: "Незавершений кошик. Відповідь 204 без тіла або 400 invalid_input. Товари, яких немає на сайті, відкидаються. Порожній кошик видаляє збережений. Після замовлення з тієї ж сесії нові зміни не приймаються. Не більше 30 на хвилину з однієї IP-адреси.",
        en: "An unfinished cart. The answer is 204 with no body, or 400 invalid_input. Products that are not on the site are dropped. An empty cart deletes the saved one. After an order from the same session, later changes are not taken. At most 30 per minute from one IP address.",
      },
      {
        kind: "fields",
        rows: [
          { name: "session", type: "string", uk: "Ідентифікатор візиту: 16-64 символи a-z і 0-9. Один кошик на візит.", en: "Visit id: 16-64 characters a-z and 0-9. One cart per visit." },
          { name: "phone", type: "string", uk: "Телефон, той самий формат, що в замовленні.", en: "Phone, the same format as in orders." },
          { name: "name", type: "string?", uk: "Ім'я, до 100 символів.", en: "Name, up to 100 characters." },
          { name: "items", type: "{ id, qty }[]", uk: "До 50 рядків. id товару, qty від 1 до 99.", en: "Up to 50 lines. Product id, qty 1 to 99." },
        ],
      },
      postExamples(
        "/carts",
        `{ "session": "k3v9x0a1b2c3d4e5f6g7", "phone": "+380671112233", "items": [{ "id": "PRODUCT_ID", "qty": 1 }] }`,
        `console.log(res.status); // 204`,
        `echo $status; // 204`,
      ),
      {
        kind: "endpoint",
        method: "GET",
        path: "/widgets",
        uk: "Які віджети ввімкнені для сайту.",
        en: "Which widgets are on for the site.",
      },
      {
        kind: "fields",
        rows: [
          { name: "socialProof", type: "boolean", uk: "Соціальний доказ.", en: "Social proof." },
          { name: "reviews", type: "boolean", uk: "Блок відгуків (лише з модулем «Відгуки»).", en: "Reviews block (only with the Reviews module)." },
          { name: "stars", type: "boolean", uk: "Зірки (лише з модулем «Відгуки»).", en: "Stars (only with the Reviews module)." },
          { name: "poweredBy", type: "boolean", uk: "Посилання «Зроблено на ONEKNIGHT».", en: "The «Made with ONEKNIGHT» link." },
        ],
      },
      getExamples("/widgets", `if (data.reviews) console.log("reviews on");`, `if ($data["reviews"]) echo "reviews on";`),
      {
        kind: "endpoint",
        method: "GET",
        path: "/social-proof",
        uk: "До 10 останніх замовлень сайту за 48 годин (без скасованих і повернених). Порожній масив, коли віджет вимкнено.",
        en: "Up to 10 latest orders of the site from the last 48 hours (not cancelled or returned). An empty array when the widget is off.",
      },
      {
        kind: "fields",
        rows: [
          { name: "name", type: "string", uk: "Лише ім'я покупця (перше слово).", en: "The buyer's first name only (the first word)." },
          { name: "city", type: "string | null", uk: "Місто доставки.", en: "Delivery city." },
          { name: "product", type: "string", uk: "Перший товар замовлення.", en: "The first product of the order." },
          { name: "photo", type: "string | null", uk: "Фото товару, відносний шлях.", en: "Product photo, a relative path." },
          { name: "minutes", type: "number", uk: "Скільки хвилин тому.", en: "How many minutes ago." },
        ],
      },
      getExamples("/social-proof", `for (const o of data) console.log(o.name, o.product, o.minutes);`, `foreach ($data as $o) echo $o["name"] . ": " . $o["product"] . PHP_EOL;`),
    ],
  },

  {
    id: "webhooks",
    uk: "Вебхуки",
    en: "Webhooks",
    blocks: [
      {
        kind: "p",
        uk: "ONEKNIGHT одразу повідомляє ваш сервер про зміни — так сайт оновлює сторінки й кеш сам. До 3 адрес на сайт у «Сайт → API й ok.js», кожна зі своїми подіями й секретом підпису (показується один раз).",
        en: "ONEKNIGHT tells your server about changes at once — so the site refreshes its pages and cache by itself. Up to 3 addresses per site in «Сайт → API й ok.js», each with its own events and signing secret (shown once).",
      },
      {
        kind: "fields",
        rows: [
          { name: "order.created", type: "event", uk: "Нове замовлення з цього сайту: orderId, number, status, paymentStatus.", en: "A new order from this site: orderId, number, status, paymentStatus." },
          { name: "order.status_changed", type: "event", uk: "Статус змінився: orderId, number, status, previous.", en: "The status changed: orderId, number, status, previous." },
          { name: "order.payment_changed", type: "event", uk: "Оплата змінилась: orderId, number, paymentStatus, previous.", en: "The payment changed: orderId, number, paymentStatus, previous." },
          { name: "product.changed", type: "event", uk: "Товар створено, змінено чи видалено: productId, action (created · updated · deleted).", en: "A product was created, changed or deleted: productId, action (created · updated · deleted)." },
          { name: "stock.changed", type: "event", uk: "Залишок чи наявність: productId, stock, availability.", en: "Stock or availability: productId, stock, availability." },
          { name: "category.changed", type: "event", uk: "Категорію додано, змінено чи видалено: categoryId, action.", en: "A category was added, changed or deleted: categoryId, action." },
        ],
      },
      {
        kind: "code",
        lang: "http",
        code: `POST https://your-site/hooks/oneknight
content-type: application/json
x-oneknight-event: order.created
x-oneknight-delivery: 6f1c…
x-oneknight-signature: t=1790000000,v1=5d2a…

{"id":"6f1c…","type":"order.created","createdAt":"2026-09-30T10:00:00.000Z","siteId":"…","data":{"orderId":"…","number":1041,"status":"new","paymentStatus":"unpaid"}}`,
      },
      {
        kind: "list",
        uk: [
          "Підпис: v1 = HMAC-SHA256(секрет, t + \".\" + тіло запиту як є). Порівнюйте за сталий час і відкидайте t, старший за 5 хвилин.",
          "Відповідь 2xx — доставлено. Інакше повторимо через 1, 5, 30 хвилин, 2 і 12 годин; далі «не доставлено» (можна надіслати ще раз з журналу).",
          "20 доставок поспіль, що не вдалися, вимикають адресу; власник отримує сповіщення.",
          "Та сама подія може прийти двічі — зважайте на id. Дані в події короткі: актуальний стан беріть з API.",
        ],
        en: [
          "Signature: v1 = HMAC-SHA256(secret, t + \".\" + the raw request body). Compare in constant time and reject a t older than 5 minutes.",
          "A 2xx answer means delivered. Otherwise we retry in 1, 5, 30 minutes, 2 and 12 hours; then «not delivered» (it can be sent again from the log).",
          "20 deliveries in a row that failed switch the address off; the owner gets a notification.",
          "The same event may come twice — use its id. Event data is short: take the current state from the API.",
        ],
      },
      {
        kind: "examples",
        js: `// Node.js (Express): check the signature before trusting the body
import crypto from "node:crypto";
app.post("/hooks/oneknight", express.raw({ type: "application/json" }), (req, res) => {
  const [, t, v1] = /^t=(\\d+),v1=([0-9a-f]{64})$/.exec(req.get("x-oneknight-signature") ?? "") ?? [];
  const mine = crypto.createHmac("sha256", process.env.ONEKNIGHT_WEBHOOK_SECRET).update(\`\${t}.\${req.body}\`).digest("hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;
  if (!v1 || !fresh || !crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(v1))) return res.sendStatus(400);
  const event = JSON.parse(req.body);
  // e.g. event.type === "stock.changed" → refresh the product page cache
  res.sendStatus(204);
});`,
        curl: `# Send yourself a test from the account: «Сайт → API й ok.js → Вебхуки → Надіслати тест».`,
        php: `<?php
$body = file_get_contents("php://input");
preg_match('/^t=(\\d+),v1=([0-9a-f]{64})$/', $_SERVER["HTTP_X_ONEKNIGHT_SIGNATURE"] ?? "", $m);
$mine = hash_hmac("sha256", ($m[1] ?? "") . "." . $body, getenv("ONEKNIGHT_WEBHOOK_SECRET"));
if (!$m || abs(time() - (int)$m[1]) > 300 || !hash_equals($mine, $m[2])) { http_response_code(400); exit; }
$event = json_decode($body, true);
http_response_code(204);`,
      },
    ],
  },

  {
    id: "errors",
    uk: "Помилки й ліміти",
    en: "Errors and limits",
    blocks: [
      {
        kind: "p",
        uk: "Помилка приходить як JSON з машинним кодом у полі error. Текстового повідомлення немає. Помилки замовлення (409) мають ще \"ok\": false і часом productId.",
        en: "An error comes as JSON with a machine code in the error field. There is no text message. Order errors (409) also have \"ok\": false and sometimes productId.",
      },
      { kind: "code", lang: "json", code: `{ "error": "invalid_site_key" }` },
      {
        kind: "fields",
        rows: [
          { name: "400", type: "invalid_input", uk: "Тіло не пройшло перевірку.", en: "The body failed validation." },
          { name: "400", type: "bad_request", uk: "Тіло не є коректним JSON.", en: "The body is not valid JSON." },
          { name: "400", type: "unsupported_file, file_too_large", uk: "Фото відгуку не PNG, JPEG чи WebP або більше 4 МБ.", en: "The review photo is not PNG, JPEG or WebP, or is over 4 MB." },
          { name: "401", type: "invalid_site_key", uk: "Ключа немає або він неправильний.", en: "The key is missing or wrong." },
          { name: "403", type: "bad_origin", uk: "Запит з браузера на чужому домені або через http://.", en: "A browser request from another domain or over http://." },
          { name: "403", type: "module_not_active", uk: "Не підключено модуль «Відгуки».", en: "The Reviews module is not connected." },
          { name: "404", type: "", uk: "Такої адреси немає.", en: "No such address." },
          { name: "409", type: "unknown_product, out_of_stock, unavailable", uk: "Замовлення не створено, див. «Замовлення».", en: "The order was not created, see «Orders»." },
          { name: "413", type: "bad_request", uk: "Тіло завелике: понад 1 МБ, для POST /reviews понад 7 МБ.", en: "The body is too large: over 1 MB, or over 7 MB for POST /reviews." },
          { name: "415", type: "json_required", uk: "POST з тілом без content-type: application/json.", en: "A POST with a body but without content-type: application/json." },
          { name: "429", type: "too_many_requests", uk: "Перевищено ліміт запитів.", en: "Rate limit exceeded." },
          { name: "500", type: "server_error", uk: "Помилка на нашому боці. Спробуйте пізніше.", en: "An error on our side. Try again later." },
        ],
      },
      {
        kind: "p",
        uk: "Ліміти рахуються окремо для кожної IP-адреси:",
        en: "Limits are counted per IP address:",
      },
      {
        kind: "fields",
        rows: [
          { name: "POST /orders", type: "10 / 10 хв", uk: "10 замовлень за 10 хвилин.", en: "10 orders per 10 minutes." },
          { name: "POST /reviews", type: "5 / 10 хв", uk: "5 відгуків за 10 хвилин.", en: "5 reviews per 10 minutes." },
          { name: "POST /events", type: "120 / хв", uk: "120 подій на хвилину.", en: "120 events per minute." },
          { name: "POST /carts", type: "30 / хв", uk: "30 кошиків на хвилину.", en: "30 carts per minute." },
          { name: "Решта / Other", type: "300 / хв", uk: "300 запитів на хвилину на всі інші адреси разом.", en: "300 requests per minute for all other addresses together." },
        ],
      },
      {
        kind: "p",
        uk: "Відповіді мають заголовки x-ratelimit-limit, x-ratelimit-remaining і x-ratelimit-reset (секунди до скидання). Відповідь 429 має ще retry-after.",
        en: "Responses carry the x-ratelimit-limit, x-ratelimit-remaining and x-ratelimit-reset (seconds until reset) headers. A 429 also has retry-after.",
      },
      {
        kind: "p",
        uk: "Помилки теж приходять із CORS-заголовком, тож у браузері fetch повертає JSON з кодом помилки, а не падає з помилкою мережі.",
        en: "Errors come with the CORS header too, so in the browser fetch returns the JSON with the error code instead of failing with a network error.",
      },
    ],
  },
];
