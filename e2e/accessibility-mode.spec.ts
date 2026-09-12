import { test, expect } from "@playwright/test";

test("le mode accessibilité grossit le texte, renforce le contraste et coupe les animations", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-a11y", "on");

  await page.click("#a11y-toggle");
  await expect(page.locator("html")).toHaveAttribute("data-a11y", "on");
  await expect(page.locator("#a11y-toggle")).toHaveAttribute("aria-pressed", "true");

  // Contraste renforcé : le texte passe en noir pur (thème clair).
  const textColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--text").trim());
  expect(textColor).toBe("#000000");

  // Animations coupées, y compris celles posées en ligne par le JS.
  const toastDuration = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "toast";
    document.body.appendChild(probe);
    const duration = getComputedStyle(probe).transitionDuration;
    probe.remove();
    return duration;
  });
  expect(toastDuration).toMatch(/^0s(, 0s)*$/);

  // Persiste après rechargement (préférence locale, comme le thème).
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-a11y", "on");

  // Toujours utilisable une fois activé : créer une liste, ajouter un article.
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });
  await expect(page.locator("html")).toHaveAttribute("data-a11y", "on");

  await page.fill("#add-input", "Pommes");
  await page.click(".add-submit");
  await expect(page.locator(".item")).toHaveCount(1);

  // Revenir en mode normal retire l'attribut.
  await page.click("#btn-menu");
  await page.click('[data-action="accessibility"]');
  await expect(page.locator("html")).not.toHaveAttribute("data-a11y", "on");
});
