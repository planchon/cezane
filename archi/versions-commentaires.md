# Versions et commentaires

C'est la partie qui doit être la plus solide : j'utilise surtout l'outil commentaire, dans le
temps et surtout sur les frames.

## Révisions et versions

- **Révision** : chaque modification d'un document, automatique, invisible au quotidien. Sert à
  l'undo et à l'historique fin.
- **Version du montage** (V1, V2…) : un état rendu, que je relis. Une version est figée :
  - le rendu vidéo ;
  - l'état des documents ;
  - les commentaires traités ;
  - un résumé des changements ;
  - les passages modifiés depuis la version précédente.

  Une nouvelle version est créée à la fin de chaque passage de Claude, ou à la main.
- **Version d'un élément du canvas** : chaque génération d'un élément crée une version ; les
  variantes d'une même génération sont empilées et j'en choisis une.
- **Restaurer** une ancienne version crée une nouvelle version : l'historique n'est jamais
  réécrit.

## L'outil commentaire

- C puis clic sur l'image : une épingle sur cette frame précise.
- C puis glisser sur l'image : une zone.
- Glisser sur la timeline : une plage de temps.
- Sur le canvas : épingle ou zone sur une image, une vidéo ou un texte.

Le commentaire enregistre la frame exacte de la version affichée (numéro de frame, pas un
timecode approximatif), plus une capture de ce que je voyais. Claude et moi savons toujours de
quoi il parlait, même si la vidéo a changé depuis.

## Ancres

Un commentaire est ancré sur :

- **une version du montage** : frame (ou plage de frames), zone éventuelle (coordonnées
  normalisées sur l'image), et une **ancre de contenu** — le clip et l'instant de la source à cet
  endroit ;
- **ou un élément du canvas** : l'élément, sa version, une zone éventuelle.

L'ancre de contenu fait tenir le commentaire quand le montage bouge : si Claude coupe 3 s avant,
l'épingle suit le moment dans la version suivante. Si le passage a été supprimé, le commentaire
l'indique.

## Cycle de vie

```
Brouillon → Envoyé → En cours → Corrigé dans V4 → Validé
                                       └────────→ Rouvert (avec ma réponse)
```

- Les commentaires restent en brouillon jusqu'à « Envoyer à Claude (n) » : un lot, une seule
  session, une seule nouvelle version.
- Claude ne valide jamais : il marque « corrigé », explique ce qu'il a fait et dans quelle
  version. C'est moi qui valide en regardant le résultat, ou qui rouvre avec une réponse.
- Chaque commentaire est un fil : mes messages et ceux de Claude.

Le traitement d'un lot par Claude est décrit dans [boucle-claude.md](boucle-claude.md).

## Comparer

- Sélecteur de version (V4 ▾) pour revoir n'importe quelle version.
- Comparaison A/B : bascule ou côte à côte, lecture synchronisée.
- Passages modifiés surlignés sur la timeline (ce sont les segments re-rendus,
  [rendu.md](rendu.md)).
- Avant/après sur chaque commentaire corrigé.
