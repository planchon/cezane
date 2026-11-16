# Cezane — Architecture

Cezane est un écosystème de création vidéo local, piloté par Claude, pour créer des vidéos
rapidement. Deux usages principaux :

- **Monter des rushes** : je donne des rushes, des assets et des consignes ; Claude monte ; je
  regarde le rendu final et je commente directement dessus ; Claude corrige.
- **Créer des vidéos entièrement générées par IA** : dans un canvas libre, je génère scripts,
  personnages, images et plans vidéo ; tout arrive dans le montage pour en faire une vidéo finale.

Ce dossier fixe l'architecture avant d'écrire du code.

## Sommaire

| Fichier | Contenu |
|---|---|
| [interface.md](interface.md) | L'interface à la Figma : documents, barre d'outils, panneaux |
| [projet.md](projet.md) | Les documents du projet, les assets, le montage, le stockage |
| [projets.md](projets.md) | Plusieurs projets par serveur, dossiers Finder, registre, routes, watcher, jobs |
| [versions-commentaires.md](versions-commentaires.md) | Révisions, versions, outil commentaire, ancres, cycle de vie, comparaison |
| [canvas.md](canvas.md) | Le canvas libre de création, la génération, les workflows, le lien avec le montage |
| [ingestion.md](ingestion.md) | Tout ce qui se calcule une fois à l'import |
| [rendu.md](rendu.md) | Le pipeline de rendu et les trois niveaux de cache |
| [boucle-claude.md](boucle-claude.md) | La boucle avec Claude, les outils MCP, la frugalité en tokens |
| [autorisations.md](autorisations.md) | Ce que Claude fait sans demander : niveaux, règles Claude Code, « Toujours autoriser » |
| [generation.md](generation.md) | Providers IA, registre de modèles, coûts, vidéo 100 % IA |
| [motion-design.md](motion-design.md) | La bibliothèque de composants Remotion et les polices |
| [plus-tard.md](plus-tard.md) | Capture d'apps et publication |
| [stack.md](stack.md) | Les technologies retenues et les points à valider |
| [decisions.md](decisions.md) | Le journal des décisions, avec leurs raisons et les options écartées |
| [v0.1.md](v0.1.md) | Ce que la v0.1 fait, ses écarts avec l'architecture, ce qui reste |
| [tiktok.md](tiktok.md) | Les codes TikTok, ce que Cezane en fait déjà et ce qui manque |

## Principes

1. **Le projet est un ensemble de documents déclaratifs.** Claude ne lance jamais ffmpeg à la
   main pour monter : il modifie les documents avec des outils typés, et le moteur les rend.
   Chaque modification est une révision : on peut annuler, comparer, et voir ce que Claude a changé.
2. **L'IA pour le jugement, du déterministe pour le mécanique.** Couper les silences, normaliser
   le son, générer des sous-titres depuis le transcript, détourer une personne : ce sont des
   outils, pas des tâches pour le modèle. Ils ne coûtent aucun token.
3. **Ne jamais recalculer ce qui n'a pas changé.** Tout ce qui est lourd est mis en cache par
   empreinte de contenu, à trois niveaux ([rendu.md](rendu.md)).
4. **Frugalité en tokens.** Claude tourne sur l'abonnement : chaque outil renvoie le minimum
   utile, les images sont groupées et ciblées ([boucle-claude.md](boucle-claude.md)).
5. **Je pilote, Claude intervient.** Dans le canvas, c'est moi qui crée ; Claude peut lire, agir
   et répondre à mes commentaires. Dans le montage, Claude monte et je relis.
6. **Je relis le rendu final, pas une preview.** La latence de rendu est acceptable.
7. **Les versions et les commentaires sont le cœur de l'outil** : ils doivent être simples et
   fiables ([versions-commentaires.md](versions-commentaires.md)).

Cadre : un seul utilisateur, en local, sur un Mac (M1 Pro, 16 Go). Format principal : vertical
1080×1920 (TikTok, Reels, Shorts).

## Vue d'ensemble

