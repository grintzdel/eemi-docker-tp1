# TP1 Docker — 4 services avec Docker Compose

Stack : **Vite/React** → **NestJS** → **Postgres**, plus **Mailpit** pour capturer les mails.
Orchestration par Docker Compose, en dev (hot reload) comme en prod (nginx, images minimales).

```bash
cp .env.example .env
for d in api db front; do cp $d/.env.example $d/.env; done

docker compose up -d --build      # dev  → http://localhost:5173
docker compose down               # stop (volumes conserves)
```

---

# Plan de route

Les fiches se lisent dans cet ordre : on construit une image, on la fait tourner, on
orchestre plusieurs conteneurs, on publie. Chaque fiche finit par une ligne **Ici** qui
montre l'usage reel dans ce projet.

| # | Etape | Fiches |
|---|---|---|
| 1 | **Le vocabulaire** | [Image et conteneur](#image-et-conteneur) · [Layers & cache](#les-layers-et-le-cache) · [Tag & digest](#tag-et-digest) |
| 2 | **Construire une image** | [Le Dockerfile](#le-dockerfile) · [ARG vs ENV](#arg-vs-env) · [CMD vs ENTRYPOINT](#cmd-vs-entrypoint) · [EXPOSE vs -p](#expose-vs--p) |
| 3 | **Construire mieux** | [Ordre et cache](#optimiser-le-cache-de-build) · [Cache mount](#le-cache-mount-buildkit) · [Multi-stage](#le-multi-stage-build) · [.dockerignore](#le-dockerignore) · [Ne pas tourner en root](#ne-pas-tourner-en-root) |
| 4 | **Faire tourner** | [Volumes](#les-volumes) · [Bind mounts](#les-bind-mounts) · [Reseaux](#les-reseaux) · [Publier un port](#publier-un-port) · [Variables d'env](#les-variables-denvironnement) · [Healthcheck](#le-healthcheck) · [Restart](#les-politiques-de-redemarrage) |
| 5 | **Orchestrer** | [Compose](#docker-compose) · [Plusieurs fichiers](#plusieurs-fichiers-compose) · [depends_on](#depends_on-et-les-conditions) · [Interpolation vs env_file](#interpolation-vs-env_file) |
| 6 | **Publier** | [Registry & GHCR](#les-registries-et-ghcr) · [Versionner](#versionner-les-images) |
| 7 | **Le reste** | [Outils](#les-outils-utilises) · [Pieges rencontres](#les-pieges-rencontres) · [Architecture du projet](#larchitecture-de-ce-projet) · [Ce qui reste](#ce-qui-reste-a-faire) |

---

# Le vocabulaire

## Image et conteneur

```bash
docker build -t mon-image .     # fabrique une IMAGE
docker run mon-image            # lance un CONTENEUR a partir de l'image
docker images                   # lister les images
docker ps                       # lister les conteneurs qui tournent
```

**Une image** = un modele fige, en lecture seule. C'est une recette figee : le systeme de
fichiers + la commande a lancer. Elle ne « tourne » pas.

**Un conteneur** = une instance vivante d'une image. On peut en lancer dix depuis la meme
image ; chacun a sa propre couche d'ecriture, jetee quand on le supprime.

La comparaison qui marche : l'image est la **classe**, le conteneur est l'**objet**.

**Une image n'est pas une machine virtuelle.** Une VM embarque un noyau complet ; un
conteneur partage le noyau de l'hote et n'isole que les processus, le reseau et les
fichiers. C'est pour ca qu'il demarre en une seconde au lieu d'une minute.

> **Ici** : 4 images (`tp1-api`, `tp1-front`, `tp1-db`, `tp1-mailer`), 4 conteneurs.

## Les layers et le cache

```bash
docker history mon-image        # voir les couches et leur poids
```

**Un layer** (couche) = le resultat d'**une** instruction du Dockerfile. Chaque `RUN`,
`COPY`, `ADD` en cree une nouvelle, empilee sur la precedente.

**Le cache** : au rebuild, Docker reutilise une couche tant que l'instruction **et** ce
qu'elle copie n'ont pas change. Des qu'une couche est invalidee, **toutes celles du
dessous le sont aussi**. D'ou la regle : ce qui change rarement se place en haut.

Les couches sont partagees entre images. Deux images basees sur `node:24` ne stockent
ce `node:24` qu'une fois sur le disque.

## Tag et digest

```bash
docker pull postgres:18.4-alpine                  # tag : lisible, mais mouvant
docker pull postgres@sha256:abc123...             # digest : immuable
docker tag mon-image ghcr.io/user/mon-image:v1.0.0
```

**Un tag** = une etiquette lisible posee sur une image (`v1.0.0`, `latest`, `dev`). Un tag
peut etre **deplace** : le `latest` d'aujourd'hui n'est pas celui d'hier.

**Un digest** = l'empreinte SHA-256 du contenu. Il ne bouge jamais. C'est la seule
reference vraiment reproductible.

**`latest` n'est pas « la derniere version »**, c'est juste le tag par defaut quand on
n'en precise aucun. Un `latest` peut tres bien etre plus vieux qu'un `v2.0.0`.

> **Ici** : les images de base sont epinglees (`postgres:18.4-alpine`,
> `axllent/mailpit:v1.30.7`) plutot que laissees en `latest`.

---

# Construire une image

## Le Dockerfile

```dockerfile
FROM node:24-bookworm-slim     # image de depart
WORKDIR /app/api               # repertoire de travail (et le cree)
COPY package.json ./           # hote -> image
RUN npm ci                     # execute AU BUILD, cree une couche
ENV NODE_ENV=production        # variable presente au build ET au runtime
EXPOSE 3000                    # documentation : ce port est prevu
USER node                      # l'utilisateur des instructions suivantes
CMD ["node", "dist/main.js"]   # executee AU DEMARRAGE du conteneur
```

La distinction a retenir : **`RUN` s'execute pendant le build** et laisse une trace dans
l'image ; **`CMD` s'execute au lancement** du conteneur et ne laisse rien.

`COPY` vs `ADD` : les deux copient, mais `ADD` sait aussi telecharger une URL et
decompresser une archive. Ce sont deux comportements implicites qu'on ne veut en general
pas — **prefere `COPY`**.

## ARG vs ENV

```dockerfile
ARG VITE_API_URL=/api          # disponible SEULEMENT pendant le build
ENV NODE_ENV=production        # disponible au build ET dans le conteneur
```

```bash
docker build --build-arg VITE_API_URL=/api .
docker run -e NODE_ENV=production mon-image
```

**`ARG`** = un parametre de build. Il disparait une fois l'image construite : impossible
de le lire depuis un conteneur.

**`ENV`** = une variable d'environnement qui **persiste dans l'image** et se retrouve dans
tout conteneur qui en est issu.

⚠️ **Ni l'un ni l'autre ne sert a un secret.** `docker history` revele les `ARG`, et `ENV`
est lisible dans l'image. Un mot de passe se passe au **runtime** (`--env-file`), jamais au
build.

> **Ici** : `VITE_API_URL` est un `ARG`, parce que Vite l'inline dans le bundle au moment
> du build. En changer la valeur exige de reconstruire l'image.

## CMD vs ENTRYPOINT

```dockerfile
CMD ["node", "dist/main.js"]           # remplacable : docker run img autre-commande
ENTRYPOINT ["/mailpit"]                # fixe : les arguments s'y ajoutent
```

**`CMD`** = la commande par defaut, **ecrasee** par ce qu'on passe a `docker run`.

**`ENTRYPOINT`** = l'executable impose ; ce qu'on passe a `docker run` devient ses
**arguments**.

Ensemble, `ENTRYPOINT ["git"]` + `CMD ["--help"]` donnent un conteneur qui se comporte
comme la commande `git`.

Toujours preferer la **forme JSON** (`["node", "x.js"]`) a la forme shell (`node x.js`) :
en forme shell, le processus est lance sous un `/bin/sh -c` qui ne transmet pas les
signaux, et le conteneur met 10 s a s'arreter au lieu de s'arreter tout de suite.

## EXPOSE vs -p

```dockerfile
EXPOSE 3000                    # DOCUMENTE : « ce conteneur ecoute sur 3000 »
```

```bash
docker run -p 8080:3000 img    # PUBLIE : hote:8080 -> conteneur:3000
```

**`EXPOSE` n'ouvre rien du tout.** C'est une annotation lue par les humains et par
certains outils. Un conteneur sans `EXPOSE` est joignable pareil.

**`-p` (ou `ports:`)** est ce qui ouvre reellement un acces depuis l'hote.

Deux conteneurs sur le meme reseau Docker se parlent **sans aucun `-p`** : publier ne sert
qu'a entrer depuis l'exterieur.

> **Ici** : en prod, seul le front publie un port. L'API et Postgres ecoutent, sont
> joignables entre conteneurs, et restent inaccessibles depuis l'hote.

---

# Construire mieux

## Optimiser le cache de build

```dockerfile
# ✅ les dependances d'abord : elles changent rarement
COPY package.json package-lock.json ./
RUN npm ci
COPY . .                       # le code change tout le temps -> en dernier

# ❌ l'inverse : la moindre ligne de code relance npm ci
COPY . .
RUN npm ci
```

Le principe tient en une phrase : **ce qui change le moins souvent se place le plus haut**.

Comme l'invalidation d'une couche invalide tout ce qui suit, copier le code avant
d'installer les dependances condamne a reinstaller tout `node_modules` a chaque virgule
modifiee.

## Le cache mount (BuildKit)

```dockerfile
# syntax=docker/dockerfile:1.7
RUN --mount=type=cache,target=/root/.npm npm ci
```

**Un cache mount** = un dossier persistant **entre deux builds**, qui n'est pas stocke
dans l'image finale.

Ici, meme quand la couche `npm ci` est invalidee et doit etre rejouee, npm retrouve ses
paquets deja telecharges dans `/root/.npm` et ne repasse pas par le reseau.

Il faut **BuildKit** (le moteur de build moderne, actif par defaut depuis Docker 23) et la
ligne `# syntax=` en tete de fichier.

> **Ici** : un rebuild a chaud des 4 images prend **3 secondes**.

## Le multi-stage build

```dockerfile
FROM node:24-slim AS deps      # etape 1 : dependances
RUN npm ci

FROM deps AS build             # etape 2 : compilation
RUN npm run build

FROM node:24-slim AS prod      # etape 3 : l'image finale
COPY --from=build /app/dist ./dist   # on ne recupere QUE le resultat
```

```bash
docker build --target dev .    # construire une etape precise
```

**Un multi-stage** = plusieurs `FROM` dans un seul Dockerfile. Seule la derniere etape (ou
celle visee par `--target`) devient l'image finale ; `COPY --from=` va chercher des
fichiers dans les precedentes.

L'interet : **les outils de compilation ne suivent pas en production**. Le compilateur,
les devDependencies, les sources restent dans l'etape de build et sont jetes.

> **Ici** : le front prod pese **83 Mo** (nginx + fichiers statiques) contre **461 Mo**
> pour l'image de dev. Ni Node, ni npm, ni les sources ne sont dans l'image finale.

## Le .dockerignore

```
.git
node_modules
dist
.env
README.md
```

**Le contexte de build** = tout ce que le client Docker envoie au demon avant de
construire. Sans filtre, ca inclut `node_modules`, `.git`, tout.

**`.dockerignore`** exclut ces fichiers du contexte. Deux effets : le build demarre plus
vite, et surtout **editer un fichier ignore n'invalide plus le cache**.

Le troisieme effet est la securite : un `.env` ou un `.git` exclu ne risque plus d'etre
embarque par un `COPY . .` distrait.

> **Ici** : sans `README.md` dans le `.dockerignore`, ecrire cette documentation
> reconstruisait les images a chaque sauvegarde.

## Ne pas tourner en root

```dockerfile
RUN mkdir -p uploads && chown node:node uploads
USER node                      # tout ce qui suit tourne en uid 1000
```

**Par defaut, un conteneur tourne en root.** Root dans le conteneur, c'est l'uid 0 du
noyau de l'hote : si une faille permet de sortir du conteneur, on en sort administrateur.

`USER` fait tomber les privileges. Le reflexe : creer les dossiers necessaires **et leur
donner le bon proprietaire** avant de basculer.

⚠️ **Piege des volumes** : Docker ne recopie les droits de l'image que dans un volume
**vide**. Un volume deja ecrit en root restera illisible pour un conteneur non-root.

> **Ici** : l'API tourne en uid 1000 en dev **et** en prod, justement pour que le volume
> `tp1-uploads` reste coherent. Le front prod utilise `nginx-unprivileged` (uid 101).

---

# Faire tourner

## Les volumes

On cree un volume avec le flag :

```bash
# volume anonyme
-v ${chemin_conteneur}

# volume nomme
-v base_de_donnee:${chemin_conteneur}
```

```bash
docker volume create base_de_donnee
docker volume ls
docker volume inspect base_de_donnee
```

**Volume nomme** = C'est un stockage gere par Docker, vous ne voyez pas les fichiers de
votre cote et c'est beaucoup utilise pour des donnees SQL, des medias, etc...

**Volume anonyme** c'est comme un volume nomme, sauf que la creation d'un nouveau
conteneur ne pourra pas permettre de retrouver le volume existant. C'est un volume
« jetable ».

Le point essentiel : **la couche d'ecriture d'un conteneur meurt avec lui**. Sans volume,
supprimer le conteneur Postgres supprime la base. Le volume, lui, survit — c'est meme
pour ca que `docker compose down` **ne le supprime pas** (il faut `down -v`).

> **Ici** : `tp1-pgdata` porte la base, `tp1-uploads` les fichiers envoyes. Detruire le
> conteneur `db` et le relancer ne remet pas le compteur de visites a zero.

## Les bind mounts

```bash
-v /chemin/sur/lhote:/chemin/dans/le/conteneur
-v "$PWD/api/src:/app/api/src"
-v "$PWD/config.yaml:/app/config.yaml:ro"   # :ro = lecture seule
```

**Un bind mount** monte un **vrai dossier de votre machine** dans le conteneur. Contrairement
au volume nomme, vous voyez et editez les fichiers directement.

C'est ce qui rend le **hot reload** possible : le code modifie sur l'hote est
instantanement visible dans le conteneur, sans rebuild.

⚠️ Un bind mount **masque** ce qui existait a cet endroit dans l'image. Monter tout un
dossier de projet ecraserait le `node_modules` installe au build — or les binaires Linux
du conteneur ne sont pas ceux de macOS.

> **Ici** : on ne monte que `./api/src` et `./front/src`, jamais la racine, pour cette
> raison exacte. Et seulement en dev : la prod n'a aucun bind mount.

## Les reseaux

```bash
docker network create mon-reseau          # bridge par defaut
docker network create --internal cloisonne
docker run --network mon-reseau --name api mon-image
```

```yaml
networks:
  edge:
    driver: bridge
  internal:
    driver: bridge
    internal: true      # aucune route vers l'exterieur
```

**bridge** = le mode par defaut, un reseau virtuel prive. **Un reseau bridge que vous creez
vous-meme fournit un DNS interne** : les conteneurs se joignent **par leur nom de service**
(`http://api:3000`), sans jamais connaitre d'IP. Le bridge par defaut de Docker, lui,
n'offre pas ce DNS — d'ou l'interet de toujours declarer le sien.

**host** = le conteneur partage directement la pile reseau de l'hote. Pas d'isolation, pas
de `-p` (Linux uniquement).

**none** = aucun reseau du tout.

**`internal: true`** coupe la route sortante : les conteneurs du reseau se parlent entre
eux mais ne peuvent plus joindre Internet. C'est la bonne place pour une base de donnees.

Un conteneur peut appartenir a **plusieurs reseaux** — c'est ainsi qu'on fait une passerelle.

> **Ici** : `db` et `mailer` ne sont que sur `internal` ; `api` est sur `internal` **et**
> `edge` ; `front` seulement sur `edge`. Le front ne peut donc pas parler a Postgres
> directement, meme s'il essayait.

## Publier un port

```bash
-p 8080:3000              # 0.0.0.0:8080 -> visible depuis tout le reseau local
-p 127.0.0.1:8080:3000    # loopback seul -> visible depuis cette machine uniquement
```

La forme se lit **`hote:conteneur`**.

**Sans adresse, Docker ecoute sur `0.0.0.0`** : le service est joignable par n'importe qui
sur le meme Wi-Fi. Prefixer par `127.0.0.1` limite l'acces a la machine.

> **Ici** : tous les ports de dev sont lies a `127.0.0.1`. En prod, un seul port est
> publie, le 80 du front.

## Les variables d'environnement

```bash
docker run -e MAIL_PORT=1025 mon-image          # une par une
docker run --env-file api/.env mon-image        # depuis un fichier
```

```yaml
env_file: api/.env              # injecte dans le conteneur
environment:
  DATABASE_URL: postgres://...  # en clair dans le compose
```

**Le principe** : la meme image doit pouvoir tourner en dev, en recette et en prod. Ce qui
change d'un environnement a l'autre sort donc de l'image et passe par l'environnement.

**Un `.env` ne se versionne jamais.** On versionne un `.env.example` avec les memes cles et
des valeurs bidon, et on met `.env` dans le `.gitignore` **et** dans le `.dockerignore`.

## Le healthcheck

```dockerfile
HEALTHCHECK --interval=5s --retries=3 CMD curl -f http://localhost:3000/health || exit 1
```

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER}"]
  interval: 5s
  retries: 10
  start_period: 10s    # delai de grace au demarrage, les echecs n'y comptent pas
```

**Un healthcheck** = une commande que Docker rejoue periodiquement dans le conteneur. Son
code de sortie fait passer l'etat entre `starting`, `healthy` et `unhealthy`.

Sans lui, « le conteneur tourne » ne veut rien dire : un serveur peut etre demarre sans
etre encore capable de repondre.

⚠️ **La sonde ne doit avoir aucun effet de bord.** Elle s'execute toutes les 5 secondes,
indefiniment.

> **Ici** : l'API sonde `/uploads` et non `/`, parce que `GET /` **insere une ligne** en
> base — un healthcheck dessus ferait monter le compteur de visites tout seul.

## Les politiques de redemarrage

```bash
--restart no               # defaut : on ne redemarre rien
--restart on-failure:3     # seulement si code de sortie != 0, 3 tentatives
--restart unless-stopped   # toujours, sauf si arrete a la main
--restart always           # toujours, meme apres un arret manuel
```

**`unless-stopped`** est le choix courant en production : le service revient apres un
reboot de la machine, mais un arret volontaire est respecte.

**`always`** relance meme ce qu'on a explicitement arrete — rarement ce qu'on veut.

> **Ici** : `unless-stopped` en prod uniquement. En dev, un conteneur qui plante doit
> rester mort et visible.

---

# Orchestrer

## Docker Compose

```yaml
name: tp1

services:
  db:
    image: postgres:18.4-alpine
    env_file: db/.env
    networks: [internal]
    volumes: [pgdata:/var/lib/postgresql]

networks:
  internal: { driver: bridge }

volumes:
  pgdata: { name: tp1-pgdata }
```

```bash
docker compose up -d --build     # construire et demarrer en arriere-plan
docker compose ps                # etat des services
docker compose logs -f api       # suivre les logs d'un service
docker compose exec api sh       # ouvrir un shell dans un conteneur
docker compose down              # tout arreter (volumes conserves)
docker compose down -v           # + supprimer les volumes
```

**Compose** remplace une suite de `docker run` par un fichier declaratif : on decrit l'etat
voulu, Compose s'occupe de l'atteindre. Il cree le reseau, les volumes, respecte l'ordre.

**Le nom de projet** (`name:`) prefixe tout ce que Compose cree : le reseau devient
`tp1_internal`. D'ou l'importance de `name:` sur un volume qu'on veut nommer precisement —
sinon `tp1-pgdata` deviendrait `tp1_tp1-pgdata` et **la base existante serait perdue**.

## Plusieurs fichiers compose

```bash
docker compose up                                    # compose.yaml + compose.override.yaml
docker compose -f compose.yaml -f compose.prod.yaml up   # override IGNORE
```

**`compose.override.yaml` est charge automatiquement**, sans aucune option. C'est une
convention de Compose.

**Des qu'on passe `-f`, ce chargement automatique s'arrete** et seuls les fichiers cites
sont lus. Les fichiers fusionnent dans l'ordre : le suivant complete et ecrase le precedent.

L'interet est structurel : la commande de prod **ne peut pas** embarquer par accident un
bind mount ou un port de dev, puisque le fichier qui les porte n'est simplement pas lu.

## depends_on et les conditions

```yaml
api:
  depends_on:
    db:
      condition: service_healthy    # attend que le healthcheck passe au vert
    mailer:
      condition: service_started    # attend seulement le demarrage
```

**`depends_on` seul ne garantit que l'ordre de lancement**, pas que le service soit pret.
Postgres « demarre » bien avant d'accepter une connexion.

**`condition: service_healthy`** est ce qui rend l'attente reelle — et il exige donc un
`healthcheck` sur le service attendu.

⚠️ `depends_on` agit au `up`. Il ne protege pas de tout : si la base redemarre plus tard,
l'application doit savoir se reconnecter par elle-meme.

> **Ici** : cela remplace la boucle `until pg_isready; do sleep 1; done` du script shell.
> L'API garde malgre tout une logique de reconnexion pour les cas que `depends_on` ne
> couvre pas.

## Interpolation vs env_file

```
.env (a la racine)          ->  interpole LE FICHIER COMPOSE
                                n'entre dans AUCUN conteneur

db/.env, api/.env           ->  injectes DANS les conteneurs via env_file:
```

```yaml
services:
  front:
    ports: ["${FRONT_PORT:-5173}:5173"]   # <- vient du .env racine
    env_file: front/.env                   # <- entre dans le conteneur
```

**C'est la confusion la plus courante de Compose.** Ce sont deux mecanismes distincts.

Le `.env` de la racine sert a **ecrire le fichier compose** : numeros de ports, noms
d'images, tags. Compose le lit avant meme de parser le YAML.

`env_file:` sert a **configurer l'application** qui tourne dans le conteneur.

La syntaxe `${VAR:-defaut}` fournit une valeur de repli si la variable n'existe pas.

---

# Publier

## Les registries et GHCR

```bash
docker login ghcr.io -u USER --password-stdin
docker tag mon-image ghcr.io/user/mon-image:v1.0.0
docker push ghcr.io/user/mon-image:v1.0.0
docker pull ghcr.io/user/mon-image:v1.0.0
```

**Un registry** = un depot d'images. Docker Hub est le registry par defaut ; **GHCR**
(`ghcr.io`) est celui de GitHub, adosse au depot et a ses droits d'acces.

Le nom complet se lit **`registry/namespace/image:tag`**.

En GitHub Actions, l'authentification se fait avec le `GITHUB_TOKEN` fourni au workflow,
a condition de lui donner la permission `packages: write`. Aucun secret a creer.

⚠️ GHCR n'accepte que des **namespaces en minuscules**.

## Versionner les images

```yaml
image: ${REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-local}/tp1-api:${IMAGE_TAG:-dev}
```

```bash
git tag v1.0.0 && git push --tags     # declenche la publication
```

**Un tag d'image doit designer un contenu unique.** Deux environnements qui produisent des
images differentes ne doivent jamais partager un tag.

La convention courante : le tag de version (`v1.0.0`) ou le SHA du commit pour tracer
precisement, plus un `latest` mouvant pour le confort.

> **Ici** : `IMAGE_TAG` est **volontairement absent** du `.env`. Le defaut depend du fichier
> compose — `:dev` pour l'override, `:prod` pour la prod. Le definir dans `.env` ecrasait
> les deux, et un build de prod remplacait silencieusement l'image de dev.

---

# Le reste

## Les outils utilises

| Outil | Role |
|---|---|
| **Docker Compose v5** | orchestration declarative des 4 services |
| **BuildKit / buildx** | moteur de build : cache mounts, multi-stage parallele |
| **OrbStack** | alternative a Docker Desktop sur macOS. Donne a chaque conteneur un domaine HTTPS automatique (`front.tp1.orb.local`) |
| **Mailpit** | faux serveur SMTP : capture les mails au lieu de les envoyer, et les affiche dans une UI web. Indispensable pour tester sans spammer |
| **nginx-unprivileged** | nginx qui tourne en uid 101 et ecoute sur 8080 (un port < 1024 demanderait root) |
| **`pg_isready`** | utilitaire Postgres qui repond « la base accepte-t-elle des connexions ? ». Sert de healthcheck |
| **GitHub Actions + GHCR** | build, test et publication automatiques sur tag |

## Les pieges rencontres

Ce sont de vrais problemes rencontres en montant ce TP, pas des exemples theoriques.

**`npm ci` echouait la ou `npm install` passait.** `npm ci` exige un lockfile exactement
synchronise avec le `package.json` ; `npm install` repare silencieusement. Pire, npm 10 et
npm 11 ne resolvent pas le meme arbre de dependances. L'image `node:22` embarque npm 10, la
machine de dev npm 11 — d'ou un lockfile valide en local et rejete au build. Corrige en
passant a `node:24`, qui fournit npm 11.

**Le processus Node mourait quand Postgres disparaissait.** La librairie `pg` emet un
evenement `error` sur les connexions inactives ; **sans ecouteur, Node tue le processus**.
Une ligne `pool.on('error', ...)` suffit a transformer un crash en reconnexion.

**L'upload echouait en prod avec `EACCES`.** Le volume existait deja, ecrit par un conteneur
root. Docker ne recopie les droits de l'image que dans un volume **vide**, donc le conteneur
non-root ne pouvait plus y ecrire. Corrige en alignant dev et prod sur le meme uid.

**Vite renvoyait `403 Blocked request`.** Depuis Vite 6, le serveur de dev refuse tout
en-tete `Host` absent de `server.allowedHosts` — une protection contre le DNS rebinding.
`server.host: true` fait ecouter sur toutes les interfaces mais n'autorise aucun nom.

**Une page HTTPS ne peut pas appeler `http://localhost`.** Chrome exige l'en-tete
`Access-Control-Allow-Private-Network` pour qu'une origine publique atteigne une ressource
loopback (*Private Network Access*). La parade propre n'est pas de bricoler CORS : c'est de
faire proxifier `/api` par le serveur qui sert deja la page, donc de tout passer en
same-origin.

**Postgres 18 a deplace `PGDATA`** vers `/var/lib/postgresql/18/docker`. C'est le dossier
**parent** qui est declare comme volume dans l'image — monter l'ancien chemin ne persiste
rien.

## L'architecture de ce projet

```
                  navigateur
                       │
           dev :5173   │   prod :80
                       ▼
                 ┌───────────┐
                 │   front   │  dev : Vite (proxy /api)
                 │           │  prod: nginx (proxy /api)
                 └─────┬─────┘
                       │ reseau edge
                       ▼
                 ┌───────────┐
                 │    api    │  NestJS
                 └─────┬─────┘
                       │ reseau internal (internal: true en prod)
              ┌────────┴────────┐
              ▼                 ▼
        ┌──────────┐      ┌──────────┐
        │    db    │      │  mailer  │
        │ Postgres │      │ Mailpit  │
        └──────────┘      └──────────┘
         tp1-pgdata
```

Le front appelle **`/api` en same-origin dans les deux environnements** ; seul le composant
qui proxifie change (Vite en dev, nginx en prod). Consequence : `App.tsx` est identique
partout, l'image du front n'est liee a aucune URL d'API, et il n'y a ni CORS ni contenu
mixte a gerer.

| Fichier | Charge quand | Contient |
|---|---|---|
| `compose.yaml` | toujours | les 4 services, reseaux, volumes, healthchecks, noms d'images |
| `compose.override.yaml` | **automatiquement**, en dev | bind mounts `src/`, ports publies, `target: dev` |
| `compose.prod.yaml` | via `-f`, explicitement | `target: prod`, nginx sur le 80, `restart`, reseau cloisonne |

### Ce qu'on peut demontrer

- `GET /` : le message vient de l'API, le compteur de visites et l'heure viennent de Postgres.
- **Envoyer un mail** → `POST /mail` → le mail apparait dans Mailpit (http://localhost:8025).
- **Fichier** → `POST /upload` → ecrit dans le volume `tp1-uploads`, relu par `GET /uploads`.
- `docker compose rm -sf db && docker compose up -d` → le compteur ne repart pas a zero.
- Editer `api/src/app.service.ts` ou `front/src/App.tsx` → pris en compte sans rebuild (~2 s).

### Hot reload

Vite tourne avec `watch.usePolling: true` : les evenements inotify passent mal a travers un
bind mount macOS → Linux. Meme raison pour les `watchOptions` du `tsconfig.json` cote API.

Cote API, `nest build --watch` recompile et `node --watch dist/main.js` relance.
`nest start --watch` a ete ecarte : dans un conteneur il relance l'application sans tuer
l'ancien processus, ce qui donne un `EADDRINUSE` sur le port 3000.

`api/docker-dev.sh` fait un `rm -rf dist` avant de lancer `node`, sinon au redemarrage
`node --watch` part sur l'ancien `dist/` et perd son observateur quand le build l'efface.

> `vite.config.ts` n'est pas dans le bind mount (seul `src/` l'est) : le modifier demande
> `docker compose up -d --build front`.

### Sous OrbStack

Chaque conteneur recoit un domaine HTTPS automatique : https://front.tp1.orb.local,
https://api.tp1.orb.local, https://mailer.tp1.orb.local. Ils fonctionnent en dev comme en
prod, sans configuration.

### Publication automatique

`.github/workflows/publish-images.yaml` se declenche sur tout tag `v*` :

```bash
git tag v1.0.0 && git push --tags
# -> ghcr.io/grintzdel/tp1-{api,front,db,mailer}:v1.0.0  (+ :latest)
```

L'ordre est **build → smoke test → push** : le workflow demarre la stack prod et verifie que
nginx sert la page, que `/api` atteint Postgres, que l'upload fonctionne en non-root et
qu'aucun service hormis le front ne publie de port. Une image qui echoue n'est jamais poussee.

Les `env_file` etant gitignores, le workflow les regenere depuis les `.env.example` : sans
eux, `docker compose config` echoue sur un clone frais.

## Ce qui reste a faire

| Sujet | Etat |
|---|---|
| Images multi-architectures | **non fait** — construites pour l'arch du runner (`linux/amd64`). Sur un Mac Apple Silicon, un `docker compose pull` les fera tourner en emulation. Passer en multi-arch demande de separer le build du smoke test : une image multi-plateforme ne peut pas etre chargee dans le daemon local |
| Cache de build en CI | **non fait** — chaque run reinstalle les dependances. Un `cache_from`/`cache_to` de type `gha` ou `registry` reglerait ca |
| Secrets de production | **non fait** — les mots de passe passent par des `.env`. Une vraie prod utiliserait les secrets Docker ou ceux de l'orchestrateur |
| Mailpit en production | **volontaire** — garde pour que le TP reste demontrable. `MAIL_HOST` et `MAIL_PORT` viennent de l'environnement : un vrai SMTP se substitue sans toucher au compose |
| Scan de vulnerabilites | **non fait** — un `docker scout` ou `trivy` dans le workflow bloquerait une image vulnerable avant publication |
