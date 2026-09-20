import { test, expect } from "@playwright/test";

// 1x1 PNG transparent — juste assez pour un upload/affichage réels, la
// résolution n'a aucune importance pour ce test.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function choosePhoto(page: import("@playwright/test").Page, trigger: () => Promise<void>, filename: string): Promise<void> {
  const fileChooserPromise = page.waitForEvent("filechooser");
  await trigger();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({ name: filename, mimeType: "image/png", buffer: TINY_PNG });
}

test("photo d'article : ajouter, remplacer, supprimer, persiste après rechargement", async ({ page }) => {
  await page.goto("/");
  await page.fill("#create-name", "Courses");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-input", "Pommes");
  await page.click(".add-submit");
  await expect(page.locator(".item-name")).toHaveText("Pommes");

  const photoButton = page.locator(".item-photo");
  await expect(photoButton).not.toHaveClass(/has-photo/);

  await choosePhoto(page, () => photoButton.click(), "pomme.png");
  await expect(photoButton).toHaveClass(/has-photo/, { timeout: 10_000 });
  await expect(photoButton.locator("img")).toBeVisible();
  const firstSrc = await photoButton.locator("img").getAttribute("src");
  expect(firstSrc).toBeTruthy();

  // Photo toujours là après un rechargement (stockée dans le bucket R2 côté
  // serveur, pas seulement dans l'état optimiste local).
  await page.reload();
  await expect(page.locator(".item-photo")).toHaveClass(/has-photo/, { timeout: 10_000 });

  // Ouvre la visionneuse et remplace la photo. Attend que l'attribut src ait
  // changé (nouvel id de photo, voir worker/reducer.ts) plutôt que la seule
  // classe .has-photo : celle-ci est déjà vraie depuis la photo précédente,
  // donc ne prouverait pas que ce remplacement précis est bien arrivé avant
  // l'étape de suppression suivante.
  await page.locator(".item-photo").click();
  await expect(page.locator(".photo-viewer-modal img")).toBeVisible();
  await choosePhoto(page, () => page.click("#photo-replace"), "pomme2.png");
  await expect(page.locator(".item-photo img")).not.toHaveAttribute("src", firstSrc!, { timeout: 10_000 });

  // Supprime la photo : la vignette redevient l'icône appareil photo.
  await page.locator(".item-photo").click();
  await page.click("#photo-remove");
  await expect(page.locator(".item-photo")).not.toHaveClass(/has-photo/, { timeout: 10_000 });

  await page.reload();
  await expect(page.locator(".item-photo")).not.toHaveClass(/has-photo/, { timeout: 10_000 });
});

test("la photo d'un article apparaît en temps réel sur un autre appareil", async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  await page1.goto("/");
  await page1.click("#create-form button[type=submit]");
  await page1.waitForURL(/\/l\//);
  const code = page1.url().split("/l/")[1];
  await expect(page1.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page1.fill("#add-input", "Bananes");
  await page1.click(".add-submit");
  await expect(page1.locator(".item-name")).toHaveText("Bananes");

  await page2.goto(`/l/${code}`);
  await expect(page2.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await choosePhoto(page1, () => page1.locator(".item-photo").click(), "banane.png");

  await expect(page2.locator(".item-photo")).toHaveClass(/has-photo/, { timeout: 10_000 });
  await expect(page2.locator(".item-photo img")).toBeVisible();

  await ctx1.close();
  await ctx2.close();
});
