# TP1 Docker — 4 services avec Docker Compose

## Lancer

```bash
cp .env.example .env            # une seule fois
docker compose up -d --build    # dev : hot reload front + api
docker compose down             # arrete tout (les volumes sont conserves)
```

| Service | URL (dev) | Conteneur | Base |
|---|---|---|---|
| Front (Vite + React) | http://localhost:5173 | `tp1-front` | `node:24-bookworm-slim` |
| API (NestJS) | http://localhost:3000 | `tp1-api` | `node:24-bookworm-slim` |
| Mailpit | http://localhost:8025 | `tp1-mailer` | `axllent/mailpit:v1.30.7` |
| Postgres | localhost:5432 | `tp1-db` | `postgres:18.4-alpine` |

En dev tous ces ports sont lies a `127.0.0.1` : rien n'est expose au reseau local.
Ils sont paramétrables dans `.env` (`FRONT_PORT`, `API_PORT`, `DB_PORT`, `MAILPIT_PORT`).

**Sous OrbStack**, chaque conteneur recoit en plus un domaine HTTPS automatique :
https://front.tp1.orb.local, https://api.tp1.orb.local, https://mailer.tp1.orb.local.
Ils fonctionnent en dev comme en prod, sans configuration. Deux prerequis, tous deux
en place :
- `server.allowedHosts: ['.orb.local']` dans `front/vite.config.ts` — sinon Vite
  repond `403 Blocked request` a tout `Host` qu'il ne connait pas (anti-DNS-rebinding).
- le front proxifie `/api` (voir plus bas) — sinon la page HTTPS devrait appeler
  `http://localhost:3000`, que Chrome bloque faute d'en-tete
  `Access-Control-Allow-Private-Network`.

## Prod

```bash
docker compose -f compose.yaml -f compose.prod.yaml up -d --build
```

Un seul port publie, le **80**. Le front statique est servi par nginx, qui proxifie
`/api/` vers l'API : ni l'API, ni Postgres, ni Mailpit ne sont joignables depuis l'hote.

## Ce qu'on peut demontrer

