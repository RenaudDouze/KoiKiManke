import { test, expect } from "@playwright/test";

test("le mode privé chiffre la liste côté serveur sans rien changer à l'usage normal", async ({ page }) => {
  await page.goto("/");
  await page.fill("#create-name", "Liste secrète");
  await page.check("#create-private");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  // Le badge cadenas et la note de confidentialité reflètent le mode privé.
  await expect(page.locator(".lock-badge")).toBeVisible();
  await expect(page.locator(".list-privacy-note")).toContainText("Mode privé activé");

  // Utilisation normale : ajouter, cocher, supprimer fonctionnent malgré le
  // chiffrement côté serveur (chaque persist() chiffre avant écriture).
  await page.fill("#add-input", "Pommes");
  await page.click(".add-submit");
  await page.fill("#add-input", "Lait");
  await page.click(".add-submit");
  await expect(page.locator(".item")).toHaveCount(2);

  await page.locator(".item", { has: page.locator(".item-name", { hasText: "Lait" }) }).locator(".item-check").check();
  await expect(page.locator(".item.checked .item-name", { hasText: "Lait" })).toBeVisible();

  // Persiste après rechargement (aller-retour serveur, pas juste local) :
  // prouve que la liste déchiffrée reste fidèle à ce qui a été écrit.
  await page.reload();
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });
  await expect(page.locator(".lock-badge")).toBeVisible();
  await expect(page.locator(".item")).toHaveCount(2);
  await expect(page.locator(".item.checked .item-name", { hasText: "Lait" })).toBeVisible();
});

test("une liste normale (non privée) n'affiche pas le badge cadenas", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await expect(page.locator(".lock-badge")).toHaveCount(0);
  await expect(page.locator(".list-privacy-note")).not.toContainText("Mode privé activé");
});
