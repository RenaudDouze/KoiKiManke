import { test, expect, type Page } from "@playwright/test";

// Remplace window.Notification par un stub avant même le chargement de
// l'app : évite de dépendre d'une vraie permission navigateur (popup native,
// non pilotable par Playwright) tout en gardant intact le vrai comportement
// de src/lib/notifications.ts (permission déjà "accordée", donc jamais de
// requestPermission() à attendre). withServiceWorker simule en plus une PWA
// installée avec un service worker actif (jamais le cas sous `vite dev`,
// voir vite.config.ts) : notifyItemAdded doit alors passer par
// ServiceWorkerRegistration.showNotification() plutôt que le constructeur
// Notification direct, refusé par Chrome Android une fois un service
// worker actif ("Illegal constructor").
async function stubNotificationApi(page: Page, { withServiceWorker = false }: { withServiceWorker?: boolean } = {}): Promise<void> {
  await page.addInitScript((simulateServiceWorker: boolean) => {
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

    if (simulateServiceWorker) {
      (window as unknown as { __swNotifications: unknown[] }).__swNotifications = [];
      const fakeRegistration = {
        showNotification: (title: string, options?: { body?: string }) => {
          (window as unknown as { __swNotifications: unknown[] }).__swNotifications.push({ title, body: options?.body });
          return Promise.resolve();
        },
      };
      Object.defineProperty(navigator, "serviceWorker", {
        value: { getRegistration: () => Promise.resolve(fakeRegistration) },
        configurable: true,
      });
    }
  }, withServiceWorker);
}

function getCapturedNotifications(page: Page): Promise<{ title: string; body?: string }[]> {
  return page.evaluate(() => (window as unknown as { __notifications: { title: string; body?: string }[] }).__notifications);
}

function getCapturedServiceWorkerNotifications(page: Page): Promise<{ title: string; body?: string }[]> {
  return page.evaluate(() => (window as unknown as { __swNotifications: { title: string; body?: string }[] }).__swNotifications);
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

test("notifie l'ajout d'un article par un autre appareil même onglet au premier plan, mais jamais son propre ajout", async ({ browser }) => {
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

  // page1 reste au premier plan (aucun forçage de visibilityState/focus) :
  // la notification doit tout de même se déclencher, l'utilisateur l'ayant
  // explicitement demandée même dans ce cas.
  await page2.fill("#add-input", "Yaourts");
  await page2.click(".add-submit");
  await expect(page1.locator(".item .item-name", { hasText: "Yaourts" })).toBeVisible({ timeout: 5000 });

  await expect.poll(() => getCapturedNotifications(page1)).toEqual([{ title: "Liste de courses", body: "Yaourts" }]);

  // Son propre ajout ne se notifie jamais lui-même.
  await page1.fill("#add-input", "Pommes");
  await page1.click(".add-submit");
  await expect(page1.locator(".item .item-name", { hasText: "Pommes" })).toBeVisible();
  await expect(getCapturedNotifications(page1)).resolves.toHaveLength(1);

  await ctx1.close();
  await ctx2.close();
});

test("utilise ServiceWorkerRegistration.showNotification() quand un service worker est actif, comme sur une PWA installée", async ({
  browser,
}) => {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();
  await stubNotificationApi(page1, { withServiceWorker: true });

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

  await page2.fill("#add-input", "Yaourts");
  await page2.click(".add-submit");
  await expect(page1.locator(".item .item-name", { hasText: "Yaourts" })).toBeVisible({ timeout: 5000 });

  await expect.poll(() => getCapturedServiceWorkerNotifications(page1)).toEqual([{ title: "Liste de courses", body: "Yaourts" }]);
  // Jamais le constructeur direct une fois un service worker actif.
  await expect(getCapturedNotifications(page1)).resolves.toEqual([]);

  await ctx1.close();
  await ctx2.close();
});
