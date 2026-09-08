# ScanLib

**Une seule bibliothèque pour vos scans, animés, séries et films** — et surtout,
les liens de lecture et de visionnage **officiels**, trouvés automatiquement, en
français comme en anglais.

Application web auto-hébergée, utilisable au clavier sur ordinateur comme au
doigt sur téléphone (installable en PWA).

> **Installation et mise en production : [INSTALLATION.md](INSTALLATION.md)**

---

## Le problème que ça résout

Suivre une série, aujourd'hui, c'est jongler : une liste sur MyAnimeList, une
autre pour les mangas, un carnet mental de « j'en étais au chapitre 1050 », et à
chaque fois la même question — *ça se lit où, légalement, en français ?*

ScanLib réunit les trois : **un catalogue**, **une progression**, **des liens
officiels**.

## Ce que fait l'application

**Rechercher.** Une seule barre de recherche interroge en parallèle MangaDex,
MyAnimeList, AniList, Kitsu, TMDB et TVmaze. Les résultats sont fusionnés : une
œuvre décrite par trois sources n'apparaît qu'une fois, avec son titre français
s'il existe. La réponse fusionnée est mise en cache dix minutes, ce qui rend
instantanés la pagination et le retour sur un terme déjà tapé.

**Classer.** Six statuts — à commencer, en cours, en pause, abandonné, terminé,
relecture — plus notes, favoris, étiquettes et priorité. Filtres par type, genre,
statut, et sept tris dont un tri *« prêt à enchaîner »* qui classe par nombre
d'épisodes disponibles non vus.

**Suivre.** Une case à cocher par chapitre ou par épisode, un bouton
« marquer jusqu'ici » pour rattraper une série commencée ailleurs, et un bouton
« continuer » qui ouvre directement la prochaine unité sur la plateforme
officielle. Le statut suit tout seul : cocher le premier épisode démarre la
série, cocher le dernier la termine.

**Trouver où lire ou regarder.** Le cœur du projet — détaillé plus bas.

**Ne rien rater.** Un calendrier des sorties, un badge sur les séries dont un
nouveau chapitre est paru, et des notifications alimentées par une tâche de fond
qui vérifie toutes les six heures.

**Régler soi-même le rythme d'une série.** Les API annoncent au mieux *la
prochaine* sortie, et rien du tout pour les scans. Chaque œuvre peut donc
recevoir son propre rythme — quotidien, hebdomadaire, mensuel ou ponctuel, avec
jour et heure — saisi depuis le calendrier ou depuis la fiche. Un bouton
*« pré-remplir depuis les sources »* interroge les API rattachées et propose la
cadence : soit la grille de diffusion annoncée, soit la médiane des dernières
sorties publiées. Un rythme saisi à la main remplace la date annoncée par les
sources, puisqu'il ne se saisit que lorsqu'elle est fausse ou absente.

**Voir où on en est.** Heatmap d'activité sur un an, temps de lecture et de
visionnage estimé, répartition par genre et par note, séries en sommeil,
suggestions basées sur vos mieux notées.

**Fonctionner sans réseau.** L'application installée s'ouvre sur votre
bibliothèque même hors connexion, et les chapitres cochés dans le métro sont
synchronisés au retour du réseau.

---

## Comment les liens officiels sont trouvés

Aucune API ne fournit à elle seule des liens de lecture directs. ScanLib
combine trois sources, par fiabilité décroissante :

**1. Les liens directs publiés par les bases de données.** Jikan expose les
plateformes de streaming d'un animé avec leur URL exacte (Crunchyroll, ADN,
Netflix). MangaDex publie les liens d'édition de chaque manga : `engtl` pour la
licence anglaise, `raw` pour l'édition d'origine, `bw` / `amz` / `ebj` / `cdj`
pour l'achat légal — et surtout, les chapitres hébergés chez l'éditeur
(MANGA Plus, Azuki, Bilibili Comics) portent une URL de lecture gratuite.

**2. La disponibilité par pays de TMDB / JustWatch.** Elle indique quelles
plateformes proposent un film ou une série dans un pays donné — mais pas
d'adresse vers l'œuvre elle-même.

**3. Un registre de plateformes vérifiées.** Il fabrique une URL de recherche sur
le catalogue — WEBTOON, Tapas, Delitoon, izneo, VIZ, Crunchyroll, Cultura et une
quinzaine d'autres. **Une plateforme n'y figure que si sa recherche a été
testée** : `npm run links:verify` interroge chacune et échoue si l'une d'elles
ne répond plus. Les services entièrement en JavaScript derrière un pare-feu
applicatif (ADN, Mangas.io, Disney+, Glénat) n'exposent aucune adresse fiable :
ils restent reconnus quand une API y renvoie, mais ne sont jamais suggérés à
l'aveugle. Mieux vaut trois liens sûrs que dix dont la moitié tombe à côté.

