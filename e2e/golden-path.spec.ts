import { test, expect } from "@playwright/test";

test("parcours complet : créer, ajouter avec quantité, catégoriser, cocher, partager, exporter/importer", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".home-header h1")).toHaveText("KoiKiManke");

  // Création d'une liste
  await page.fill("#create-name", "Courses de la semaine");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  // Ajout avec extraction de quantité, prévisualisée avant même l'envoi
  await page.fill("#add-input", "2 kg pommes");
  await expect(page.locator("#add-preview-qty")).toHaveText("2 kg");
  await page.click(".add-submit");
  await expect(page.locator(".item .item-name")).toHaveText("pommes");
  await expect(page.locator(".item .qty-badge")).toHaveText("2 kg");

  // Un article sans quantité détectée affiche le badge "+" (à éditer au besoin)
  await page.fill("#add-input", "Lait");
  await page.click(".add-submit");
  await expect(page.locator(".item")).toHaveCount(2);

  // Catégories : création, puis assignation via le sélecteur du formulaire.
  await page.click("#btn-menu");
  await page.click('[data-action="manage-categories"]');
  await page.fill("#new-category-name", "Bricolage");
  await page.click("#new-category-form button[type=submit]");
  await page.click(".modal-close");
  await page.selectOption("#add-category", { label: "Bricolage" });
  await page.fill("#add-input", "Bananes");
  await page.click(".add-submit");

  const bricolageSection = page.locator(".category-section", { has: page.locator(".category-name", { hasText: "Bricolage" }) });
  await expect(bricolageSection.locator(".item-name")).toHaveText(["Bananes"]);

  // Cocher un article le fait basculer visuellement
  await page.locator(".item", { has: page.locator(".item-name", { hasText: "Lait" }) }).locator(".item-check").check();
  await expect(page.locator(".item.checked .item-name", { hasText: "Lait" })).toBeVisible();

  // Partage : code affiché + QR code généré
  await page.click("#btn-share");
  await expect(page.locator(".share-modal .share-code")).not.toBeEmpty();
  await expect(page.locator(".share-modal .qr-wrap svg")).toBeVisible();
  await page.click(".modal-close");

  // Export puis import (fusion) dans une nouvelle liste
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await page.click("#btn-menu");
      await page.click('[data-action="export"]');
    })(),
  ]);
  const exportPath = await download.path();
  expect(exportPath).toBeTruthy();

  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });
  await page.click("#btn-menu");
  await page.click('[data-action="import"]');
  await page.setInputFiles("#import-file", exportPath!);
  await page.click("#import-merge");
  await expect(page.locator(".item-name", { hasText: "pommes" })).toBeVisible();
  await expect(page.locator(".item-name", { hasText: "Bananes" })).toBeVisible();
});

test("un code inconnu affiche un message clair plutôt qu'un écran vide", async ({ page }) => {
  await page.goto("/l/ZZZZZZ");
  await expect(page.locator(".centered-message")).toContainText("Aucune liste ne correspond au code");
});
