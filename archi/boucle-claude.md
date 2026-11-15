# La boucle avec Claude

## Lancement

Le serveur lance Claude Code en headless, sur l'abonnement :

```
claude -p --output-format stream-json --input-format stream-json
       --mcp-config <cezane.mcp.json> --strict-mcp-config
       --permission-prompt-tool mcp__cezane__approve
       --append-system-prompt <guide de Cezane> --resume <session>
```

- `--strict-mcp-config` : seuls les outils de Cezane sont chargés (et les MCP de capture quand
  on en a besoin), pas tous les serveurs MCP de mon compte.
- `--permission-prompt-tool` : quand Claude veut faire une action non autorisée d'avance (Bash,
  écriture de fichiers hors projet, dépense…), la demande arrive dans l'UI et j'approuve ou je
  refuse.
- Le flux JSON est relayé à l'UI : je vois chaque outil appelé, en direct.
- On n'utilise pas `--bare` : ce mode n'utilise pas la connexion de l'abonnement.

Les mêmes outils MCP sont utilisables depuis un Claude Code ouvert dans un terminal.

## Le cycle de revue

1. Je regarde le rendu (ou le canvas) et je laisse plusieurs commentaires.
2. Je les envoie à Claude d'un coup : une seule session.
3. Pour chaque commentaire, Claude récupère un **dossier de commentaire** préparé par le serveur
   (capture, zoom sur la zone, images autour, transcript du passage, clips ou élément concernés),
   modifie, vérifie sur des images fixes, répond et marque « corrigé ».
4. Pour le montage, le serveur re-rend les segments touchés et crée la nouvelle version
   ([rendu.md](rendu.md)).
5. L'UI affiche le résultat, avec les passages modifiés surlignés ; je valide ou je rouvre
   ([versions-commentaires.md](versions-commentaires.md)).

Chaque lot de commentaires démarre une session neuve : l'état vit dans le projet, pas dans la
conversation, et Claude repart du résumé du projet.

## Les outils MCP

Peu d'outils, avec des descriptions courtes.

| Outil | Rôle |
|---|---|
| `overview` | résumé compact du projet : documents, assets, clips et éléments avec ids, commentaires ouverts |
| `transcript` | transcript horodaté d'un asset ou d'une plage de la timeline |
| `look` | une seule image : grille de frames ou d'éléments étiquetés, zoom sur une zone, ou avant/après |
| `comment_context` | le dossier de commentaire d'un ou plusieurs commentaires |
| `edit` | lot d'opérations sur le montage → une révision ; renvoie un résumé des changements |
| `canvas` | lire une zone du canvas en version compacte, ou y créer/modifier des éléments |
| `generate` | générer via un provider (image, vidéo, texte, voix, musique…), avec confirmation du coût |
| `workflow` | lister et lancer les workflows de ma bibliothèque |
| `cut_silences` | coupe les silences et les hésitations d'après l'analyse (déterministe) |
| `captions` | crée les sous-titres depuis le transcript, dans un style donné (déterministe) |
| `audio_cleanup` | applique un preset de traitement voix/musique (déterministe) |
| `graphics` | catalogue des composants de motion design ; écriture d'un composant propre au projet, vérifié par un rendu d'image |
| `import` | importe des fichiers et lance leur ingestion |
| `render` | lance le rendu (relecture ou export) |
| `reply` | répond à un commentaire et le marque « corrigé » |
| `approve` | réservé au mécanisme de validation des permissions |

## Frugalité en tokens

- **Images groupées** : le coût d'une image est proportionnel à ses pixels. `look` assemble
  plusieurs frames ou éléments étiquetés dans une image de la taille d'une seule frame.
- **Zoom ciblé** : pour un détail, seule la zone concernée est envoyée, en pleine résolution.
- **Avant/après** dans une même image pour vérifier une correction.
- **Texte d'abord** : transcript horodaté, résumé compact du montage et du canvas, chiffres
  d'analyse.
- **Un appel au lieu de plusieurs** : dossier de commentaire préparé d'avance, éditions groupées.
- **Peu d'outils** et seulement ceux de Cezane chargés (`--strict-mcp-config`).
- **Sessions courtes**, repartant du résumé du projet.
- **Déterministe partout où c'est possible**, et génération directe depuis la barre de prompt du
  canvas sans passer par Claude ([canvas.md](canvas.md)).
