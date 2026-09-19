import { test, expect } from "@playwright/test";

test("lien/QR compact : générer un lien depuis une liste, l'ouvrir ailleurs, confirmer l'import", async ({ page }) => {
  await page.goto("/");
  await page.fill("#create-name", "Courses de Noël");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-input", "Chocolats");
  await page.click(".add-submit");
  await expect(page.locator(".item-name")).toHaveText("Chocolats");

  // Génère le lien/QR compact depuis la modale de partage (menu ⋮ → Partager
  // → « Lien/QR compact »), replié par défaut.
  await page.click("#btn-menu");
  await page.click('[data-action="share"]');
  await expect(page.locator(".compact-share")).toBeHidden();
  await page.click("#toggle-compact-share");
  await expect(page.locator(".compact-share")).toBeVisible();
  await expect(page.locator("#compact-qr-wrap svg")).toBeVisible();

  const compactLink = (await page.locator("#compact-link").textContent())?.trim();
  expect(compactLink).toBeTruthy();
  expect(compactLink).toContain("?import=");
  // Contrairement au lien de partage direct (share-link du haut), celui-ci
  // ne pointe jamais vers /l/CODE : ouvrir ce lien ne rejoint pas cette liste
  // en direct, il propose seulement d'en importer un instantané ailleurs.
  expect(compactLink).not.toMatch(/\/l\//);
  await page.click(".modal-close");

  // Ouvre ce lien "ailleurs" (nouvel onglet, sans code de liste connu).
  const otherPage = await page.context().newPage();
  await otherPage.goto(compactLink!);

  await expect(otherPage.locator(".import-banner")).toContainText("Liste partagée reçue");
  await expect(otherPage.locator(".import-banner")).toContainText("1 article(s) et 0 catégorie(s)");
  await expect(otherPage.locator(".import-banner")).toContainText("Courses de Noël");
  // Le paramètre `import` a été retiré de la barre d'adresse dès sa lecture.
  expect(new URL(otherPage.url()).searchParams.has("import")).toBe(false);

  await otherPage.click("#import-banner-create");
  await otherPage.waitForURL(/\/l\//);

  // L'invite fusion/remplacement s'ouvre automatiquement, comme pour un
  // fichier JSON importé (même modal, même choix).
  await expect(otherPage.locator(".modal h2")).toHaveText("Importer la liste");
  await otherPage.click("#import-merge");
  await expect(otherPage.locator(".item-name", { hasText: "Chocolats" })).toBeVisible();
});

test("lien/QR compact : l'ouvrir alors qu'une autre liste est déjà affichée propose de fusionner dedans", async ({ page }) => {
  // Prépare le lien compact d'une première liste.
  await page.goto("/");
  await page.fill("#create-name", "Liste à partager");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });
  await page.fill("#add-input", "Bûche de Noël");
  await page.click(".add-submit");
  await expect(page.locator(".item-name")).toHaveText("Bûche de Noël");

  await page.click("#btn-menu");
  await page.click('[data-action="share"]');
  await page.click("#toggle-compact-share");
  await expect(page.locator("#compact-qr-wrap svg")).toBeVisible();
  const compactLink = (await page.locator("#compact-link").textContent())?.trim();
  const importParam = new URL(compactLink!).searchParams.get("import");
  expect(importParam).toBeTruthy();
  await page.click(".modal-close");

  // Crée une seconde liste, déjà avec un article, puis y ouvre le même
  // paramètre `import` (comme un lien compact collé sur une liste existante).
  await page.click("#btn-home");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });
  await page.fill("#add-input", "Sapin");
  await page.click(".add-submit");
  await expect(page.locator(".item-name")).toHaveText("Sapin");

  const currentUrl = new URL(page.url());
  currentUrl.searchParams.set("import", importParam!);
  await page.goto(currentUrl.toString());

  await expect(page.locator(".modal h2")).toHaveText("Importer la liste");
  await page.click("#import-merge");
  await expect(page.locator(".item-name", { hasText: "Sapin" })).toBeVisible();
  await expect(page.locator(".item-name", { hasText: "Bûche de Noël" })).toBeVisible();
});
