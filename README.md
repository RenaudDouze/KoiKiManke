# Notre Liste de Courses

Une liste de courses partagée en temps réel, à héberger entièrement sur
Cloudflare (Workers + Durable Objects, sans base de données externe).

## Fonctionnalités

- **Partage en temps réel** : chaque liste vit dans un Durable Object
  identifié par un code à 6 caractères ; tous les appareils connectés sont
  synchronisés instantanément via WebSocket.
- **Partage facile** : code, QR code et lien direct (`/l/CODE`), avec le
  partage natif du téléphone quand il est disponible.
- **Saisie libre avec quantité mise en avant** : tape par exemple
  `2 kg pommes` ou `yaourts x8`, l'app détecte la quantité et l'affiche dans
  un badge séparé, modifiable en un clic.
- **Catégories** : crée des catégories, fais glisser les articles entre
  elles, réordonne les catégories elles-mêmes.
- **Déplacement des articles** par glisser-déposer (souris et tactile).
- **Mémoire des articles** : chaque article déjà ajouté enrichit un
  historique par liste, utilisé pour des suggestions rapides (chips) et
  l'autocomplétion pendant la saisie.
- **Import / export** au format JSON, avec fusion ou remplacement à
  l'import.
- **Hors-ligne minimal** : la dernière version connue de chaque liste est
  gardée en cache local, avec reconnexion automatique.

## Stack technique

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) +
  [Durable Objects](https://developers.cloudflare.com/durable-objects/)
  (une instance par liste, stockage + diffusion WebSocket).
- [Vite](https://vite.dev/) + [`@cloudflare/vite-plugin`](https://developers.cloudflare.com/workers/vite-plugin/)
  pour un dev loop unique (front + Worker tournent dans le même processus,
  avec `workerd`).
- TypeScript, sans framework front (DOM direct) pour rester léger.
- [`qrcode`](https://www.npmjs.com/package/qrcode) pour générer les QR codes
  côté client.

## Démarrer en local

```bash
npm install
npm run dev
```

Ouvre l'URL affichée (`http://localhost:5173` par défaut). Le plugin
Cloudflare fait tourner le Worker et le Durable Object localement.

## Déployer sur Cloudflare

```bash
npm run deploy
```

Ceci build le front (`vite build`, qui produit aussi une config Wrangler
prête à l'emploi dans `dist/`) puis déploie avec `wrangler deploy`. Il faut
être connecté à un compte Cloudflare (`npx wrangler login` la première
fois).

## Structure du projet

```
worker/            Worker Cloudflare (routes API) + Durable Object ListRoom
shared/            Types et logique partagés entre le Worker et le client
                    (parsing de quantité inclus)
src/                Application front (vue Accueil / vue Liste, composants,
                    utilitaires : websocket, drag & drop, stockage local…)
wrangler.json       Configuration Cloudflare (Durable Object, assets SPA)
```

## Modèle de données

Chaque liste est un unique objet JSON stocké dans son Durable Object :
articles, catégories, historique des noms déjà utilisés. Les mutations
(ajout, coche, déplacement, catégories…) sont envoyées en WebSocket sous
forme de petits messages typés (`shared/types.ts`), appliquées côté serveur,
persistées puis rediffusées à tous les clients connectés.
