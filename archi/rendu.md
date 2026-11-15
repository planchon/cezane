# Rendu : ne re-rendre que ce qui a changé

L'objectif : ne pas passer un temps fou en rendu à chaque commentaire.

## Le pipeline

1. **Image** : une seule composition Remotion, `Timeline`, sait dessiner n'importe quelle frame
   d'un montage. Elle lit les versions normalisées des sources ([ingestion.md](ingestion.md)).
   Elle est muette.
2. **Son** : une piste audio rendue à part par ffmpeg sur toute la durée, depuis les sources
   nettoyées : EQ, compression, de-esser, musique baissée sous la voix, effets sonores, puis
   normalisation à -14 LUFS en deux passes. Une modification du son ne déclenche jamais de rendu
   d'image.
3. **Assemblage** : ffmpeg recolle les segments vidéo sans réencoder et ajoute le son.

Remotion ne fait nativement ni LUT ni traitement du son : il compose l'image, ffmpeg prépare les
sources et s'occupe de l'audio.

## Les trois niveaux de cache

1. **Par fichier source**, à l'import ([ingestion.md](ingestion.md)).
2. **Par traitement lourd** (détourage, LUT), clé = fichier + paramètres, à la première
   utilisation.
3. **Par segment de la vidéo finale.** La vidéo est découpée en segments ; chacun a une empreinte
   de tout ce qui s'y affiche. Après une modification, seuls les segments dont l'empreinte a
   changé sont re-rendus.

## Les segments suivent les plans

Les segments sont découpés sur les plans de la piste principale (les plans longs sont
redécoupés à partir de leur début), pas sur une grille fixe.

L'empreinte d'un segment décrit son contenu **par rapport au début du segment** : si Claude coupe
2 s au début, les plans suivants sont décalés mais identiques, donc pas re-rendus.

L'empreinte contient :

- la partie visible de chaque élément dans le segment (par exemple seulement les mots de
  sous-titres qui y tombent) ;
- la version du code des composants utilisés ;
- l'empreinte des sources et de leurs dérivés ;
- les réglages de rendu.

Le rendu Remotion est déterministe à la frame : un segment rendu seul est identique au même
passage dans un rendu complet, même si une animation déborde sur le segment voisin.

Les segments re-rendus entre deux versions sont aussi les « passages modifiés » surlignés dans
l'UI ([versions-commentaires.md](versions-commentaires.md)).

## Réglages de vitesse

- **Worker Remotion chaud** : le projet Remotion n'est reconstruit que quand le code d'un
  composant change ; le navigateur reste ouvert entre les rendus.
- **Frames en JPEG** (le PNG ne sert qu'aux rendus avec transparence).
- **Encodage matériel** (VideoToolbox) pour les rendus de relecture, avec les mêmes paramètres
  pour tous les segments afin de pouvoir les recoller sans réencoder.
- **Export de publication** : réencode le rendu validé avec les réglages de la plateforme.
- **Un seul gros job de rendu à la fois** (16 Go de RAM) ; un rendu devenu obsolète (nouvelle
  révision) est annulé.

## Ce que Claude regarde pendant qu'il travaille

Claude ne déclenche pas de rendu vidéo pour vérifier son travail : il demande des images fixes
(Remotion `renderStill`), assemblées en une seule image ([boucle-claude.md](boucle-claude.md)). Le rendu vidéo
complet n'est lancé qu'à la fin d'un lot de corrections.
