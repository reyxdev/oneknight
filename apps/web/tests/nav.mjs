// Navigation in the ONEKNIGHT panel for browser tests: grouped menu, «Мій профіль» at the bottom,
// tabs inside «Бізнес» / «Мій профіль», and the separate admin mode.
const ADMIN = new Set(["Огляд", "Заявки", "Проєкти", "Бізнеси", "Звернення", "Поповнення", "Ключі й промокоди", "Комунікації", "Оголошення"]);
const TABS = {
  "Інтеграції": ["Бізнес", "Інтеграції"],
  "Резервні копії": ["Бізнес", "Резервні копії"],
  "Безпека": ["Мій профіль", "Безпека"],
  "Сповіщення": ["Мій профіль", "Сповіщення"],
  "Оголошення": ["Комунікації", "Банер і «Що нового»"],
};

export async function go(pg, name) {
  const toggle = pg.locator("[data-mode-switch]");
  if (await toggle.count()) {
    const inAdmin = (await toggle.getAttribute("data-admin")) === "true";
    if (inAdmin !== ADMIN.has(name)) {
      await toggle.click();
      await pg.waitForFunction((want) => document.querySelector("[data-mode-switch]")?.getAttribute("data-admin") === String(want), ADMIN.has(name));
    }
  }
  const [item, tab] = TABS[name] ?? [name];
  await pg.locator(".ok-side").getByRole("button", { name: item, exact: true }).click();
  if (tab) await pg.getByRole("tab", { name: tab, exact: true }).click();
}

/** Right after sign-up the owner answers four questions, then goes to the account. */
export async function onboard(pg) {
  await pg.getByRole("heading", { name: /кілька питань/ }).waitFor();
  const q = (legend) => pg.locator("fieldset", { hasText: legend });
  await q("Сайт уже є?").getByRole("button", { name: "Ні", exact: true }).click();
  await q("Що продаєте?").getByRole("button", { name: "Ручна робота" }).click();
  await q("Як доставляєте?").getByRole("button", { name: "Нова пошта" }).click();
  await q("Де ще продаєте?").getByRole("button", { name: "Ніде" }).click();
  await pg.getByRole("button", { name: "Далі", exact: true }).click();
  await pg.getByRole("button", { name: "Перейти в кабінет" }).click();
  await pg.getByText("Вітаємо").waitFor();
}

/** Admin «Бізнеси»: finds the business in the table and opens its card (the tabs are inside). */
export async function openBusiness(pg, name) {
  await go(pg, "Бізнеси");
  await pg.getByLabel("Назва, власник, телефон, мітка").fill(name);
  await pg.locator(".app-table tbody tr", { hasText: name }).first().click();
  const card = pg.locator(".ok-detail");
  await card.getByRole("tab", { name: "Огляд" }).waitFor();
  return card;
}