- La page front appelle `GET /` : le message vient de l'API, le compteur de visites et l'heure viennent de Postgres.
- Bouton **Envoyer un mail** → `POST /mail` → le mail apparait dans Mailpit (http://localhost:8025).
- Champ **fichier** → `POST /upload` → le fichier est ecrit dans le volume `tp1-uploads`, la liste est relue par `GET /uploads`.
- `docker compose rm -sf db && docker compose up -d` : le compteur de visites ne repart pas a zero → la base est persistee.
- Editer `api/src/app.service.ts` ou `front/src/App.tsx` : la modif est prise en compte sans rebuild (~2s cote API).

## Les trois fichiers compose

| Fichier | Charge quand | Contient |
|---|---|---|
| `compose.yaml` | toujours | les 4 services, reseaux, volumes, healthchecks, noms d'images |
| `compose.override.yaml` | **automatiquement**, en dev | bind mounts `src/`, ports publies, `target: dev` |
| `compose.prod.yaml` | via `-f`, explicitement | `target: prod`, nginx sur le 80, `restart`, reseau interne cloisonne |

`docker compose up` charge `compose.yaml` **+ `compose.override.yaml`** sans qu'on ait
rien a demander : c'est une convention de Compose. C'est ce qui permet de ne jamais
taper d'option pour le cas courant (le dev) tout en gardant le fichier de base neutre.

Passer `-f` explicitement **desactive** ce chargement automatique. D'ou l'invariant :
la commande prod ne peut pas embarquer par accident un bind mount ou un port de dev,
puisque le fichier qui les porte n'est simplement pas lu.

Ce que l'override ajoute concretement, et que la prod ne doit surtout pas avoir :

```yaml
api:
  build: { target: dev }                  # stage nest build --watch, avec les devDependencies
  ports: ["127.0.0.1:3000:3000"]          # joignable depuis le navigateur
  volumes: ["./api/src:/app/api/src"]     # le code de l'hote, donc hot reload
```

## Choix techniques

**Nommage des images.** Chaque service porte un `image:` interpolé :

```yaml
image: ${REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-local}/tp1-api:${IMAGE_TAG:-dev}
```

`docker compose build` tague donc directement des noms poussables vers GHCR, et
`docker compose pull` fonctionne en deploiement. `IMAGE_TAG` est **volontairement non
defini** dans `.env` : le defaut depend du fichier compose (`dev` pour l'override,
`prod` pour la prod), pour que les deux environnements ne se marchent jamais dessus
sous un tag commun.

**Publication.** `.github/workflows/publish-images.yaml` se declenche sur tout tag
`v*` (ou a la main via *workflow_dispatch*) :

```bash
git tag v1.0.0 && git push --tags
# -> ghcr.io/grintzdel/tp1-{api,front,db,mailer}:v1.0.0  (+ :latest)
```

L'ordre des etapes est **build -> smoke test -> push** : le workflow demarre la stack
prod et verifie que nginx sert la page, que `/api` atteint Postgres, que l'upload
fonctionne en non-root et que ni l'API ni la db ne sont publiees. Une image qui echoue
a ces controles n'est jamais poussee.

Les `env_file` de `compose.yaml` etant gitignores, le workflow les regenere depuis les
`.env.example` : sans eux `docker compose config` echoue sur un clone frais.

> Les images sont construites pour l'architecture du runner, donc **linux/amd64**.
> Sur un Mac Apple Silicon, un `docker compose pull` les fera tourner en emulation.
> Passer en multi-arch demande un build separe du smoke test (une image
> multi-plateforme ne peut pas etre chargee dans le daemon local).

**Reseaux.** Deux bridges. `edge` porte front ↔ api ; `internal` porte api ↔ db et
api ↔ mailer. Postgres et Mailpit ne sont que sur `internal`, l'API est sur les deux.
En prod `internal` passe `internal: true` : la db n'a plus aucune route vers
l'exterieur, alors que l'API garde la sienne via `edge`. Le DNS de Compose resout les
**noms de service** (`db`, `mailer`), c'est pour ca que `api/.env` pointe `@db:5432`.

**Ordre de demarrage.** C'est ce que Compose apporte de plus net par rapport aux
scripts : la boucle `until pg_isready` devient declarative.

```yaml
depends_on:
  db: { condition: service_healthy }
```

Le healthcheck de l'API sonde `/uploads` et **pas** `/` : `GET /` insere une ligne dans
`visits`, un healthcheck dessus ferait grimper le compteur de visites tout seul.
Celui de Mailpit (`/mailpit readyz`) est herite de l'image de base, pas redeclare.

`AppService.onModuleInit` garde malgre tout son retry : `depends_on` couvre le `up`,
pas tous les redemarrages. Le pool `pg` a aussi un listener `error` — sans lui, perdre
la db (un `compose rm -sf db`) fait crasher le process Node au lieu de rouvrir une
connexion.

**Volumes.**
- `tp1-pgdata` → `/var/lib/postgresql` : persistance de la base. (Postgres 18 a deplace
  `PGDATA` vers `/var/lib/postgresql/18/docker`, c'est le parent qui est declare comme
  volume dans l'image.)
- `tp1-uploads` → `/app/api/uploads` : persistance des fichiers uploades.
- Les deux portent un `name:` explicite, sinon Compose les prefixerait (`tp1_tp1-pgdata`)
  et la base existante serait perdue.
- Bind mounts `./api/src` et `./front/src` en dev uniquement. On ne monte que `src/`
  pour ne pas ecraser le `node_modules` installe dans l'image (les deps Linux du
  conteneur ne sont pas celles de macOS).

**Variables d'environnement.** Deux mecanismes distincts, a ne pas confondre :
- `.env` a la racine → interpole **le fichier compose** (ports, nom des images).
  N'entre dans aucun conteneur.
- `db/.env`, `api/.env`, `front/.env` → injectes **dans les conteneurs** via `env_file:`.

Un `.env.example` est versionne a cote de chaque `.env`, et les `.env` sont gitignores :
rien n'est cuit dans l'image, la meme image peut tourner avec une autre config.

**Images multi-stage.** `deps` (install seul) → `dev` / `build` → `prod`.

- Le cache npm est monte (`RUN --mount=type=cache,target=/root/.npm npm ci`) : les
  rebuilds ne retelechargent rien. Un rebuild a chaud prend ~3s.
- `npm ci` et non `npm install` : installation deterministe depuis le lockfile.
  `node:24` est choisi pour son npm 11, qui resout le meme arbre que le npm local ;
  avec le npm 10 de `node:22`, `npm ci` echoue sur le `chokidar` de `nunjucks`.
- Les `.dockerignore` excluent `README.md`, `.git`, `test/` : editer la doc n'invalide
  plus la couche `COPY . .`.
- L'image prod de l'API ne contient que `dist/` et les dependances de production.

**Utilisateurs non-root.** L'API tourne en uid 1000 (`node`) en dev **et** en prod.
C'est necessaire, pas cosmetique : Docker ne recopie les droits de l'image que dans un
volume *vide*, donc un `tp1-uploads` ecrit en root par le dev serait illisible par une
prod non-root. Le front prod tourne en uid 101 (`nginx-unprivileged`, port 8080).
Seul le front **de dev** reste en root : le cache de pre-bundling de Vite vit dans
`node_modules`, cree par `npm ci`.

> Si un volume `tp1-uploads` anterieur a ce changement traine, le migrer une fois :
> `docker run --rm -v tp1-uploads:/u alpine chown -R 1000:1000 /u`

**Hot reload.**
- Front : Vite avec `server.host: true` (sinon il n'ecoute que sur 127.0.0.1 dans le
  conteneur, donc injoignable depuis l'hote) et `watch.usePolling: true` (les evenements
  inotify passent mal a travers un bind mount macOS → Linux).
- Back : `nest build --watch` recompile en continu, `node --watch dist/main.js` relance
  le process. `nest start --watch` a ete ecarte : dans le conteneur il relance l'app sans
  tuer l'ancien process, ce qui donne un `EADDRINUSE` sur le port 3000. `tsconfig.json`
  active aussi le polling via `watchOptions`, pour la meme raison que Vite.
- `api/docker-dev.sh` fait `rm -rf dist`, puis attend que le build ait produit
  `dist/main.js` avant de lancer `node`. Le `rm -rf` est indispensable :
  `nest build --watch` vide `dist/` a son demarrage, donc au `docker compose start`
  `node --watch` demarrerait sur l'ancien `dist/` et perdrait son watcher quand le build
  l'efface — l'API restait "Up" sans repondre sur le 3000.

**Le front appelle toujours `/api`, en dev comme en prod.** `VITE_API_URL` vaut `/api`
partout : c'est une variable de **build** (Vite l'inline dans le bundle), passee en
`build.args` en prod et lue depuis `front/.env` en dev. Ce qui porte le prefixe differe
selon l'environnement, le code non :

| | Qui proxifie `/api` | Vers |
|---|---|---|
| dev | `server.proxy` de Vite (`vite.config.ts`) | `http://api:3000` |
| prod | nginx (`front/nginx.conf`) | `http://api:3000` |

Les deux retirent le prefixe (`rewrite` cote Vite, slash final de `proxy_pass` cote
nginx). Consequences : `App.tsx` est identique dans les deux environnements, l'image
front n'est liee a aucune URL d'API absolue, le navigateur ne fait que des requetes
same-origin — donc aucun CORS, aucun contenu mixte — et la page fonctionne quel que
soit le nom par lequel on l'atteint (`localhost`, `*.orb.local`, une IP du LAN).

`app.enableCors()` reste cote Nest : il ne sert plus au front, mais il permet d'attaquer
l'API directement (curl, Postman) sur le port publie en dev.

> `vite.config.ts` n'est pas dans le bind mount (seul `src/` l'est) : le modifier
> demande un `docker compose up -d --build front`.

**Dockerfiles.** Les 4 services ont leur Dockerfile, meme `db/` et `mailer/` qui ne font
qu'un `FROM` : tout se build et se tague de la meme facon, et on garde un point
d'accroche si un jour il faut ajouter un script d'init SQL ou une config Mailpit.
