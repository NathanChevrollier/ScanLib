# Installation et mise en production

Guide complet pour faire tourner ScanLib, en local puis sur un VPS.
Pour comprendre ce que fait l'application, voir [README.md](README.md).

- [1. Prérequis](#1-prérequis)
- [2. Installation en local](#2-installation-en-local)
- [3. Clé TMDB](#3-clé-tmdb)
- [4. Variables de configuration](#4-variables-de-configuration)
- [5. Mise en production sur un VPS](#5-mise-en-production-sur-un-vps)
- [6. Comptes et invitations](#6-comptes-et-invitations)
- [7. Mettre à jour](#7-mettre-à-jour)
- [8. Sauvegardes et restauration](#8-sauvegardes-et-restauration)
- [9. Exploitation au quotidien](#9-exploitation-au-quotidien)
- [10. En cas de problème](#10-en-cas-de-problème)

---

## 1. Prérequis

| Environnement | Besoin |
|---|---|
| **Local** | Node.js ≥ 20, npm ≥ 10, et un PostgreSQL 16 (le plus simple : Docker) |
| **Production** | Un VPS avec Docker et le plugin Compose. Rien d'autre — ni Node, ni PostgreSQL, ni nginx sur la machine hôte |

Pour la production, prévoir aussi un **nom de domaine** pointant sur le VPS
(enregistrement `A` vers son IPv4) et les **ports 80 et 443 ouverts** : Caddy en
a besoin pour obtenir le certificat HTTPS. Tout cela est détaillé en
[section 5](#5-mise-en-production-sur-un-vps).

Une seule clé d'API est utile, celle de TMDB, et elle est **facultative** :
toutes les autres sources de données sont ouvertes.

---

## 2. Installation en local

```bash
git clone <votre-dépôt> scanlib
cd scanlib
npm install
```

### 2.1 Configuration

```bash
cp .env.example .env
```

Deux valeurs suffisent pour démarrer :

```bash
# Un secret long et aléatoire
openssl rand -base64 48
```

Dans `.env` :

```ini
JWT_SECRET=<le résultat de la commande ci-dessus>
DATABASE_URL=postgresql://scanlib:scanlib@localhost:5432/scanlib
```

### 2.2 Base de données

```bash
docker run -d --name scanlib-pg -p 5432:5432 \
  -e POSTGRES_USER=scanlib -e POSTGRES_PASSWORD=scanlib -e POSTGRES_DB=scanlib \
  postgres:16-alpine
```

> Si le port 5432 est déjà pris par un autre PostgreSQL, publiez-le ailleurs
> (`-p 5433:5432`) et alignez `DATABASE_URL` sur ce port.

Puis appliquez le schéma :

```bash
npm run db:migrate
```

### 2.3 Premier compte

L'inscription publique est fermée : le premier compte se crée en ligne de
commande, et il est automatiquement administrateur.

```bash
npm run user:create -- --email vous@exemple.fr --name Vous --admin
```

Le mot de passe est demandé de façon interactive (10 caractères minimum) pour ne
pas rester dans l'historique du shell. Il peut aussi être passé avec
`--password '…'` dans un script.

### 2.4 Démarrer

```bash
npm run dev
```

- Front : <http://localhost:5173>
- API : <http://localhost:3001>

Le front relaie `/api` vers l'API : les deux partagent la même origine, comme en
production, ce qui évite toute question de cookies inter-domaines.

### 2.5 Tester le mode hors ligne et l'installation PWA

Le service worker n'existe **que** dans le build de production :

```bash
npm run build
npm run preview --workspace=@scanlib/web   # http://localhost:4173
```

L'API doit tourner en parallèle (`npm run dev:api`), la prévisualisation relaie
`/api` de la même manière.

---

## 3. Clé TMDB

**C'est la seule clé d'API du projet, et elle est facultative.** Toutes les
autres sources — MangaDex, Jikan, AniList, Kitsu, TVmaze — sont ouvertes et ne
demandent aucune inscription.

Sans clé TMDB :

- **les films sont indisponibles** (aucune autre source ne les couvre) ;
- **les séries TV restent disponibles** via TVmaze ;
- **la disponibilité par pays** (JustWatch : « sur quelle plateforme dans quel
  pays ») disparaît ;
- scans et animés fonctionnent normalement.

La source apparaît alors comme `disabled` dans **Réglages → État des sources**.

1. Créer un compte sur <https://www.themoviedb.org>
2. Aller dans **Paramètres → API**, demander une clé **v3** (gratuite, immédiate,
   usage personnel accepté)
3. Renseigner `TMDB_API_KEY=` dans le `.env`, puis redémarrer l'API

La clé reste côté serveur : elle n'est jamais envoyée au navigateur.

---

## 4. Variables de configuration

Toutes dans `.env` à la racine. En production, Docker Compose les transmet aux
conteneurs.

### Indispensables

| Variable | Rôle |
|---|---|
| `POSTGRES_PASSWORD` | Mot de passe de la base. **À changer.** |
| `JWT_SECRET` | Signature des jetons de session. Au moins 24 caractères, aléatoire. Le changer déconnecte tout le monde. |
| `DATABASE_URL` | Connexion à la base. En Compose, l'hôte est `postgres`, pas `localhost`. |

### Production

| Variable | Valeur type | Rôle |
|---|---|---|
| `DOMAIN` | `scanlib.mondomaine.fr` | Domaine servi par Caddy. `:80` en local, sans HTTPS. |
| `PUBLIC_URL` | `https://scanlib.mondomaine.fr` | Origine autorisée pour le navigateur. |
| `COOKIE_SECURE` | `true` | Obligatoire dès que le site est en HTTPS. |
| `COOKIE_DOMAIN` | `scanlib.mondomaine.fr` | Facultatif ; à laisser vide en local. |
| `NODE_ENV` | `production` | Réduit la verbosité des journaux. |

### Comportement

| Variable | Défaut | Rôle |
|---|---|---|
| `TMDB_API_KEY` | vide | Active films et séries. |
| `DEFAULT_LANGUAGES` | `fr,en` | Langues par défaut des nouveaux comptes. |
| `DEFAULT_WATCH_REGIONS` | `FR,US` | Pays interrogés pour la disponibilité. |
| `ENABLE_ANILIST` | `true` | Liens de streaming typés et grille de diffusion. Son API est parfois coupée par ses mainteneurs : le coupe-circuit l'écarte alors seul. Passer à `false` pour ne plus l'interroger du tout. |
| `ENABLE_JOBS` | `true` | Tâches planifiées. À laisser à `true` sur **une seule** instance. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | vides | Notifications poussées. Sans elles, les notifications restent internes à l''application. |
| `VAPID_SUBJECT` | `mailto:admin@localhost` | Adresse de contact transmise au service d''envoi. |
| `TIMEZONE` | `Europe/Paris` | Regroupement par jour des statistiques et heure des tâches. |
| `ALLOW_OPEN_REGISTRATION` | `false` | `true` ouvrirait l'inscription à tous — déconseillé. |
| `ACCESS_TOKEN_TTL` | `15m` | Durée du jeton d'accès. |
| `REFRESH_TOKEN_TTL` | `30d` | Durée de la session avant reconnexion. |
| `PROVIDER_USER_AGENT` | `ScanLib/0.1 …` | Identifie l'instance auprès des API publiques (exigé par MangaDex). |

---

## 5. Mise en production sur un VPS

Comptez une trentaine de minutes la première fois. Les étapes 5.1 à 5.3
préparent le terrain ; le déploiement lui-même (5.5) tient en une commande.

### 5.0 Préparer le serveur

Sur un VPS Debian 12 ou Ubuntu 22.04/24.04 fraîchement installé, en `root` :

```bash
apt update && apt upgrade -y

# Docker + plugin Compose, depuis le dépôt officiel
curl -fsSL https://get.docker.com | sh

# Un utilisateur non privilégié pour héberger l'application
adduser --disabled-password --gecos "" scanlib
usermod -aG docker scanlib
```

Vérifier que Docker répond :

```bash
docker --version
docker compose version   # doit afficher v2.x
```

**Pare-feu** — seuls SSH, HTTP et HTTPS doivent être ouverts. Caddy a besoin du
port 80 pour la validation du certificat, il ne suffit pas d'ouvrir 443 :

```bash
apt install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

> Si votre hébergeur a son propre pare-feu (OVH, Hetzner, Scaleway, groupes de
> sécurité AWS), ouvrez-y **aussi** 80 et 443 — un pare-feu bloquant en amont
> est la cause la plus fréquente d'un certificat qui n'arrive jamais.

### 5.1 Pointer le nom de domaine

Chez votre registrar ou votre hébergeur DNS, créer un enregistrement :

| Type | Nom | Valeur |
|---|---|---|
| `A` | `scanlib` (ou `@` pour le domaine nu) | l'IPv4 du VPS |
| `AAAA` *(si IPv6)* | idem | l'IPv6 du VPS |

Attendre la propagation et **vérifier avant de déployer** — sinon Let's Encrypt
refusera le certificat et imposera une attente avant un nouvel essai :

```bash
dig +short scanlib.mondomaine.fr    # doit renvoyer l'IP du VPS
```

### 5.2 Dimensionnement

| Ressource | Minimum | Confortable |
|---|---|---|
| RAM | 2 Go | 4 Go |
| Disque | 10 Go | 20 Go |
| vCPU | 1 | 2 |

La construction des images est le moment le plus gourmand. À 1 Go de RAM, le
build du front peut être tué par le noyau (`exit code 137`) : dans ce cas,
ajouter temporairement un fichier d'échange.

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
```

### 5.3 Ce que Compose démarre

| Service | Rôle |
|---|---|
| `postgres` | Base de données, données dans `infra/data/postgres` |
| `api` | API Node : applique les migrations au démarrage puis sert `/api` |
| `web` | Conteneur éphémère : construit le front et le dépose dans un volume |
| `caddy` | Frontal HTTPS : sert le front et relaie `/api` vers l'API |

Seul Caddy expose des ports (80 et 443). L'API et la base ne sont **pas**
accessibles depuis l'extérieur : inutile de les ouvrir dans le pare-feu.

Les migrations de base sont jouées par le conteneur `api` **à chaque
démarrage** (`node dist/db/migrate.js && node dist/index.js`). Il n'y a donc
jamais de commande de migration à lancer à la main en production.

### 5.4 Récupérer le code et configurer

Se connecter en tant qu'utilisateur `scanlib` (pas `root`) :

```bash
su - scanlib
git clone <votre-dépôt> scanlib
cd scanlib
cp .env.example .env
```

Générer les deux secrets :

```bash
openssl rand -base64 48                  # pour JWT_SECRET
openssl rand -base64 24 | tr -d '+/='    # pour POSTGRES_PASSWORD
```

> Le `tr` n'est pas cosmétique : un mot de passe contenant `+`, `/` ou `=` doit
> être pourcent-codé dans `DATABASE_URL`, ce qui est une source d'erreur inutile.

Éditer `.env` :

```ini
# --- Base ---
POSTGRES_USER=scanlib
POSTGRES_DB=scanlib
POSTGRES_PASSWORD=<le second secret>
DATABASE_URL=postgresql://scanlib:<le second secret>@postgres:5432/scanlib

# --- Sécurité ---
JWT_SECRET=<le premier secret>
COOKIE_SECURE=true
COOKIE_DOMAIN=scanlib.mondomaine.fr
ALLOW_OPEN_REGISTRATION=false

# --- Domaine ---
NODE_ENV=production
DOMAIN=scanlib.mondomaine.fr
PUBLIC_URL=https://scanlib.mondomaine.fr

# --- Sources (facultatif) ---
TMDB_API_KEY=<votre clé, ou vide>
```

Trois pièges, dans l'ordre de fréquence :

> ⚠️ Dans `DATABASE_URL`, l'hôte est **`postgres`** (le nom du service Compose),
> pas `localhost`. C'est l'erreur la plus fréquente.

> ⚠️ Le mot de passe doit être **identique** dans `POSTGRES_PASSWORD` et dans
> `DATABASE_URL`. S'il contient `@`, `:`, `/` ou `#`, encodez-le en
> pourcent-codage dans l'URL — ou choisissez un secret alphanumérique.

> ⚠️ `DOMAIN` se saisit **sans** `https://` (Caddy attend un nom d'hôte), alors
> que `PUBLIC_URL` s'écrit **avec** le schéma complet.

### 5.5 Déployer

```bash
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
```

Le premier démarrage construit les images (3 à 10 minutes selon le VPS),
applique les migrations, construit le front, puis Caddy demande le certificat à
Let's Encrypt.

### 5.6 Vérifier le déploiement

Dans l'ordre — chaque étape isole une couche différente :

```bash
# 1. Les conteneurs tournent ? `web` doit être "Exited (0)", c'est normal :
#    c'est un conteneur de build qui a fini son travail.
docker compose -f infra/docker-compose.yml ps

# 2. L'API a démarré et les migrations sont passées ?
docker compose -f infra/docker-compose.yml logs api | tail -20
#    → "migrations appliquées." puis l'écoute sur le port 3001

# 3. Le certificat a été obtenu ?
docker compose -f infra/docker-compose.yml logs caddy | grep -i "certificate"

# 4. La chaîne complète répond en HTTPS ?
curl https://scanlib.mondomaine.fr/api/health
#    → {"status":"ok","time":"…"}
```

Si le point 4 échoue mais que le point 2 est bon, le problème est entre Caddy et
l'extérieur : DNS, pare-feu ou certificat. Voir la section 10.

### 5.7 Créer le premier compte

L'inscription publique est fermée : le premier compte se crée en ligne de
commande, et devient automatiquement administrateur.

```bash
docker compose -f infra/docker-compose.yml exec api \
  node dist/scripts/create-user.js \
  --email vous@exemple.fr --name Vous --password 'un-mot-de-passe-solide' --admin
```

> Le mot de passe passé en `--password` reste dans l'historique du shell.
> Pensez à `history -c`, ou omettez l'option pour une saisie interactive.

L'application est prête sur `https://scanlib.mondomaine.fr`.

### 5.8 Après le premier démarrage

Trois gestes qui évitent des surprises plus tard :

1. **Programmer les sauvegardes** — section 8. Une base sans sauvegarde
   automatique est une base qu'on perdra.
2. **Vérifier les sources** — **Réglages → État des sources**. TMDB doit être
   `ok` si vous avez mis une clé, `disabled` sinon.
3. **Activer les notifications poussées** si vous les voulez — section 6.

### 5.9 Installer sur téléphone

Ouvrir le site dans le navigateur du téléphone, puis « Ajouter à l'écran
d'accueil ». L'application s'ouvre alors en plein écran et fonctionne hors
connexion. **HTTPS est obligatoire** pour que l'installation soit proposée.

---

## 6. Comptes et invitations

L'instance reste fermée : personne ne peut créer de compte sans y être invité.

**Inviter quelqu'un** — dans **Administration → Invitations en attente**
(l'onglet n'apparaît dans la barre latérale que pour un administrateur). Le code
généré est valable 14 jours et à usage unique ; la personne le saisit sur
l'écran de connexion via « J'ai un code d'invitation ».

**Ajouter un compte en ligne de commande** :

```bash
docker compose -f infra/docker-compose.yml exec api \
  node dist/scripts/create-user.js --email ami@exemple.fr --name Ami
```

(sans `--admin`, le compte est un utilisateur standard)

Chaque compte a sa propre bibliothèque, sa progression et ses préférences.

### Écran Administration

Réservé aux administrateurs, accessible par l'onglet **Administration** de la
barre latérale — mis en évidence, et absent pour les comptes standards. Il
donne :

- la **liste des comptes** avec dernière connexion et taille de bibliothèque ;
- la **suspension** d'un compte (les identifiants restent valides, la connexion
  est refusée) — on ne peut ni se suspendre ni se retirer ses propres droits ;
- les **invitations en cours**, avec copie et annulation ;
- un **code de secours** à usage unique pour un compte ayant perdu son mot de
  passe : il se saisit sur l'écran de connexion via « Mot de passe oublié » ;
- l'**état des tâches de fond** et leur relance manuelle.

### Mot de passe oublié

Aucun serveur d'e-mails n'est nécessaire : un administrateur génère un code
depuis l'écran Administration et le transmet comme il veut. Le code est valable
24 heures, ne sert qu'une fois, et sa saisie ferme toutes les sessions existantes
du compte concerné.

Si **plus aucun administrateur** ne peut se connecter, le recours reste la ligne
de commande sur le serveur : créer un nouveau compte administrateur avec
`create-user.js`, puis générer un code depuis l'interface.

### Notifications poussées

Pour être prévenu d'un nouveau chapitre sans ouvrir l'application :

```bash
npx web-push generate-vapid-keys
```

Reporter les deux clés dans le `.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`),
redémarrer l'API, puis activer les notifications depuis **Profil →
Notifications** sur chaque appareil. HTTPS est obligatoire, et sur iPhone
l'application doit être installée sur l'écran d'accueil.

---

## 7. Mettre à jour

### En production

```bash
cd scanlib
./infra/backup.sh          # d'abord la sauvegarde, toujours
git pull
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
docker compose -f infra/docker-compose.yml logs api | tail -20
```

Les migrations s'appliquent automatiquement au démarrage du conteneur `api` :
la ligne `migrations appliquées.` dans les journaux confirme que la nouvelle
version du schéma est en place.

Une mise à jour qui ajoute des variables au `.env.example` ne les ajoute pas à
votre `.env`. Après un `git pull`, comparer les deux :

```bash
diff <(grep -o '^[A-Z_]*' .env.example | sort) <(grep -o '^[A-Z_]*' .env | sort)
```

Les variables absentes prennent leur valeur par défaut : rien ne casse, mais une
nouvelle fonctionnalité peut rester inactive.

### En local

Le conteneur n'existe pas, les migrations sont donc à lancer soi-même :

```bash
git pull
npm install         # si les dépendances ont changé
npm run db:migrate  # applique les nouvelles migrations
npm run dev
```

> Oublier `db:migrate` en local produit des erreurs du type
> `relation "…" does not exist` au premier appel de la fonctionnalité concernée.

### Revenir en arrière

```bash
git log --oneline -5
git checkout <le commit précédent>
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
```

Attention : les migrations de base ne sont **pas** réversibles automatiquement.
Si la version abandonnée en avait appliqué une, restaurez le dump pris avant la
mise à jour (section 8).

---

## 8. Sauvegardes et restauration

### Sauvegarder

```bash
./infra/backup.sh
```

Produit `infra/backups/scanlib-AAAA-MM-JJ.sql.gz` et supprime les dumps de plus
de 30 jours (`KEEP_DAYS` pour changer ce seuil).

**À automatiser** — `crontab -e` :

```cron
0 4 * * * /home/vous/scanlib/infra/backup.sh >> /home/vous/scanlib/infra/backups/cron.log 2>&1
```

Ces dumps vivent sur le même serveur que la base : copiez-les ailleurs
(`rsync`, `rclone`, espace de sauvegarde OVH) — sinon ils disparaîtront avec lui.

### Restaurer

```bash
gunzip -c infra/backups/scanlib-2026-09-07.sql.gz \
  | docker compose -f infra/docker-compose.yml exec -T postgres \
    psql -U scanlib -d scanlib
```

Le dump est généré avec `--clean --if-exists` : il se rejoue sur une base
existante sans conflit.

---

## 9. Exploitation au quotidien

### Journaux

```bash
docker compose -f infra/docker-compose.yml logs -f api
docker compose -f infra/docker-compose.yml logs -f caddy
```

L'API écrit du JSON sur la sortie standard (niveau, horodatage, message).

### Lancer une tâche à la main

Sans attendre sa planification :

```bash
docker compose -f infra/docker-compose.yml exec api \
  node dist/scripts/run-job.js detect-new-units
```

Tâches disponibles : `detect-new-units`, `airing-calendar`, `refresh-metadata`,
`refresh-links`, `verify-platforms`, `maintenance`.

Plus simple : l'écran **Administration** les liste avec leur dernière exécution,
leur durée et leur éventuelle erreur, et permet de les relancer d'un clic.

### Vérifier l'état des sources

Dans **Réglages → État des sources** : chaque source y est marquée `ok`,
`degraded`, `down` (panne côté fournisseur) ou `disabled` (désactivée par
configuration, par exemple TMDB sans clé).

L'endpoint correspondant (`/api/health/providers`) demande une session ; pour
vérifier seulement que le serveur répond, utiliser la sonde publique :

```bash
curl -s https://scanlib.mondomaine.fr/api/health
# {"status":"ok","time":"…"}
```

### Exporter sa bibliothèque

**Réglages → Données → Exporter ma bibliothèque** télécharge un JSON contenant
les œuvres, statuts, notes et identifiants externes.

---

## 10. En cas de problème

| Symptôme | Cause probable | Solution |
|---|---|---|
| `Configuration invalide : JWT_SECRET…` au démarrage | `.env` absent ou incomplet | Vérifier `.env` à la racine et les variables listées en section 4 |
| L'API redémarre en boucle | `DATABASE_URL` pointe sur `localhost` au lieu de `postgres` | Corriger l'hôte, puis `up -d` |
| Page blanche, `/api` en 502 | L'API n'a pas démarré | `logs -f api` |
| Impossible de se connecter, cookie non conservé | `COOKIE_SECURE=true` sans HTTPS, ou `PUBLIC_URL` erroné | Aligner `PUBLIC_URL`, `DOMAIN` et `COOKIE_SECURE` |
| Certificat HTTPS non délivré | DNS non propagé ou ports 80/443 fermés | Vérifier l'enregistrement `A` et le pare-feu, puis `logs -f caddy` |
| Recherche partielle, bannière « source indisponible » | Panne d'une API publique | Rien à faire : les autres sources prennent le relais |
| AniList en `down`, message « API temporarily disabled » | Coupure décidée par AniList, sans rapport avec votre instance | Rien à faire ; `ENABLE_ANILIST=false` pour cesser de l'interroger |
| Films introuvables | Pas de clé TMDB | Section 3 — les séries TV, elles, passent par TVmaze |
| `relation "…" does not exist` | Migration non appliquée | `npm run db:migrate` en local ; en production, relancer le conteneur `api` |
| Build tué pendant `up --build` (`exit code 137`) | Mémoire insuffisante | Ajouter un fichier d'échange, section 5.2 |
| Un animé n'a aucun épisode listé | Jikan en panne et pas de clé TMDB | Attendre le retour de la source ou configurer TMDB ; `detect-new-units` complétera |
| Aucune nouveauté détectée | `ENABLE_JOBS=false` | Repasser à `true` et redémarrer l'API |
| L'application ne s'installe pas sur téléphone | Site non servi en HTTPS | L'installation PWA exige un certificat valide |

### Repartir de zéro (⚠️ efface toutes les données)

```bash
docker compose -f infra/docker-compose.yml down
sudo rm -rf infra/data/postgres
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
```
