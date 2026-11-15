# Les documents du projet

## Dossier d'un projet

```
mon-projet/
  cezane.json          index du projet : réglages, assets, liste des documents
  montages/<id>.json   timeline d'un montage
  canvases/<id>.json   contenu d'un canvas
  comments.json        tous les commentaires du projet
  versions.json        versions du montage (métadonnées)
  graphics/            composants Remotion écrits pour ce projet
  media/               fichiers importés et générés, nommés par empreinte
  .cezane/
    history/           une copie par révision + journal (qui a changé quoi)
    segments/          segments vidéo rendus (cache)
    renders/           rendu de chaque version
    comments/          captures prises au moment des commentaires
```

Le serveur `cezane` est le seul à écrire ces fichiers. L'UI et Claude passent par lui
([README.md](README.md)).

## Assets

Un seul stock pour tout le projet : fichiers importés, générés ou capturés. Chaque asset garde
sa **provenance** :

- import (chemin d'origine) ;
- ou recette de génération : provider, modèle, prompt, entrées, réglages, seed, coût
  ([generation.md](generation.md)) ;
- ou capture ([plus-tard.md](plus-tard.md)).

Ses dérivés (version normalisée, transcript, voix nettoyée, détourage…) sont rattachés à lui
([ingestion.md](ingestion.md)).

## Montage

- **settings** : 1080×1920, 30 i/s, fond.
- **timeline** : des pistes empilées de bas en haut. Types de clips :
  - `media` : extrait d'une vidéo, image ou audio (point d'entrée, vitesse, cadrage, zoom
    animé). Sa source est soit un asset, soit **un élément du canvas**
    ([canvas.md](canvas.md)) ;
  - `graphic` : un composant Remotion nommé + ses props (titre, sous-titres, lower third,
    callout, transition…) ([motion-design.md](motion-design.md)) ;
  - `captions` : sous-titres mot à mot générés depuis le transcript ;
  - réglages audio par clip (gain, fondus, chaîne de traitement, ducking) et bus master
    (-14 LUFS).

Toutes les modifications passent par les opérations de `core` (ajouter, déplacer, couper,
scinder, supprimer en refermant le trou, modifier des props…). Chaque lot d'opérations est
validé puis enregistré comme une révision ([versions-commentaires.md](versions-commentaires.md)).

### Le détourage (texte, images ou vidéos derrière moi)

Pas de fond vert : c'est un détourage de personne, comme l'effet TikTok. Un clip peut être
affiché en version détourée. « Du texte derrière moi » = trois couches :

```
  vidéo détourée (moi)        ← piste du haut
  texte / image / autre vidéo
  vidéo d'origine (ou un autre fond)  ← piste du bas
```

Une opération d'édition dédiée crée ces couches en une fois. Le détourage lui-même est calculé
une fois par clip ([ingestion.md](ingestion.md)).

## Canvas

Le contenu d'un canvas (éléments, flèches, sections, cartes de génération et leurs versions)
est décrit dans [canvas.md](canvas.md).

## Stockage global et configuration

- Bibliothèque globale `~/Cezane/library` : polices, LUT, logos, effets sonores, composants,
  workflows.
- Cache global `~/Cezane/cache` : dérivés d'ingestion, avec une taille maximale et éviction des
  éléments les moins utilisés (le disque est limité).
- Clés API (FAL, voix, musique…) dans le trousseau macOS.
