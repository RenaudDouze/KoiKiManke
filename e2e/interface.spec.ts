import { test, expect } from "@playwright/test";

test("le thème choisi persiste après un rechargement", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);

  await page.click("#theme-toggle");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.click("#theme-toggle");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("annuler restaure un article supprimé", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-input", "Pommes");
  await page.click(".add-submit");
  await expect(page.locator(".item .item-name")).toHaveText("Pommes");

  await page.click(".item-delete");
  await expect(page.locator(".item")).toHaveCount(0);
  await expect(page.locator("#undo-toast")).toContainText("« Pommes » supprimé");

  await page.click("#undo-toast button");
  await expect(page.locator(".item .item-name")).toHaveText("Pommes");
});

test("la recherche filtre les articles et se referme proprement", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  for (const name of ["Pommes", "Poires", "Lait"]) {
    await page.fill("#add-input", name);
    await page.click(".add-submit");
  }
  await expect(page.locator(".item")).toHaveCount(3);

  await page.click("#btn-search");
  await page.fill("#search-input", "po");
  await expect(page.locator(".item-name")).toHaveText(["Pommes", "Poires"]);

  await page.fill("#search-input", "introuvable");
  await expect(page.locator(".empty-state")).toContainText("Aucun article ne correspond");

  await page.click("#search-close");
  await expect(page.locator(".item")).toHaveCount(3);
  await expect(page.locator("#search-bar")).toBeHidden();
});

test("cocher le dernier article déclenche une célébration, mais pas au rechargement d'une liste déjà terminée", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-input", "Pommes");
  await page.click(".add-submit");
  await expect(page.locator(".item")).toHaveCount(1);

  await page.locator(".item-check").check();
  await expect(page.locator(".celebration-toast")).toBeVisible();

  await page.reload();
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });
  await page.waitForTimeout(1000);
  await expect(page.locator(".celebration-toast")).toHaveCount(0);
});

test("les listes favorites sont épinglées au-dessus des autres, sans code affiché", async ({ page }) => {
  await page.goto("/");
  await page.fill("#create-name", "Liste A");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await page.click("#btn-home");

  await page.fill("#create-name", "Liste B");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await page.click("#btn-home");

  await expect(page.locator(".recent-item")).toHaveCount(2);
  await expect(page.locator(".recent-code")).toHaveCount(0);
  await expect(page.locator(".recent-name").first()).toHaveText("Liste B");

  await page.locator(".recent-item", { hasText: "Liste A" }).locator(".recent-favorite").click();

  await expect(page.locator(".recent-subheading").first()).toHaveText("Favoris");
  await expect(page.locator(".recent-subheading").nth(1)).toHaveText("Autres");
  await expect(page.locator(".recent-name").first()).toHaveText("Liste A");

  // « Listes récentes » passe avant « Nouvelle liste », elle-même avant
  // « Rejoindre une liste » (l'utilisateur revient plus souvent sur une
  // liste existante qu'il n'en crée ou n'en rejoint une nouvelle).
  await expect(page.locator(".card h2")).toHaveText(["Listes récentes", "Nouvelle liste", "Rejoindre une liste"]);
});

test("les suggestions ne s'enregistrent qu'à la coche, pas au simple ajout", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  // Ajoutée puis supprimée sans jamais être cochée : ne doit laisser aucune
  // trace dans les suggestions.
  await page.fill("#add-input", "Pommes");
  await page.click(".add-submit");
  await page.click(".item-delete");
  await expect(page.locator("#quick-add .chip")).toHaveCount(0);

  // Cochée : devient une suggestion (même sans être supprimée/vidée).
  await page.fill("#add-input", "Poires");
  await page.click(".add-submit");
  await page.locator(".item-check").check();
  await expect(page.locator("#quick-add .chip")).toHaveText(["+ Poires"]);
});

test("ajouter un article depuis une suggestion dont la catégorie a été supprimée ne le rend pas invisible", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.click("#btn-menu");
  await page.click('[data-action="manage-categories"]');
  await page.fill("#new-category-name", "Fruits");
  await page.click("#new-category-form button[type=submit]");
  await page.keyboard.press("Escape");

  await page.selectOption("#add-category", { label: "Fruits" });
  await page.fill("#add-input", "Pommes");
  await page.click(".add-submit");
  await page.locator(".item-check").check();
  await page.click(".item-delete");

  await page.click("#btn-menu");
  await page.click('[data-action="manage-categories"]');
  await page.click('[data-action="del"]');
  await page.keyboard.press("Escape");

  // La suggestion "Pommes" pointe encore vers la catégorie supprimée : sans
  // le nettoyage/la validation côté serveur, l'article réapparaîtrait avec
  // un categoryId fantôme et resterait invisible (régression).
  await expect(page.locator("#quick-add .chip")).toHaveText(["+ Pommes"]);
  await page.click("#quick-add .chip");

  await expect(page.locator(".item-name")).toHaveText("Pommes");
  await expect(page.locator(".empty-state")).toHaveCount(0);
});
