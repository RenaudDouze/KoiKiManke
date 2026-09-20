import { test, expect } from "@playwright/test";

test("les réglages d'accessibilité s'appliquent indépendamment et persistent après un rechargement", async ({ page }) => {
  await page.goto("/");
  await page.click("#a11y-toggle");
  await expect(page.locator(".accessibility-modal")).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-large-text", /.*/);
  await expect(page.locator("html")).not.toHaveAttribute("data-high-contrast", /.*/);
  await expect(page.locator("html")).not.toHaveAttribute("data-reduce-motion", /.*/);

  // Texte plus grand : le reste de style.css est déjà en rem/em, il suffit
  // de vérifier l'attribut posé sur <html>, pas un calcul de taille précis.
  await page.locator('input[data-key="largeText"]').check();
  await expect(page.locator("html")).toHaveAttribute("data-large-text", "");

  // Contraste renforcé : le texte passe en noir pur (thème clair).
  await page.locator('input[data-key="highContrast"]').check();
  await expect(page.locator("html")).toHaveAttribute("data-high-contrast", "");
  const textColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--text").trim());
  expect(textColor).toBe("#000000");

  // Animations coupées, y compris celles posées en ligne par le JS.
  await page.locator('input[data-key="reduceMotion"]').check();
  await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "");
  const toastDuration = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "toast";
    document.body.appendChild(probe);
    const duration = getComputedStyle(probe).transitionDuration;
    probe.remove();
    return duration;
  });
  expect(toastDuration).toMatch(/^0s(, 0s)*$/);

  await page.click(".modal-close");
  await expect(page.locator(".accessibility-modal")).toHaveCount(0);

  // Persiste après rechargement (préférence locale, comme le thème).
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-large-text", "");
  await expect(page.locator("html")).toHaveAttribute("data-high-contrast", "");
  await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "");

  // Toujours utilisable une fois activé : créer une liste, ajouter un article.
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });
  await expect(page.locator("html")).toHaveAttribute("data-large-text", "");

  await page.fill("#add-input", "Pommes");
  await page.click(".add-submit");
  await expect(page.locator(".item")).toHaveCount(1);

  // Même réglage accessible et modifiable depuis une liste, pas seulement
  // depuis l'accueil : décocher un seul réglage retire uniquement son
  // attribut, sans toucher aux deux autres.
  await page.click("#btn-menu");
  await page.click('[data-action="accessibility"]');
  await expect(page.locator('input[data-key="largeText"]')).toBeChecked();
  await page.locator('input[data-key="largeText"]').uncheck();
  await expect(page.locator("html")).not.toHaveAttribute("data-large-text", /.*/);
  await expect(page.locator("html")).toHaveAttribute("data-high-contrast", "");
  await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "");
});
