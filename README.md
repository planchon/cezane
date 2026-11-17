<img src="assets/brand/app-icon.png" width="96" alt="">

# Cezane

Un éditeur vidéo pour Mac piloté par Claude, pour créer des vidéos verticales rapidement. Tu donnes
des rushes et des consignes, Claude monte avec des outils typés, tu relis le rendu final et tu
commentes directement dessus ; Claude corrige et une nouvelle version sort.

> Version de test (0.1). Mac Apple Silicon uniquement. L'app n'est pas notarisée par Apple : voir
> [Premier lancement](#premier-lancement).

L'architecture est dans [archi/](archi/README.md) ; l'état de la v0.1 est dans
[archi/v0.1.md](archi/v0.1.md).

## Installer

Il faut un Mac Apple Silicon (M1 ou plus récent) et
[Claude Code](https://code.claude.com/docs/en/overview) connecté à un abonnement Claude :
c'est lui qui monte les vidéos.

**Avec le Terminal (recommandé)** : installe l'app dans Applications, puis ffmpeg et whisper-cpp avec
Homebrew s'ils manquent. Relance la même commande pour mettre à jour.

```sh
curl -fsSL https://raw.githubusercontent.com/planchon/cezane/main/install.sh | bash
```

**En téléchargeant l'app** : prends `Cezane-<version>-arm64.dmg` dans les
[releases](https://github.com/planchon/cezane/releases/latest), glisse Cezane dans Applications, puis
installe les outils :

```sh
brew install ffmpeg whisper-cpp
curl -fsSL https://claude.ai/install.sh | bash   # Claude Code, puis lance `claude` pour te connecter
```

**Depuis le code** : voir [Développer](#développer).

### Premier lancement

L'app est signée ad hoc, pas notarisée. Si tu l'as téléchargée avec un navigateur, macOS refuse de
l'ouvrir la première fois. Ouvre **Réglages Système › Confidentialité et sécurité**, puis clique sur
**Ouvrir quand même** en face de Cezane. Ou, dans le Terminal :

```sh
xattr -dr com.apple.quarantine /Applications/Cezane.app
```

Le script d'installation fait déjà cette étape.

Au premier lancement, la carte « Préparer Cezane » de l'accueil liste ce qui manque. Elle télécharge
aussi le modèle de transcription (574 Mo). Codex CLI, Google Chrome et Xcode sont optionnels : ils
ajoutent la génération d'images, les captures web et les captures du simulateur iOS.

Tes projets sont des dossiers Finder dans `~/Cezane/Projets/<nom>/` (Rushes, Générés, Captures,
Exports). Pour désinstaller, supprime `/Applications/Cezane.app`, et `~/Cezane` si tu veux aussi
effacer les projets.

## Développer

Prérequis : Bun 1.3, ffmpeg 8 (Homebrew), `whisper-cpp` (Homebrew) et le modèle
`~/Cezane/models/ggml-large-v3-turbo-q5_0.bin`, Google Chrome, Xcode (helper Swift), Claude Code
connecté à l'abonnement. Codex CLI est optionnel (génération d'images gratuite sur l'abonnement
ChatGPT). Clone ailleurs que dans `~/cezane` : macOS ne distingue pas les majuscules, et
`~/Cezane` est le dossier des données de l'app.

```sh
bun install
bun run build:ui                       # construit l'interface (servie par le serveur)
bun run app -- demo/cezane-demo        # Electron : lance le serveur et ouvre l'app
# ou sans Electron :
bun run serve demo/cezane-demo         # puis http://127.0.0.1:4317
bun run install:mac                    # installe Cezane.app, qui tourne sur ce clone
bun run release:mac                    # construit l'app autonome : out/release/*.dmg et *.zip
```

## La CLI

```sh
bun run cezane init <dossier> [--name N]
bun run cezane serve [dossier] [--port 4317]  # un serveur pour tous les projets ; dossier = projet par défaut
bun run cezane projects                                  # liste les projets (ids)
bun run cezane import <fichiers…> [--capture ios|web --target T]
bun run cezane tool <outil> '<json>' [--out image.jpg]   # appelle un outil MCP comme Claude
bun run cezane edit '<ops json>' [--reason r]
bun run cezane render [résumé]                            # rend une version et attend
bun run cezane send [ids…]                                # envoie les commentaires à Claude
bun run cezane agent "<consigne>"                         # Claude travaille sur le projet
bun run cezane state
# les commandes de projet visent le projet par défaut, ou --project <id>
```

Le serveur MCP est sur `http://127.0.0.1:4317/mcp` (projet par défaut) et
`http://127.0.0.1:4317/api/p/<id>/mcp` (chaque projet) : il marche aussi depuis un Claude Code ouvert
dans un terminal (`claude mcp add --transport http cezane http://127.0.0.1:4317/mcp`). Projets,
dossiers Finder et routes : [archi/projets.md](archi/projets.md).

## Organisation

| Dossier | Rôle |
|---|---|
| `packages/core` | modèles Zod (projet, montage, commentaires, versions), opérations d'édition, segments, résumé |
| `packages/engine` | ingestion ffmpeg/whisper, mixage audio, rendu par segments, look, détourage, capture, génération |
| `packages/remotion` | composition `Timeline`, grille `Look`, bibliothèque de motion design, worker de rendu |
| `packages/server` | stockage du projet (révisions, versions), API HTTP + SSE, outils MCP, boucle Claude, CLI |
| `packages/app` | interface Electron + React (montage, canvas tldraw, commentaires, activité de Claude) |
| `native/vision` | helper Swift : détourage de personne avec Apple Vision |
| `assets/brand` | icône, logo et images d'ambiance façon Cézanne, générés avec Codex |
| `demo/` | trois projets : la démo de Cezane, l'explication de Rewind, l'explication de Dax |

## Les projets de démo

Chaque projet versionne ses documents (`cezane.json`, montage, canvas, commentaires, versions) ;
les médias et les caches ne sont pas dans git. Les scripts de `demo/scripts/` reconstruisent les
montages Rewind et Dax depuis un serveur lancé sur le projet.

- `demo/cezane-demo` : toutes les fonctionnalités (montage par Claude, coupe des silences,
  accroche native, sous-titres, texte derrière la personne, green screen, b-roll, scènes de
  capture avec curseur, musique sous la voix, canvas avec génération Codex et Claude, versions et
  commentaires corrigés).
- `demo/rewind` : vidéo de docs de Rewind en 16:9 (captures web dans une fenêtre, curseur,
  loupe, poussée de caméra), sans voix, musique tendance.
- `demo/dax` : vidéo d'onboarding de Dax en vertical (captures du simulateur iOS dans un iPhone,
  curseur à la Figma, loupe), sans voix, musique tendance.
