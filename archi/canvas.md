# Le canvas de création

Un canvas **libre**, pour être créatif : pas un éditeur de workflow. C'est moi qui l'utilise pour
générer mes images, mes vidéos, mes scripts ; Claude peut le lire et y intervenir, il ne le
construit pas à ma place.

## Ce qu'on y pose

- Images, vidéos, sons, textes (scripts, prompts, notes).
- Notes, flèches avec texte, sections (comme les frames Figma), dessins à main levée : de quoi
  réfléchir, comme dans FigJam.
- Des **cartes de génération** : un élément qui se génère à partir d'un prompt et de ses entrées.

## Générer

- **Depuis une sélection** : je sélectionne une ou plusieurs images (ou un texte), la barre de
  prompt apparaît, je tape ; le résultat apparaît à côté, relié à ses sources. Je choisis le type
  de sortie (image, vidéo, texte, voix, musique) et le modèle.
- **En reliant** : je tire une flèche d'une image vers une carte de génération pour l'ajouter à
  ses entrées. Les flèches qui arrivent sur une carte sont ses entrées ; les autres flèches sont
  de simples annotations.
- **Retoucher une zone** : je dessine une zone sur une image et j'écris un prompt ; seule cette
  zone est modifiée.
- **Variantes** : j'en demande plusieurs, elles s'empilent, je garde la meilleure.
- **Modifier la recette** : je change le prompt ou une entrée d'une carte, elle se régénère en
  nouvelle version. Les cartes qui en dépendent sont marquées « à régénérer », avec un bouton
  pour tout relancer.
- **Textes** : un script ou un prompt peut lui-même être généré (par Claude via l'abonnement, ou
  par un autre modèle de texte), puis servir d'entrée à d'autres cartes.

Le coût estimé s'affiche avant chaque génération ([generation.md](generation.md)).

## Workflows réutilisables

Essentiel. Je sélectionne un groupe de cartes reliées et je l'enregistre comme **workflow** dans
ma bibliothèque (par exemple « fiche personnage : face, profil, dos » ou « plan vidéo depuis une
image clé »). Pour le réutiliser, je le dépose sur un canvas, je branche de nouvelles entrées, et
je lance.

- Un workflow garde ses prompts, modèles et réglages.
- Certains champs peuvent être marqués comme **paramètres** à remplir à chaque utilisation.
- Les workflows vivent dans la bibliothèque globale (`~/Cezane/library`), utilisables dans tous
  les projets.
- Claude peut lister et lancer mes workflows ([boucle-claude.md](boucle-claude.md)).

## Deux gestes distincts

- La **barre de prompt** appelle le modèle directement, sans passer par Claude : zéro token.
- Le **commentaire** (C) est une demande à Claude : « rends sa veste rouge et garde le même
  visage ». Claude choisit le modèle, écrit le prompt et génère. Même cycle de vie que les
  commentaires du montage ([versions-commentaires.md](versions-commentaires.md)).

## Le lien canvas ↔ montage

Un clip de la timeline peut pointer vers un élément du canvas plutôt que vers un fichier figé.

- Si je choisis une autre variante ou régénère cet élément, le montage se met à jour et produit
  une nouvelle version à relire.
- Dans l'autre sens, quand je commente un plan dans la vidéo finale, Claude sait quel élément du
  canvas l'a produit et peut le régénérer.

## Technique

- Bibliothèque de canvas : **tldraw** ([stack.md](stack.md), [decisions.md](decisions.md)). Elle
  apporte :
  - les formes libres, notes, sections, dessin, images et vidéos ;
  - des flèches accrochées aux éléments, avec du texte, et lisibles par le code (on sait quels
    éléments une flèche relie) ;
  - des formes personnalisées en React : nos cartes de génération, avec leur prompt et leurs
    boutons ;
  - une API pour lire et modifier le canvas par programme.
- Le contenu du canvas vit côté serveur (seul écrivain, comme le reste). L'UI et le serveur
  s'échangent des modifications, ce qui permet à Claude d'agir sur le canvas pendant que je le
  regarde.
- Undo/redo pour mes actions manuelles.
- Une carte de génération stocke sa recette (entrées, prompt, modèle, réglages) et la liste de
  ses versions ; ses entrées sont lues depuis les flèches qui arrivent sur elle.