**4. Vos propres sources.** Depuis les Réglages, chacun déclare les sites qu'il
utilise avec leur adresse de recherche — ils passent devant tout le reste. Et sur
chaque fiche, deux liens principaux (un français, un anglais) peuvent être
saisis : ce sont eux qu'ouvre le bouton « Lire » ou « Regarder ».

Chaque lien affiche **sa langue, son pays, son mode d'accès** (gratuit,
abonnement, achat) et **sa nature** : `exact` s'il mène à l'œuvre, `recherche`
s'il ouvre le moteur de la plateforme. Le tri place en tête vos propres sources,
puis ce qui est officiel, dans votre langue, sur une plateforme que vous possédez.

Le registre vit dans un seul fichier,
[`packages/providers/src/links/platforms.ts`](packages/providers/src/links/platforms.ts) :
quand une plateforme change son format d'URL, c'est le seul endroit à modifier —
et la tâche hebdomadaire `verify-platforms` prévient dès que c'est nécessaire.

### Uniquement des sources légales

ScanLib n'héberge, ne proxifie et ne diffuse aucun contenu. L'application ne
fait que renvoyer vers des plateformes officielles ou des pages de recherche de
services licenciés. Aucun agrégateur pirate n'est indexé.

---

## Les sources de données

| Source | Rôle | Clé requise |
|---|---|---|
| **MangaDex** | Scans : catalogue, chapitres par langue, liens d'édition | non |
| **Jikan** (MyAnimeList) | Animés et mangas : métadonnées, épisodes, liens de streaming, recommandations | non |
| **AniList** | Liens de streaming typés par langue, et grille de diffusion à la minute | non |
| **Kitsu** | Renfort et titres localisés (français) | non |
| **TVmaze** | Séries TV : catalogue et diffusion épisode par épisode | non |
| **TMDB** | Films et séries + disponibilité par pays via JustWatch | **oui**, gratuite |

**Aucune source n'est indispensable.** Chacune peut tomber sans bloquer
l'application : la recherche affiche alors une bannière discrète et les autres
sources prennent le relais. Ce n'est pas théorique — l'API AniList est
périodiquement coupée par ses mainteneurs, et Jikan répond régulièrement en
erreur. Un coupe-circuit écarte automatiquement une source qui échoue à
répétition, et chaque source dispose de 2,5 secondes pour répondre : une seule
API lente ne fait jamais attendre l'écran. L'état de chacune est visible dans
**Réglages → État des sources**.

Toutes les requêtes externes passent par le serveur, jamais par le navigateur :
les limites de débit (Jikan 3 req/s, MangaDex 5 req/s) sont ainsi mutualisées
pour toute l'instance, la clé TMDB reste privée, et les réponses sont mises en
cache en base.

---

## Architecture

```
packages/shared/      Schémas Zod et types partagés — le contrat unique API ↔ front
packages/providers/   Connecteurs externes, limitation de débit, résolveur de liens
apps/api/             Hono + Drizzle + PostgreSQL + pg-boss (tâches planifiées)
apps/web/             React 19 + Vite + Tailwind v4 + PWA
infra/                docker compose, Caddy, script de sauvegarde
```

Monorepo npm workspaces, TypeScript strict de bout en bout. Le front et l'API
partagent leurs types : un champ renommé côté serveur casse la compilation du
navigateur, pas la production.

**Navigation.** La barre latérale sépare *Ma collection* (Bibliothèque, À voir,
Calendrier, Statistiques) de *Mon compte* (Profil, Réglages), plus l'onglet
Administration pour les seuls administrateurs. Sur téléphone, ces entrées
deviennent une barre inférieure de cinq cibles.

**Modèle de données.** Une œuvre (`works`) porte autant d'identifiants externes
(`external_ids`) que de sources la décrivant. Chapitres et épisodes vivent dans
une même table `units`, la progression dans `unit_progress`, et les rythmes de
sortie saisis à la main dans `release_schedules` — dont les occurrences sont
déroulées à la lecture plutôt que matérialisées, pour qu'une correction se
propage d'un coup à tout le calendrier. Le rapprochement
entre sources se fait d'abord par identifiants croisés — MangaDex publie les IDs
MyAnimeList, AniList et Kitsu de chaque série — puis, à défaut, par similarité de
titre normalisé et d'année.

