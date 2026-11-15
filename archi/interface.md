# Interface

Une interface à la Figma. Un projet contient deux types de documents, ouverts dans des onglets
comme les pages Figma : **Montage** et **Canvas** ([projet.md](projet.md)).

## Écran Montage

```
┌───────────────────────────────────────────────────────────────────┐
│ Cezane   Montage · Canvas                   V4 ▾   Claude ●  Export │
├──────────┬────────────────────────────────────────┬───────────────┤
│ Assets   │              ┌──────────┐              │ Commentaires  │
│          │              │  vidéo   │ ①            │  3 brouillons │
│          │              │  9:16    │   ┌───┐      │  2 en cours   │
│          │              │          │   │ ② │      │  5 corrigés   │
│          │              └──────────┘   └───┘      │ [Envoyer à    │
│          │                                        │  Claude (3)]  │
├──────────┴────────────────────────────────────────┴───────────────┤
│ ▶ 00:12.04  ───●──────①───────[②═══]─────────────  pistes          │
│                 [ Sélection · Main · Commentaire · + ]             │
└───────────────────────────────────────────────────────────────────┘
```

- Au centre, le lecteur du rendu de la version affichée, avec les épingles et les zones des
  commentaires proches de l'instant courant.
- En bas, la timeline : pistes, tête de lecture, commentaires (épingles et plages), passages
  modifiés depuis la version précédente.
- En haut, le sélecteur de version (V4 ▾), l'état de Claude et l'export.

## Écran Canvas

```
  ┌────────┐           ┌─────────┐         ┌─────────┐
  │ Héros  │──────────▶│ Plan 3  │────────▶│ Plan 3  │
  │ fiche  │    ┌─────▶│ image   │         │ vidéo   │
  └────────┘    │      └─────────┘         └─────────┘
  ┌────────┐    │   « il court sous la pluie, plan large »
  │ Ruelle │────┘
  └────────┘
   ┌──────────────────────────────────────────────────────────┐
   │ Décris l'image ou la modification…  Image ▾  Modèle ▾  coût ⏎ │
   └──────────────────────────────────────────────────────────┘
```

Le détail du canvas est dans [canvas.md](canvas.md).

## Éléments communs

- **Barre d'outils flottante**, quatre outils : Sélection (V), Main (H), Commentaire (C),
  + pour ajouter ou importer. Dans le canvas s'ajoutent les outils de création libre (texte,
  note, flèche, section, dessin).
- **Panneau de gauche** : les assets du projet.
- **Panneau de droite contextuel** : commentaires, propriétés de la sélection, ou activité de
  Claude.
- **Barre de prompt** dans le canvas, qui apparaît quand une sélection peut servir à générer.
- **Fil d'activité de Claude** : chaque outil appelé, en direct, et les demandes de permission
  à valider. L'interface sert surtout à regarder ce qui se passe et à rester attentif.

## Raccourcis

| Touche | Action |
|---|---|
| V | Sélection |
| H | Main (déplacer la vue) |
| C | Commentaire |
| Espace | Lecture / pause |
| J / K / L | Arrière / pause / avant |
| ← / → | Une frame en arrière / en avant |
| Échap | Annuler l'action en cours |
