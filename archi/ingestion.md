# Ingestion : tout ce qui se calcule une fois

Ces étapes ne dépendent pas du montage. Elles tournent en arrière-plan à l'import (ou à
l'arrivée d'un fichier généré) et sont mises en cache **par empreinte du fichier source** dans un
cache global (`~/Cezane/cache`) : un fichier utilisé dans deux projets n'est traité qu'une fois.

| Étape | Outil | Quand |
|---|---|---|
| Métadonnées | ffprobe | import |
| Normalisation : H.264, fréquence d'images constante, rotation appliquée, keyframes rapprochées (accès rapide à n'importe quelle image), résolution plafonnée avec de la marge pour les zooms | ffmpeg + encodeur matériel VideoToolbox | import |
| Audio en WAV 48 kHz | ffmpeg | import |
| Transcription mot à mot | whisper.cpp sur le GPU (Metal), modèle large-v3-turbo | import |
| Silences, changements de plan, loudness | ffmpeg (`silencedetect`, score de scène, `ebur128`) | import |
| Débruitage de la voix | DeepFilterNet, version nettoyée gardée à côté de l'originale | import |
| Vignettes et forme d'onde pour l'UI | ffmpeg | import |
| Détourage de personne | `cezane-vision` (Apple Vision, sur le Neural Engine, gratuit) ; modèles de détourage vidéo de FAL en secours si la qualité ne suffit pas | à la première utilisation |
| LUT appliquée | ffmpeg `lut3d` | à la première utilisation |

## Notes

- **H.264 obligatoire** : l'iPhone filme en HEVC par défaut, et Remotion ne peut pas décoder le
  HEVC pendant un rendu headless.
- **Fréquence constante** : les téléphones et les enregistrements d'écran sont souvent en
  fréquence d'images variable, source de décalages son/image.
- **Détourage** : Apple Vision fournit le détourage de personne sur macOS
  (`VNGeneratePersonSegmentationRequest`, et les masques par personne depuis macOS 14), appelé
  par un petit helper Swift. Le résultat est une vidéo avec transparence (WebM VP9 avec alpha),
  lue par Remotion.
- **Cache** : taille maximale avec éviction des éléments les moins utilisés (le disque est
  limité).
- Les traitements « à la première utilisation » ont pour clé le fichier **et** les paramètres
  (par exemple LUT + intensité).
