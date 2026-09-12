# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commandes

```bash
npm install

npm run dev            # vite dev — Worker + Durable Object (via workerd) et client dans le même processus
npm run lint           # oxlint --deny-warnings
npm run typecheck      # tsc --noEmit sur tsconfig.worker.json PUIS tsconfig.client.json (deux projets séparés)
npm run test           # vitest run (sans couverture)
npm run test:watch     # vitest en mode watch
npm run test:coverage  # vitest run --coverage — seuils 100%, mais sur un périmètre restreint (voir Tests ci-dessous)
npm run test:e2e       # playwright test — démarre lui-même `vite dev` (voir playwright.config.ts)
npm run build          # npm run typecheck && vite build (build double : environment "worker" + environment "client")
npm run preview        # vite preview
npm run deploy         # npm run build && wrangler deploy (nécessite `npx wrangler login` au préalable)
npm run cf-typegen     # régénère les types Cloudflare (env bindings) depuis wrangler.json
```

Lancer un seul test ou fichier :

```bash
npx vitest run worker/reducer.test.ts
npx vitest run -t "nom du test"
npx playwright test e2e/golden-path.spec.ts
npx playwright test e2e/golden-path.spec.ts -g "nom du test"
```

## Architecture

App de liste de courses partagée en temps réel, hébergée entièrement sur Cloudflare (Workers + Durable Objects, sans base de données externe). Un seul package npm, trois zones de code partageant un même pipeline vite/`@cloudflare/vite-plugin` :

- `worker/` — le Worker Cloudflare (routing HTTP) et un Durable Object `ListRoom` par liste. C'est l'unique code serveur et la seule source de vérité ; tout le reste dérive ou met en cache ce qu'il contient.
- `shared/` — types et logique pure utilisés à la fois par le Worker et le navigateur (parsing, clé de dédoublonnage). Aucun effet de bord, entièrement testé unitairement.
- `src/` — le client (SPA sans framework, rendu par gabarits HTML en template literals + délégation d'événements).

### Durable Object et protocole de synchronisation

- Chaque liste est adressée par son code à 6 caractères via `env.LIST_ROOM.idFromName(code)` (`worker/index.ts`) — jamais par un id séquentiel ou une base de données.
- `ListRoom` (`worker/listRoom.ts`) garde l'état complet de la liste (`ListState`, `shared/types.ts`) en mémoire, le persiste comme un seul blob JSON, et rediffuse l'état **entier** (pas un diff) à tous les clients connectés via WebSocket Hibernation API (`ctx.acceptWebSocket`, `ctx.getWebSockets()`) à chaque mutation.
- Toute la logique de mutation est isolée dans `worker/reducer.ts` : `applyMessage(state, msg)` est une fonction pure, avec un switch exhaustif sur `ClientMessage` (`shared/types.ts`), qui mute `state` en place. `listRoom.ts` lui-même n'est qu'une fine couche (chargement → déchiffrement → `applyMessage` → persistance chiffrée → diffusion) — voir « Tests » ci-dessous pour pourquoi il n'est volontairement pas testé unitairement. Toute nouvelle logique de mutation doit aller dans `reducer.ts`, pas dans `listRoom.ts`.
- Côté client, `src/lib/ws.ts` (`ListConnection`) possède la connexion WebSocket : reconnexion automatique avec backoff exponentiel (1s, ×1.7, plafonné à 15s), file d'attente des messages sortants vidée à la reconnexion, et un pub/sub (`onState`/`onPresence`/`onError`/`onConnectionChange`). `src/views/list.ts` est le seul consommateur ; en dehors de cette classe, il ne parle au Worker que via de simples `fetch` ponctuels (`src/lib/http.ts`) pour créer/lire une liste.
- Chaque liste est chiffrée au repos (`worker/crypto.ts`, AES-GCM via Web Crypto, clé dérivée par SHA-256 du code de la liste — jamais stockée séparément). Le code n'étant jamais dans le texte chiffré lui-même (problème d'œuf et de poule), le déchiffrement au chargement utilise le nom de l'instance Durable Object (`this.ctx.id.name`, toujours renseigné puisque chaque instance est créée via `idFromName(code)`) ; `persist()` a de son côté toujours le code en mémoire. Le format de stockage distingue chiffré (`{ encrypted: true, iv, ciphertext }`) de l'ancien format en clair par la simple présence de la clé `encrypted` — une liste créée avant l'introduction du chiffrement est lue en clair puis rechiffrée silencieusement à sa prochaine écriture (migration paresseuse, à sens unique, sans étape explicite nulle part).