**Tâches de fond** (pg-boss, sur PostgreSQL, sans Redis) :

| Tâche | Fréquence | Rôle |
|---|---|---|
| `detect-new-units` | 6 h | Nouveaux chapitres / épisodes → badge, notification et envoi poussé |
| `airing-calendar` | 12 h | Prochaines diffusions |
| `refresh-metadata` | nuit | Métadonnées des œuvres suivies |
| `refresh-links` | hebdo | Recalcul et revalidation des liens |
| `verify-platforms` | hebdo | Contrôle que les liens de plateformes répondent encore |
| `maintenance` | nuit | Cache expiré, sessions mortes, compteurs, historique |

Le rythme dépend du statut de publication : une série en cours est réinterrogée
toutes les six heures, une série terminée une fois par mois, une série
abandonnée jamais. Les chapitres sont récupérés en incrémental — seules les
parutions postérieures à la dernière connue sont demandées, ce qui fait passer
une longue série de quinze requêtes à une.

Chaque exécution laisse une trace en base — issue, durée, erreur éventuelle —
consultable depuis l'écran d'administration.

---

## Fonctionnement hors connexion

Trois mécanismes distincts, souvent confondus :

1. **Service worker** — sert la coquille de l'application et les jaquettes déjà
   vues (build de production uniquement).
2. **Cache local en IndexedDB** — bibliothèque, fiches, chapitres et liens
   restent consultables sans réseau, et s'affichent instantanément même en ligne
   pendant que le serveur répond.
3. **File de synchronisation** — un chapitre coché sans réseau est écrit sur
   disque, puis rejoué à la reconnexion.

Deux pièges ont été traités explicitement : TanStack Query met par défaut les
mutations *en pause* hors ligne, ce qui perd l'action à la fermeture de l'onglet
(d'où `networkMode: 'always'` sur la progression) ; et `navigator.onLine` reste à
vrai après un démarrage sans réseau, c'est donc l'échec réel de la requête qui
déclenche la mise en file.

---

## Sécurité et comptes

L'instance est **fermée par défaut** : le premier compte se crée en ligne de
commande sur le serveur, les suivants avec un code d'invitation. Mots de passe
hachés en argon2id, jeton d'accès court (15 min) et jeton de rafraîchissement
rotatif, tous deux en cookies `httpOnly` — rien d'exploitable n'est lisible en
JavaScript.

Les tentatives de connexion sont comptées par adresse IP **et** par compte visé :
cinq essais gratuits, puis un blocage croissant d'une minute à une heure. Le
compteur vit en base et survit aux redémarrages.

Depuis l'onglet **Profil**, chacun peut changer son mot de passe (ce qui ferme
ses autres sessions), modifier son identité, voir et révoquer ses appareils
connectés, activer les notifications et supprimer son compte. Un administrateur
dispose en plus d'un onglet **Administration**, mis en avant dans la barre
latérale et invisible pour les autres : liste des comptes, suspension,
invitations en cours, codes de secours pour un mot de passe oublié, et état des
tâches de fond.

---

## État du projet

Fonctionnel et vérifié de bout en bout : recherche, ajout, progression, liens
officiels, calendrier, statistiques, notifications, hors-ligne, thèmes clair et
sombre, du 360 px au grand écran.

Deux réserves honnêtes :

- **Les films** dépendent d'une clé TMDB : sans elle, la source se déclare
  `disabled` et les films restent introuvables. Les séries TV, elles, sont
  couvertes par TVmaze, qui ne demande aucune clé.
- **Les listes d'épisodes d'animés** proviennent de Jikan ou de TMDB. Quand Jikan
  est en panne et qu'aucune clé TMDB n'est configurée, un animé ajouté n'a pas
  encore d'épisodes indexés ; la tâche `detect-new-units` les récupère dès le
  retour de la source.

---

## Commandes

```bash
npm run dev          # API (:3001) + front (:5173)
npm run build        # bundle API + build front
npm run typecheck    # TypeScript strict sur les quatre paquets
npm test             # tests unitaires (providers, résolveur de liens, fusion)
npm run lint
npm run db:generate  # nouvelle migration après modification du schéma
```

## Mentions légales

Les données de disponibilité proviennent de **JustWatch via TMDB** ; leur
attribution est affichée dans l'application, comme l'exigent leurs conditions
d'utilisation. Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié
par TMDB.
