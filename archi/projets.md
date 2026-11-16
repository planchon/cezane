# Plusieurs projets, dossiers Finder

Un seul serveur `cezane serve` gère tous les projets ouverts. L'app montre un onglet par projet
(un projet contient un ou plusieurs reels = montages) et un onglet d'accueil qui liste tous les
projets et leurs reels.

## Le dossier d'un projet

```
Mon projet/
  Rushes/          vidéos, sons et images importés, sous leur nom d'origine (« plage 2.mov » en cas de doublon)
  Générés/         images et vidéos générées : slug du prompt + compteur (« fond-studio-01.png »)
  Captures/        captures du simulateur iOS et du web (« dax-today.mp4 », « rewind-codes-01.png »)
  Exports/         chaque rendu terminé : « <slug du reel>-v3.mp4 » (lien physique, aucun octet en plus)
  cezane.json      index : réglages, assets (chemins relatifs), liste des montages et canvas
  montages/  canvases/  comments.json  versions.json  graphics/  luts/
  .cezane/         interne : historique, rendus, segments, sauvegardes, layout.json, trash.json
```

- Les sous-dossiers sont libres (« Rushes/Jour 1/ »).
- Les ids d'assets ne changent jamais. `asset.file` est un chemin relatif au projet, en NFC.
- Slug d'un reel : le nom du montage, ou le nom du projet quand le montage s'appelle « Montage »
  (`dax-explication-v4.mp4`).
- Les fichiers internes (`.cezane/renders/vN.mp4`) restent la référence des versions : supprimer
  un export dans le Finder ne casse rien. `POST …/versions/:id/export` le recrée.

## Le registre

- Par défaut, les projets vivent dans `~/Cezane/Projets/<nom>/`. Un dossier posé là depuis le
  Finder est trouvé tout seul.
- `~/Cezane/projets.json` retient tous les projets connus avec leur id stable (« dax »,
  « mon-reel-2 »), les dossiers ouverts d'ailleurs et les démos du dépôt (`demo/*/`).
- Une démo dont le checkout a disparu (worktree supprimé) sort de la liste au démarrage.
- « Fermer » un projet (DELETE) l'oublie seulement : son dossier n'est jamais touché. Le rouvrir
  le remet dans la liste.
- Projet par défaut : le dossier passé à `cezane serve <dir>`, sinon le dernier ouvert. Les routes
  sans projet (`/api/state`, `/mcp`, `/files/project/…`) visent ce projet : l'app actuelle et la
  CLI continuent de marcher. La CLI vise un autre projet avec `--project <id>`.
- Un projet est chargé au premier accès : migration, watcher, runner Claude.

## Les routes

Toutes en JSON, types dans `packages/core/src/api.ts`.

