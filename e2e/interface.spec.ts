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

test("gérer les suggestions : renommer, changer de catégorie, supprimer puis annuler", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.click("#btn-menu");
  await page.click('[data-action="manage-categories"]');
  await page.fill("#new-category-name", "Fruits");
  await page.click("#new-category-form button[type=submit]");
  await page.keyboard.press("Escape");

  // Crée une suggestion "Pommes" (sans catégorie) en cochant l'article.
  await page.fill("#add-input", "Pommes");
  await page.click(".add-submit");
  await page.locator(".item-check").check();

  await page.click("#btn-menu");
  await page.click('[data-action="manage-suggestions"]');
  await expect(page.locator(".suggestion-name")).toHaveText("Pommes");

  // Renomme "Pommes" en "Poires" et lui assigne la catégorie "Fruits".
  await page.locator(".suggestion-name").click();
  await page.locator(".modal .inline-edit").fill("Poires");
  await page.keyboard.press("Enter");
  await expect(page.locator(".suggestion-name")).toHaveText("Poires");
  await page.selectOption(".suggestion-category", { label: "Fruits" });
  await page.keyboard.press("Escape");

  // La suggestion mise à jour se retrouve dans les chips, catégorisée.
  await expect(page.locator("#quick-add .chip")).toHaveText(["+ Poires"]);
  await page.click("#quick-add .chip");
  await expect(page.locator(".category-section.has-color .item-name")).toHaveText("Poires");

  // Supprimer la suggestion puis annuler la restaure.
  await page.click("#btn-menu");
  await page.click('[data-action="manage-suggestions"]');
  await page.click('[data-action="del"]');
  await expect(page.locator(".manage-suggestion-list li")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await expect(page.locator("#undo-toast")).toContainText("« Poires » supprimée");
  await page.click("#undo-toast button");

  await page.click("#btn-menu");
  await page.click('[data-action="manage-suggestions"]');
  await expect(page.locator(".suggestion-name")).toHaveText("Poires");
});

test("gestion des suggestions : recherche et favoris", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  for (const name of ["Pommes", "Poires", "Lait"]) {
    await page.fill("#add-input", name);
    await page.click(".add-submit");
  }
  // Coche un article à la fois via ":not(:checked)" plutôt que par index :
  // cocher réordonne la liste (les cochés passent en fin), donc des index
  // fixes ("nth(1)", "nth(2)") finiraient par cibler le mauvais article.
  for (let i = 0; i < 3; i++) {
    await page.locator(".item-check:not(:checked)").first().check();
  }

  await page.click("#btn-menu");
  await page.click('[data-action="manage-suggestions"]');
  await expect(page.locator("#suggestion-list li")).toHaveCount(3);

  // Marque "Lait" comme favori : bascule dans une sous-section dédiée.
  await page.locator("#suggestion-list li", { hasText: "Lait" }).locator(".suggestion-favorite").click();
  await expect(page.locator(".recent-subheading")).toHaveText(["Favoris", "Autres"]);
  await expect(page.locator("#suggestion-list ul").first().locator(".suggestion-name")).toHaveText("Lait");

  // La recherche filtre par nom (triées par coche la plus récente d'abord :
  // "Poires" a été cochée après "Pommes").
  await page.fill("#suggestion-search", "po");
  await expect(page.locator(".suggestion-name")).toHaveText(["Poires", "Pommes"]);

  await page.fill("#suggestion-search", "introuvable");
  await expect(page.locator("#suggestion-list .hint")).toContainText("Aucune suggestion ne correspond");

  await page.fill("#suggestion-search", "");
  await expect(page.locator("#suggestion-list li")).toHaveCount(3);
});

test("une catégorie sans article dans la liste reste gérable mais ne s'affiche pas", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.click("#btn-menu");
  await page.click('[data-action="manage-categories"]');
  await page.fill("#new-category-name", "Fruits");
  await page.click("#new-category-form button[type=submit]");
  await expect(page.locator(".manage-category-list li")).toHaveCount(1);
  await page.fill("#new-category-name", "Légumes");
  await page.click("#new-category-form button[type=submit]");
  await expect(page.locator(".manage-category-list li")).toHaveCount(2);
  await page.keyboard.press("Escape");

  // Un seul article, dans "Fruits" : "Légumes" n'a rien à montrer et ne
  // doit pas encombrer la liste avec un en-tête vide.
  await page.selectOption("#add-category", { label: "Fruits" });
  await page.fill("#add-input", "Pommes");
  await page.click(".add-submit");

  await expect(page.locator(".category-name")).toHaveText(["Fruits"]);
  await expect(page.locator(".category-section")).toHaveCount(1);

  // Les deux catégories restent proposables/gérables ailleurs.
  await expect(page.locator("#add-category option")).toHaveText(["Sans catégorie", "Fruits", "Légumes"]);
  await page.click("#btn-menu");
  await page.click('[data-action="manage-categories"]');
  await expect(page.locator(".cat-name")).toHaveText(["Fruits", "Légumes"]);
});