```
┌──────────────────── Electron (UI) ────────────────────┐
│ interface à la Figma : Montage · Canvas               │
│ commentaires, versions, fil d'activité de Claude      │
└───────────────┬───────────────────────────────────────┘
                │ HTTP + SSE (127.0.0.1)
┌───────────────▼───────────────────────────────────────┐
│ cezane (Bun) — serveur local + CLI                    │
│  · seul à écrire le projet (révisions, versions)      │
│  · serveur MCP : les outils de Claude                 │
│  · file de jobs : ingestion, rendus, générations IA   │
│  · lance Claude Code et relaie son activité à l'UI    │
└───┬───────────────┬────────────────┬──────────────┬───┘
    │               │                │              │
┌───▼─────────┐ ┌───▼────────────┐ ┌─▼────────────┐ ┌▼──────────────────┐
│ Claude Code │ │ worker Remotion│ │ providers IA │ │ outils natifs     │
│ `claude -p` │ │ (process chaud)│ │ FAL, voix,   │ │ ffmpeg, whisper,  │
│ ↔ MCP cezane│ │                │ │ musique…     │ │ DeepFilterNet,    │
└─────────────┘ └────────────────┘ └──────────────┘ │ cezane-vision     │
                                                    └───────────────────┘
```

- **`cezane` (Bun)** est le centre : il possède le projet, expose l'API pour l'UI et les outils
  MCP pour Claude, et orchestre tous les jobs. Il s'utilise aussi en ligne de commande
  (`cezane import`, `cezane render`, `cezane agent "…"`).
- **Claude Code** est lancé par le serveur en mode headless, sur l'abonnement
  ([boucle-claude.md](boucle-claude.md)). Le même serveur MCP fonctionne aussi depuis un Claude Code ouvert
  dans un terminal.
- **Le worker Remotion** est un process séparé qui reste allumé (projet Remotion préparé une fois,
  navigateur gardé ouvert). Il calcule des images et des segments vidéo, rien d'autre.
- **Electron** n'est qu'une interface : il affiche l'état du serveur et lui envoie mes actions.

## Organisation du dépôt (workspaces Bun)

```
packages/
  core/       modèles (projet, montage, canvas, commentaires, versions), schémas Zod,
              opérations d'édition, validation → sans API Node, partagé partout
  engine/     ingestion, cache, analyse, segments, rendu audio, appels ffmpeg
  generate/   providers IA, registre de modèles, coûts et budget, workflows
  remotion/   composition `Timeline` + bibliothèque de composants de motion design
  server/     serveur HTTP + MCP, file de jobs, runner Claude Code, CLI `cezane`
  app/        Electron + React (montage, canvas, commentaires, versions)
native/
  vision/     helper Swift : détourage de personne avec Apple Vision
archi/        ce dossier
```

Bun sert de gestionnaire de paquets, de runtime pour `cezane`, et d'outil de test. Deux limites :
le process principal d'Electron tourne sous Node (embarqué par Electron), et Remotion n'est
« en grande partie » supporté par Bun que via sa commande `remotionb`. Le worker Remotion est
isolé dans son propre process : s'il le faut, il tourne sous Node sans rien changer au reste.

## Glossaire

| Terme | Sens |
|---|---|
| Document | Un montage ou un canvas, stocké en JSON dans le projet |
| Révision | Chaque modification enregistrée d'un document (undo, historique fin) |
| Version | Un état du montage rendu et figé, que je relis (V1, V2…) |
| Commentaire | Une remarque ancrée sur une frame, une zone, une plage ou un élément du canvas |
| Ancre de contenu | Le clip et l'instant de la source sous un commentaire, pour qu'il suive le montage |
| Segment | Un morceau de la vidéo finale rendu et mis en cache séparément |
| Carte de génération | Un élément du canvas qui se génère à partir d'un prompt et de ses entrées |
| Recette | Tout ce qui a produit un asset généré : provider, modèle, prompt, entrées, réglages |
| Workflow | Un groupe de cartes reliées, enregistré pour être relancé sur de nouvelles entrées |
| Dossier de commentaire | Le contexte préparé par le serveur pour que Claude traite un commentaire en un appel |

## Phases

1. **Montage et revue** : modèles et opérations, ingestion, composition `Timeline` (coupes,
   zooms, textes, sous-titres), rendu par segments + audio, versions et commentaires, outils MCP,
   runner Claude Code, interface à la Figma.
2. **Canvas de création** : canvas libre, cartes de génération, registre de modèles et coûts,
   variantes et versions d'éléments, workflows réutilisables, lien canvas ↔ montage.
3. **Montage avancé** : détourage, LUT, bibliothèque de motion design élargie, composants écrits
   par Claude.
4. **Capture d'apps** : enregistrement web et simulateur, studio screenshot.
5. **Publication** et planification.
