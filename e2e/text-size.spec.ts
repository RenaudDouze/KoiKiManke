import { test, expect } from "@playwright/test";

test("le mode grand texte s'applique et persiste, sans casser l'ajout d'articles", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-text-size", "large");

  await page.click("#text-size-toggle");
  await expect(page.locator("html")).toHaveAttribute("data-text-size", "large");
  await expect(page.locator("#text-size-toggle")).toHaveAttribute("aria-pressed", "true");

  // Persiste après rechargement (préférence locale, comme le thème).
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-text-size", "large");

  // Toujours utilisable une fois grossi : créer une liste, ajouter un article.
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });
  await expect(page.locator("html")).toHaveAttribute("data-text-size", "large");

  await page.fill("#add-input", "Pommes");
  await page.click(".add-submit");
  await expect(page.locator(".item")).toHaveCount(1);

  // Revenir en taille normale retire l'attribut.
  await page.click("#btn-menu");
  await page.click('[data-action="text-size"]');
  await expect(page.locator("html")).not.toHaveAttribute("data-text-size", "large");
});