### Architecture client

- Pas de framework : `src/main.ts` est un routeur minimal (`popstate`/`pushState`, ne distingue que `/l/:code` du reste) qui monte soit `src/views/home.ts` soit `src/views/list.ts` dans `#app`, après avoir appelé le `cleanup()` de la vue précédente. Les vues se rendent en assignant `innerHTML` à partir de gabarits HTML en template literals (voir par ex. `layoutHtml`/`itemRowHtml`/`categoryOptionsHtml` dans `list.ts`) puis rebranchent leurs écouteurs après chaque rendu — pas de virtual DOM ni de diffing.
- `src/views/list.ts` (~1100 lignes) est la vue centrale et de loin le plus gros fichier : elle possède la connexion WebSocket, l'état d'optimistic update local, la pile d'annulation, le glisser-déposer/swipe-to-delete, et toutes les modales (partage, gestion des catégories, gestion des suggestions, import). Toute nouvelle fonctionnalité de la vue liste touche presque toujours ce fichier — chercher ses nombreuses déclarations `function` plutôt que de s'attendre à un découpage en composants séparés.
- Cache local-first : `src/lib/storage.ts` garde le dernier `ListState` connu par code dans `localStorage` (`nldc:cache:<code>`), pour un rendu instantané (potentiellement périmé) avant même que le WebSocket ne se connecte ; remplacé dès le premier message `state` reçu. Gère aussi les listes récemment ouvertes/favorites de l'accueil.
- Les préférences personnelles par appareil (thème, mode accessibilité, tri des articles, masquage des cochés) sont des petits modules indépendants sous `src/lib/` (`theme.ts`, `accessibility.ts`, `itemSortPreference.ts`, `hideCheckedPreference.ts`), qui suivent tous le même schéma : `get*Preference()` lit `localStorage` de façon défensive (ne lève jamais, valeur par défaut sensée), `set*/cycle*Preference()` persiste puis (pour thème et accessibilité) pose un attribut `data-*` sur `<html>` lu par `style.css`. Ce sont des réglages d'affichage personnels, jamais synchronisés via le `ListState` partagé.
- Annulation (undo) : les actions destructrices (suppression d'article/catégorie/entrée d'historique, vidage des cochés) passent par une pile `pushUndo(label, undo)` (`list.ts`) avec un toast de 5s plutôt qu'une confirmation bloquante — `undo()` renvoie des `ClientMessage` de compensation (`restoreItems`/`restoreCategory`/`restoreHistoryEntry`) qui reconstruisent l'état exact précédent (id/ordre/coché/compteur d'usage préservés) plutôt que de le redériver.
- Confirmation au même endroit : séparément, les boutons icône d'action destructrice isolée (supprimer un article, vider les cochés) utilisent `src/lib/confirmClick.ts` (`wireConfirmClick`) — un premier clic arme le bouton (relabellisé 3s), un second clic au même endroit confirme. Orthogonal à la pile d'annulation ci-dessus (les deux se cumulent).

### Double déploiement (un seul Worker, deux origines front)

- Déploiement canonique : Cloudflare Workers sert à la fois le Worker (API/WebSocket) et le client buildé en tant qu'assets statiques depuis une seule origine (`wrangler.json`, `assets.not_found_handling: "single-page-application"`).
- Le même client est aussi publié sur GitHub Pages (`.github/workflows/pages.yml`) comme seconde origine, purement statique, qui parle au même Worker Cloudflare via CORS. Ça ne fonctionne que grâce à deux indirections côté client, no-op dans le déploiement Cloudflare seul :
  - `src/lib/syncWorker.ts` (`apiUrl`/`wsUrl`) préfixe les appels API/WS avec `VITE_SYNC_WORKER_URL` (variable d'environnement au build, définie seulement par `pages.yml`) — absente, les chemins `/api/...` restent relatifs.
  - `src/lib/basePath.ts` (`appPath`/`routePath`) ajoute/retire `import.meta.env.BASE_URL` pour que le routeur et les liens de partage restent corrects servis depuis un sous-chemin de dépôt de projet (`/koikimanke/`) plutôt qu'une racine de domaine. `vite.config.ts`'s `base` est piloté par la même variable `VITE_BASE_PATH`.
  - CORS n'est nécessaire que pour les endpoints JSON (`worker/index.ts`, `CORS_HEADERS`) — les upgrades WebSocket n'y sont jamais soumis par les navigateurs.

### CI/CD

- `ci.yml` : lint, vérification des types, tests unitaires+couverture, tests e2e et audit des dépendances en parallèle, puis un job `build` qui dépend de tous les précédents. Sur une PR, le client buildé est aussi uploadé comme artefact de prévisualisation.
- `deploy.yml` (Cloudflare) et `pages.yml` (GitHub Pages) se déclenchent tous les deux via `workflow_run` à la fin de CI sur `main` (jamais sur un push direct) — un `main` cassé n'est donc jamais redéployé. Les deux acceptent aussi `workflow_dispatch` pour un redéclenchement manuel. `deploy.yml` fait en plus un test de fumée post-déploiement (accueil 200, un code de liste non attribué 404) et pousse un tag `deploy-N` pour repérer/revenir à une version.
- `codeql.yml` tourne sur push/PR vers `main` et une fois par semaine.

### Tests

- La couverture 100% (`vitest.config.ts`) ne porte que sur `shared/**`, `worker/**` et deux modules purs de `src/lib/` (`color.ts`, `sort.ts`) — volontairement, pas sur tout le dépôt :
  - `worker/listRoom.ts` est explicitement exclu : c'est la fine couche Durable Object (stockage, hibernation WebSocket) qui aurait besoin d'un vrai runtime Workers pour être testée utilement ; sa logique métier vit entièrement dans `reducer.ts`, qui lui est testé à 100%. Son comportement propre n'est vérifié que par la suite e2e (voir `e2e/encryption.spec.ts`, `e2e/sync.spec.ts`).
  - Le code de vue/composant DOM-lourd (`src/views/`, `src/components/`, la glue DOM/stockage/réseau de `src/lib/`) est volontairement laissé à la suite Playwright plutôt que d'être forcé dans des tests unitaires qui n'auraient pas de sens.
  - `worker/test/cloudflareWorkersShim.ts` fournit un faux module `cloudflare:workers` (alias dans `vitest.config.ts`) pour que les fichiers qui importent `DurableObject` (`worker/listRoom.ts` — non testé, mais quand même importé transitivement) puissent être chargés par Vitest sous Node, sans le runtime `workerd`.
- La suite e2e (`e2e/*.spec.ts`) tourne contre une vraie instance `vite dev` (Worker + Durable Object réels via `workerd`), démarrée par Playwright lui-même (`playwright.config.ts`, `webServer`). C'est le seul moyen de tester la synchronisation temps réel multi-onglets, le chiffrement de bout en bout, et tout ce qui dépend du DOM.

## Fonctionnalités

Détail de ce que fait l'app et où c'est implémenté (au-delà du résumé du README) :

- **Temps réel multi-appareils** : un `ListRoom` par code, diffusion de l'état entier à chaque mutation (`worker/listRoom.ts`), reconnexion auto côté client (`src/lib/ws.ts`).
- **Présence** : chaque connexion a un nom d'appareil généré une fois et stable (`src/lib/presence.ts`, `worker/presence.ts`), diffusé et affiché en direct (`renderPresence` dans `list.ts`).
- **Saisie libre avec quantité extraite** : `shared/quantity.ts` (`parseFreeText`) détecte un nombre + unité (`"2 kg pommes"`, `"pommes 2 kg"`) ou un simple multiplicateur (`"x3"`, `"3x"`) au début ou à la fin du texte saisi, et sépare quantité/nom ; la quantité s'affiche dans un badge modifiable en un clic (`startEdit`, `src/lib/editable.ts`).
- **Catégories** : CRUD complet, couleur automatique déterministe par id (`src/lib/color.ts`, hash → teinte HSL) ou manuelle parmi 12 teintes curées (`colorPaletteHtml` dans `list.ts`), réordonnables par glisser-déposer (`src/lib/dnd.ts`) ; le sélecteur de catégorie à l'ajout est trié alphabétiquement (`src/lib/sort.ts`, `alnumCompare`) mais l'affichage dans la liste respecte l'ordre manuel des catégories.
- **Priorité des articles** : trois niveaux (Basse/Normale/Haute), cyclables par clic sur une barre verticale colorée à côté de la case à cocher — n'affecte jamais l'ordre des articles ni des catégories (`worker/reducer.ts` pour le champ, `itemRowHtml` dans `list.ts` pour le rendu).
- **Déplacement des articles** : glisser-déposer souris/tactile entre catégories (`src/lib/dnd.ts`, pointer events, sans dépendance externe) ; sur tactile, glisser un article vers la gauche le supprime (`src/lib/swipe.ts`), avec la même annulation que les autres suppressions.
- **Mémoire des articles et suggestions** : chaque article coché (pas simplement ajouté — voir le commentaire dans `reducer.ts`'s `toggleItem`) enrichit un historique par liste (`touchHistory`, plafonné à 300 entrées avec éviction LRU sauf favoris) ; sert des chips de "quick add" (`renderQuickAdd`) et l'autocomplétion pendant la saisie, gérables en détail (renommer, changer de catégorie, marquer favori, supprimer) via le gestionnaire de suggestions (`openSuggestionManager` dans `list.ts`).
- **Partage** : code à 6 caractères sans caractères ambigus (`worker/index.ts`, `CODE_CHARS`), QR code (`src/components/qr.ts` + `qrcode`), lien direct `/l/CODE`, partage natif du téléphone (`navigator.share`) quand disponible.
- **Import / export JSON** : export en un fichier nommé par un slug du nom de la liste (`src/lib/importExport.ts`) ; import en fusion (dédoublonnage des articles par `historyKey`, catégories réconciliées par nom) ou en remplacement complet (`applyMessage`'s cas `importState` dans `reducer.ts`).
- **Hors-ligne minimal** : dernière version connue de chaque liste en cache local (`src/lib/storage.ts`), rendu instantané avant connexion, reconnexion automatique.
- **Installable (PWA)** : manifest + service worker générés par `vite-plugin-pwa` (`vite.config.ts`), avec `/api/*` explicitement exclu du cache de navigation.
- **Annulation** et **confirmation en place** : voir la section Architecture client ci-dessus (`pushUndo`, `wireConfirmClick`).
- **Thème clair/sombre/auto** : `src/lib/theme.ts`, attribut `data-theme` sur `<html>` + variables CSS, respecte aussi `prefers-color-scheme` par défaut.
- **Mode accessibilité** : `src/lib/accessibility.ts`, attribut `data-a11y="on"` sur `<html>`. Un seul attribut pilote trois effets dans `style.css` : texte/icônes/paddings agrandis de 25% (presque tout `style.css` est déjà en rem/em, la police racine suffit à tout faire grossir en cascade — avec des marges latérales volontairement réduites en contrepartie sur les conteneurs principaux pour ne pas perdre en largeur utile) ; contraste renforcé (texte/bordures nettement plus marqués, un jeu de couleurs par état de thème clair/sombre) ; transitions et animations coupées partout via `transition-duration`/`animation-duration: 0s !important` (l'emporte même sur les transitions posées en ligne par le JS, comme le swipe-to-delete ou les toasts).
- **Recherche** : filtre les articles affichés par nom (barre de recherche dans `list.ts`).
- **Célébration** : cocher le dernier article déclenche un toast animé — pas au simple rechargement d'une liste déjà entièrement cochée (`wasFullyChecked` dans `list.ts`, initialisé à `null` pour distinguer "pas encore évalué" de "était déjà complète").
- **Icônes SVG maison** : `src/lib/icons.ts`, trait 2px `currentColor`, pas d'emoji (rendu dépendant de la plateforme).
- **Chiffrement au repos** : voir la section Durable Object ci-dessus (`worker/crypto.ts`).
- **Accessibilité de base** : focus piégé et restauré dans les modales (`src/lib/focusTrap.ts`), navigation clavier, en plus du mode accessibilité optionnel ci-dessus.
- **Préférences d'affichage optionnelles** : masquer les articles cochés, tri alphabétique des articles (au lieu de l'ordre manuel) — `src/lib/hideCheckedPreference.ts` / `src/lib/itemSortPreference.ts`, persistées par appareil.
- **Retour haptique** : `navigator.vibrate?.(10)` à la coche d'un article sur mobile (`list.ts`).
