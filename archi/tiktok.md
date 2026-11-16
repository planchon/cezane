# Codes TikTok : où en est Cezane

État au 16 novembre 2026. Les chiffres viennent d'une recherche sur DarkUGC (vidéos UGC virales
des 180 derniers jours) et de guides publics. Les tailles en px sont pour un cadre de 1080x1920 ;
celles marquées « est. » sont des estimations, aucune source ne les donne.

| Code | Ce qui se fait | Avant | Maintenant |
|---|---|---|---|
| **Zones sûres** | Rien d'important dans les 250 px du haut, les ~30 % du bas, ni à droite au-delà de x 960 (rail d'icônes) | Ignorées | Sous-titres limités à x 120–960 et centrés à y 0,65 ; règles données à Claude. Il manque un calque « zones TikTok » dans le lecteur |
| **Sous-titres** | 2 à 4 mots, une ligne, phrase normale, une couleur. Le style Hormozi (majuscules + mot jaune) est jugé daté | Montserrat 900 en majuscules, contour, mot doré : le look Hormozi | `clean` par défaut (serif Newsreader, page entière visible, mots dits en blanc et suivants à 40 %, sans changement de couleur). Autres styles : `native` (TikTok Sans + contour), `pill`, `box`, et `caps` (Hormozi) seulement sur demande. Coupure des pages à 22 caractères |
| **Sous-titres sur un écran** | Lisibles malgré l'interface en fond | Illisibles sur une capture | Boîte sombre derrière la page pendant une scène de capture |
| **Accroche (1–3 s)** | Bloc blanc natif, texte noir, 4 à 12 mots, y ≈ 0,3, un emoji max à la fin | Gros titre en majuscules | Title `native` ; Claude doit en mettre une |
| **Texte derrière la personne** | 1 à 3 mots, très grands, derrière le haut de la tête, sur un plan moyen avec de l'air au-dessus. Ne marche pas en gros plan | Montage à la main (copie détourée en piste haute). Raté sur les gros plans (commentaire #1 de la démo) | `behind: true` sur BigText ou Title. Placement automatique depuis le haut des cheveux (mesuré par Vision). Reste devant si gros plan ou pas d'espace au-dessus. Détourage aux bords plus fins |
| **Green screen** | Créateur détouré en bas (~55–60 % du cadre), le fond change toutes les 3 à 5 s. C'est le plus gros format UGC | Absent | Outil `green_screen` (fonds en alternance, personne ancrée en bas, contour sticker), sous-titres remontés au-dessus |
| **Rythme** | Plans d'environ 4 s, silences > 0,3 s coupés, punch-in à 110–120 % un plan sur deux | Coupe des silences ; zoom « punch » manuel | Inchangé. Punch-in automatique à faire |
| **SFX** | Rares (2,8 % des accroches). Un whoosh par mot fait daté | Aucun | Aucun par défaut (voulu) |
| **Musique** | Basse sous la voix (est. −18 à −24 dB) ou absente | Ducking, −14 LUFS | Inchangé |
| **Durée** | 15–30 s, la meilleure médiane | Démos de 24 à 33 s | Inchangé |
| **Emoji** | En fin d'accroche, jamais dans les sous-titres | Emoji qui rebondissent dans la démo | Retirés de la démo ; interdits dans les sous-titres |
| **Autres formats** | PiP réaction, écran partagé, listes numérotées, fin en boucle | Absents | PiP et écran partagé possibles avec `box` sur un clip ; listes et fin en boucle à faire |

## Reste à faire, par ordre d'utilité

1. Un calque « zones TikTok » dans le lecteur, et des avertissements dans `look`.
2. Le punch-in automatique sur les coupes (un plan sur deux, 112 %).
3. Une liste numérotée synchronisée sur la parole (« 1. … 2. … »).
4. Calculer la position de la personne dès l'import, pour que Claude sache à l'avance quels plans
   acceptent du texte derrière.
