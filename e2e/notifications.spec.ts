import { test, expect, type Page } from "@playwright/test";

// Remplace window.Notification par un stub avant même le chargement de
// l'app : évite de dépendre d'une vraie permission navigateur (popup native,
// non pilotable par Playwright) tout en gardant intact le vrai comportement
// de src/lib/notifications.ts (permission déjà "accordée", donc jamais de
// requestPermission() à attendre).
async function stubNotificationApi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __notifications: unknown[] }).__notifications = [];
    class FakeNotification {
      static permission = "granted";
      static requestPermission(): Promise<NotificationPermission> {
        return Promise.resolve("granted");
      }
      constructor(title: string, options?: { body?: string }) {
        (window as unknown as { __notifications: unknown[] }).__notifications.push({ title, body: options?.body });
      }
    }
    // @ts-expect-error stub de test, pas la vraie classe Notification
    window.Notification = FakeNotification;
  });
}

function getCapturedNotifications(page: Page): Promise<{ title: string; body?: string }[]> {
  return page.evaluate(() => (window as unknown as { __notifications: { title: string; body?: string }[] }).__notifications);
}

// Force document.visibilityState/hasFocus() sans dépendre du focus réel de
// la fenêtre du navigateur automatisé (peu fiable en CI) : reproduit
// exactement la condition que isPageActive() (src/lib/notifications.ts)
// vérifie avant de notifier.
function markPageInactive(page: Page): Promise<void> {
  return page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.hasFocus = () => false;
  });
}

test("activer les notifications persiste après un rechargement", async ({ page }) => {
  await stubNotificationApi(page);
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.click("#btn-menu");
  await expect(page.locator('[data-action="notifications"]')).toContainText("Désactivées");
  await page.click('[data-action="notifications"]');
  await expect(page.locator('[data-action="notifications"]')).toContainText("Activées");

  await page.reload();
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });
  await page.click("#btn-menu");
  await expect(page.locator('[data-action="notifications"]')).toContainText("Activées");
});

test("notifie l'ajout d'un article par un autre appareil quand l'onglet est en arrière-plan, mais jamais son propre ajout", async ({
  browser,
}) => {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();
  await stubNotificationApi(page1);

  await page1.goto("/");
  await page1.click("#create-form button[type=submit]");
  await page1.waitForURL(/\/l\//);
  const code = page1.url().split("/l/")[1];
  await expect(page1.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page1.click("#btn-menu");
  await page1.click('[data-action="notifications"]');
  await expect(page1.locator('[data-action="notifications"]')).toContainText("Activées");

  await page2.goto(`/l/${code}`);
  await expect(page2.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  // page1 passe "en arrière-plan" : c'est la seule situation où une
  // notification système a du sens (sinon l'article apparaît déjà en
  // direct dans la liste, une notification serait redondante).
  await markPageInactive(page1);

  await page2.fill("#add-input", "Yaourts");
  await page2.click(".add-submit");
  await expect(page1.locator(".item .item-name", { hasText: "Yaourts" })).toBeVisible({ timeout: 5000 });

  await expect.poll(() => getCapturedNotifications(page1)).toEqual([{ title: "Liste de courses", body: "Yaourts" }]);

  // Son propre ajout, même en arrière-plan, ne se notifie jamais lui-même.
  await page1.fill("#add-input", "Pommes");
  await page1.click(".add-submit");
  await expect(page1.locator(".item .item-name", { hasText: "Pommes" })).toBeVisible();
  await expect(getCapturedNotifications(page1)).resolves.toHaveLength(1);

  await ctx1.close();
  await ctx2.close();
});