| Route | Rôle |
|---|---|
| `GET /api/projects` | `ProjectSummary[]` : nom, chemin, reels (statut, vignette, vidéo, export), dernière modification |
| `GET /api/projects/events` | SSE `ProjectsEvent` pour l'onglet d'accueil |
| `POST /api/projects {name}` | crée `~/Cezane/Projets/<nom>/` |
| `POST /api/projects/open {path, init?}` | ouvre un dossier existant (`init` crée cezane.json s'il manque) |
| `DELETE /api/projects/:id` | oublie le projet |
| `GET /api/jobs` | `SchedulerState` : limites et jobs de tous les projets |
| `/api/p/:id/<route>` | toutes les routes de projet : `state`, `events`, `edit`, `undo`, `import`, `upload`, `render`, `versions/…`, `comments/…`, `claude/…`, `canvas…`, `generate`, `transcript`, `waveform`… |
| `GET /api/p/:id/reels` | `ReelSummary[]` : les reels du projet (`active` = le reel sélectionné) |
| `POST /api/p/:id/reels {name, select?}` | crée un reel vide au format du reel sélectionné, et le sélectionne (sauf `select: false`) |
| `POST /api/p/:id/reels/:reel/select` | sélectionne un reel → `ServerState` |
| `PATCH /api/p/:id/reels/:reel {name}` | renomme un reel |
| `GET /api/p/:id/files` | `FilesListing` : l'arbre des quatre dossiers, chaque fichier avec ses métadonnées |
| `POST /api/p/:id/reveal {path \| assetId \| versionId}` | `open -R` : montre le fichier dans le Finder (rien = le dossier du projet) |
| `POST /api/p/:id/capture {target, mode, url…}` | capture → Captures/, renvoie le job |
| `POST /api/p/:id/versions/:v/export` | relie de nouveau un rendu dans Exports/ |
| `POST /api/p/:id/mcp` | le serveur MCP du projet (Claude) |
| `GET /files/p/:id/<chemin>` | fichiers du projet (Range) ; `/files/cache/<hash>/…` reste commun |

Chaque route de projet existe aussi sans `/p/:id` pour le projet par défaut.

Pour la vue « Médias » : `ProjectFile` donne type, durée, dimensions, taille, dates, `thumbUrl` /
`posterUrl`, l'asset lié et son statut, la provenance (prompt, modèle, coût et références
pour un généré ; source et cible pour une capture ; version pour un export), les montages qui
l'utilisent, et `duplicateOf` pour un doublon non importé. `missing` liste les assets utilisés dont
le fichier a disparu. L'événement SSE `{type: "files"}` dit quand recharger la liste.

## Les reels

Un projet contient un ou plusieurs reels (montages). Un seul est **sélectionné** par projet
(`.cezane/active-reel.json`, le premier par défaut) : `state`, `events`, `edit`, `undo`, `render`,
`versions`, `comments`, Claude et le MCP agissent sur lui, y compris par les routes sans projet.

- `ServerState.montage`, `revision`, `versions` et `comments` sont ceux du reel sélectionné (plus les
  commentaires du canvas, commun au projet) ; `ServerState.reels` les liste tous.
- Historique par reel : le premier montage garde `.cezane/history/` (comme avant), les autres
  `.cezane/history/<montageId>/`. Les numéros de révision comptent par reel.
