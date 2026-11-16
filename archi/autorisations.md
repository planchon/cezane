# Autorisations de Claude

Ce que Claude fait dans Cezane sans demander. Un seul réglage pour tous les projets, dans
`~/Cezane/settings.json` (`CEZANE_HOME`), sous `claude.permissions`. Le fichier n'est écrit qu'au
premier changement ; sans fichier, le niveau est **Équilibré**.

## Niveaux

| Niveau | Sans demander |
|---|---|
| Prudent | Les outils Cezane seulement. Même lire le projet demande. |
| **Équilibré** (défaut) | Lire et modifier le projet et `~/Cezane`, les commandes sans risque, le web. |
| Autonome | Tout, partout. |

Le niveau règle cinq interrupteurs, modifiables un par un : lecture des fichiers, modification des
fichiers, commandes sans risque (`ffprobe ffmpeg ls file mdls sips cat head tail wc`), web
(WebFetch, WebSearch), autres commandes.

**Les générations payantes demandent toujours**, à chaque niveau, et n'ont jamais de « Toujours
autoriser » (`app.generate` demande lui-même, hors de Claude Code).

## Règles Claude Code (Équilibré, par défaut)

Écrites dans `<projet>/.cezane/claude-settings.json` au début de chaque session et passées avec
`claude --settings` (les outils Cezane restent dans `--allowedTools`). `./` est le dossier du projet
(le cwd de Claude) ; `~/Cezane` devient `//chemin/absolu` quand `CEZANE_HOME` est hors du home.

```
allow  Read(./**) Read(~/Cezane/**) Edit(./**) Edit(~/Cezane/**)
       Bash(ffprobe:*) Bash(ffmpeg:*) Bash(ls:*) Bash(file:*) Bash(mdls:*) Bash(sips:*)
       Bash(cat:*) Bash(head:*) Bash(tail:*) Bash(wc:*) WebFetch WebSearch
       + les règles ajoutées
ask    Edit(~/Cezane/settings.json) Edit(~/Cezane/projets.json)
       Edit(./cezane.json) Edit(./versions.json) Edit(./comments.json)
       Edit(./montages/**) Edit(./canvases/**) Edit(./.cezane/**)
additionalDirectories  ~/Cezane
```

Les documents de Cezane demandent : Claude change le montage par les outils Cezane. Le fichier des
autorisations demande à tous les niveaux (Claude ne s'accorde rien seul). Prudent ajoute
`ask Read(./**)`, car Claude Code lit son dossier de travail sans demander. Autonome autorise les
outils sans chemin (`Read`, `Edit`, `Write`, `Bash`…).

## Filet de sécurité : l'outil `approve`

Ce que Claude Code demande encore passe par `mcp__cezane__approve`, qui applique la même logique
(`decide` dans `packages/server/src/permissions.ts`) avant d'afficher une carte : le comportement ne
dépend pas du seul parseur de règles du CLI, et une règle ajoutée en cours de session vaut tout de
suite. Une commande est jugée partie par partie (`;` `&&` `|`…) : une règle `Bash(x:*)` ne couvre
jamais `x && rm …`, ni une redirection vers un fichier ; `$(…)` demande toujours.

Un réglage plus permissif vaut tout de suite ; un réglage plus strict vaut à la session suivante
(les règles du CLI sont lues au démarrage).

## « Toujours autoriser »

Chaque carte, sauf une dépense, propose « Toujours autoriser » et dit la règle ajoutée :

- commande : `Bash(<commande>:*)`, deux mots pour `git`, `npm`, `bun`… (`Bash(git status:*)`),
  la commande exacte pour `rm`, `mv`, `sudo`, `chmod`, `kill`… ;
- fichier : le dossier, `Read(~/Downloads/**)` ou `Edit(//opt/x/**)` ; le fichier exact si le
  dossier est trop large (le home) ou si c'est un document de Cezane ;
- page web : `WebFetch(domain:<hôte>)` ; autre outil : son nom.

Les règles apparaissent dans « Autorisations de Claude » (icône du panneau Claude), d'où on les
retire. API : `GET|PUT /api/settings/permissions`, `POST|DELETE /api/settings/permissions/rules`.

## Délai

Claude Code abandonne un appel MCP au bout de 60 s par défaut ; Cezane lance le CLI avec
`MCP_TOOL_TIMEOUT` à 11 min pour qu'une carte puisse attendre la réponse (10 min au plus).
