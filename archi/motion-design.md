# Motion design

Objectif : un rendu pro, avec de belles polices.

- **Bibliothèque de composants Remotion** dans `packages/remotion` : titres, sous-titres animés
  mot à mot, lower thirds, callouts, zooms et punch-ins, transitions, compteurs, emojis.
- **Utilisation dans le montage** : un clip `graphic` référence un composant par son nom avec ses
  props ([projet.md](projet.md)).
- **Polices** : Google Fonts via `@remotion/google-fonts`, polices de marque locales via
  `@remotion/fonts`, rangées dans la bibliothèque globale.
- **Composants écrits par Claude** : Claude peut écrire des composants propres à un projet
  (`graphics/`), vérifiés par un rendu d'image avant d'être utilisés. Ceux qui servent souvent
  remontent dans la bibliothèque.
- **Cache** : la version du code d'un composant fait partie de l'empreinte des segments qui
  l'utilisent ; modifier un composant ne re-rend que ces segments ([rendu.md](rendu.md)).
- **Licence Remotion** : gratuite pour un indépendant, y compris en usage commercial.