- Versions : l'id reste unique dans le projet (`v7`, fichiers `.cezane/renders/v7.mp4`), le numéro
  affiché `n` compte par reel (V1, V2…), et l'export suit : `<slug du reel>-v1.mp4`. Les commentaires
  sont numérotés par reel (#1, #2…).
- Une session Claude reste sur le reel où elle a commencé : son URL MCP porte `?reel=<id>`
  (`ClaudeStatus.montageId`). L'utilisateur peut changer de reel pendant qu'elle travaille.
- Renommer ne crée pas de révision (le nom survit à un undo). Un nouveau reel reprend le format,
  l'étalonnage et l'audio du reel sélectionné, sans clips.
- Les rendus portent `Job.montageId`. `ReelSummary` donne aussi `frames` (3 images dans l'ordre du
  montage), `comments {open, toReview}`, `rushes {aroll, broll}`, `claude`.

## L'app : onglets et Atelier

- Un onglet par projet ouvert, plus l'onglet d'accueil (grille). Fermer un onglet (×, clic milieu)
  ne touche pas au projet. Onglets, onglet actif, vue et reel de chaque onglet : `localStorage`
  (`cezane.tabs.v1`).
- Le client API (`src/api.ts`) préfixe `/api/p/<id>` et `/files/p/<id>` selon l'onglet actif ; seul
  l'onglet actif suit le flux complet (`/api/p/<id>/events`), les onglets et l'Atelier utilisent
  `/api/projects/events` et `/api/jobs` (interrogé chaque seconde sur l'Atelier).
- « Ouvrir un dossier… » : le sélecteur macOS via le preload Electron (`window.cezane.pickFolder()`),
  un champ de chemin dans un navigateur. Un dossier sans cezane.json devient un projet après
  confirmation (`init: true`).
- Atelier : reels groupés En cours / Prêts. Pastilles : Claude monte (Claude sur ce reel, avec la
  progression de son rendu ou de son job), Rendu, Échec, Rushes (jamais rendu), À relire (commentaires
  ouverts ou corrigés à valider), Prêt. « Publiés » n'existe pas : le serveur ne le sait pas.

## Le watcher

Rushes/, Générés/ et Captures/ sont suivis (récursivement), avec un passage lent de sécurité
toutes les 20 s et au chargement du projet.

- Un fichier ajouté depuis le Finder devient un asset, utilisé là où il est, puis passe par
  l'ingestion habituelle. Provenance : import (Rushes/, Générés/) ou capture « finder » (Captures/).
- Un fichier n'est pris que quand sa taille ne bouge plus (copie en cours).
- Renommé ou déplacé : même asset (même id, retrouvé par empreinte) ; son nom suit celui du
  fichier s'il était identique.
- Supprimé : si un montage ou un canvas l'utilise, l'asset est marqué `missing` (les rendus
  continuent depuis le cache) ; sinon il est mis de côté dans `.cezane/trash.json` et revient avec
  son id si le même fichier réapparaît (Corbeille → Remettre).
- Un doublon exact d'un asset n'est pas importé une deuxième fois.
- Les fichiers que le serveur écrit lui-même (import, upload, génération, capture) sont réservés
  avant l'écriture : le watcher les ignore. Les fichiers cachés, `.part`, `.crdownload`, `.tmp`
  et `.events.json` sont ignorés.

## Les générations et les captures

- Une génération (canvas ou Claude) écrit son résultat directement dans `Générés/<slug>-NN.<ext>`
  (`engine/generate.ts`, option `out`) ; le dossier de travail dans `.cezane/generate/` est
  supprimé.
- Une capture écrit dans `Captures/` : nom donné, sinon slug de l'URL + compteur, sinon
  « simulateur-01 ». Le journal d'interactions d'un enregistrement web part dans le cache.

## Le planificateur de jobs

Une seule file pour tout le serveur ; chaque job porte son `projectId`.

| Type | Limite globale | Par projet |
|---|---|---|
| render | 2 (`CEZANE_PARALLEL_RENDERS` ou `cezane serve --parallel N`) | 1 (cache de segments partagé) |
| capture | **toujours 1** : un seul simulateur, un seul Chrome | — |
| ingest | 2 | — |
| generate | 3 | — |
| cutout | 1 | — |

Le worker Remotion (un Chrome) est commun : deux rendus de projets différents avancent en
parallèle sur leurs étapes ffmpeg (détourage, étalonnage, mixage, assemblage), les segments
Remotion passent un par un.

## Migration (layout v1 → v2)

À l'ouverture, un projet encore en `media/<hash>.<ext>` est migré :

- noms lisibles depuis le nom d'origine (import), le prompt (génération), le nom ou l'URL (capture) ;
- les rendus prêts sont reliés dans Exports/ (une fois, à la migration) ;
- le plan est écrit dans `.cezane/migration.json` avant le premier déplacement. Un échec remet
  tout en place et laisse le projet intact ; une migration interrompue (crash) est annulée ou
  terminée à l'ouverture suivante ;
- copie des documents d'origine dans `.cezane/backup/` ; les fichiers de `media/` qu'aucun asset
  n'utilise restent où ils sont ;
- `.cezane/layout.json` garde la table ancien → nouveau chemin : si un vieux serveur réécrit
  cezane.json avec les anciens chemins, la migration suivante les répare ;
- idempotente : relancée, elle ne fait rien.

Démos du dépôt migrées le 16 novembre 2026 (37 fichiers, 15 exports). Leurs dossiers de médias
(`Rushes/`, `Générés/`, `Captures/`, `Exports/`) ne sont pas versionnés, comme `media/` avant.
