# Journal des décisions

Chaque décision avec sa raison et les options écartées. Décisions prises les 15 et 16 novembre
2026, pendant la phase d'architecture.

## Produit

**D1 — Un outil perso, local, vertical d'abord.** Un seul utilisateur, sur son Mac. Format
principal 1080×1920 (TikTok, Reels, Shorts).

**D2 — Je relis le rendu final, pas une preview.** La latence de rendu est acceptable ; on
optimise le temps de rendu (cache par segments) plutôt que de construire un lecteur temps réel.
*Écarté* : une preview temps réel façon Premiere, un projet à part entière.

**D3 — L'interface sert à regarder et à commenter.** Je ne monte pas à la main ; l'UI montre ce
que fait Claude et me permet de rester attentif.

**D4 — Interface à la Figma, outil commentaire au centre.** Barre d'outils minimale ; épingles et
zones sur les frames, plages sur la timeline ; versions comparables.

**D5 — Claude marque « corrigé », moi seul je valide.** Un commentaire n'est jamais fermé sans
que j'aie vu le résultat.

**D6 — Deux usages : monter des rushes, et créer des vidéos 100 % IA.** Les assets peuvent venir
de l'IA (script, personnages, images, vidéos, voix, musique).

**D7 — Publication reportée.** On verra plus tard ; contraintes notées dans
[plus-tard.md](plus-tard.md).

## Architecture

**D8 — Le projet est un ensemble de documents déclaratifs.** Claude édite par des outils typés ;
chaque modification est une révision. *Pourquoi* : undo, comparaison, commentaires ancrés sur des
ids stables, l'UI et Claude voient la même chose. *Écarté* : laisser Claude piloter ffmpeg
directement.

**D9 — L'IA pour le jugement, le déterministe pour le mécanique.** La philosophie du projet : un
écosystème de montage sur mon ordinateur, piloté par Claude, pour créer des vidéos rapidement.

**D10 — TypeScript + Bun.** *Pourquoi* : Remotion et Electron imposent l'écosystème JavaScript ;
un seul modèle partagé entre l'UI, le moteur et la composition Remotion ; le travail lourd est
fait par ffmpeg, Chrome et whisper, donc Rust apporterait peu en vitesse. *Écarté* : un cœur Rust
avec un worker Node pour Remotion (deux langages, modèle dupliqué).

**D11 — Claude Code headless (`claude -p`) plutôt que l'Agent SDK.** *Pourquoi* : rester sur
l'abonnement ; la documentation de l'Agent SDK demande une clé API (facturée au token) et ne
couvre pas explicitement l'usage d'un abonnement. Tous les outils vivent dans le serveur MCP, donc
changer d'avis ne touche qu'un adaptateur.

**D12 — Le serveur lance Claude, pas Electron.** *Pourquoi* : l'UI reste une simple interface, et
on peut aussi lancer Claude depuis la ligne de commande.

**D13 — Frugalité en tokens.** Grilles d'images, zoom ciblé, texte d'abord, dossier de
commentaire préparé, éditions groupées, `--strict-mcp-config`, sessions courtes.

## Vidéo

**D14 — Remotion pour la composition et le motion design.** *Pourquoi* : rendu pro, belles
polices, Claude écrit bien du React, licence gratuite pour un indépendant. *Écarté* : graphe de
filtres ffmpeg seul (le ffmpeg local n'a d'ailleurs pas de rendu de texte), MLT, GStreamer
Editing Services.

**D15 — ffmpeg prépare les sources et fait le son.** Remotion ne fait nativement ni LUT ni
traitement audio.

**D16 — Trois niveaux de cache, segments qui suivent les plans.** Seuls les segments dont le
contenu a changé sont re-rendus ; un décalage dans le temps ne provoque pas de re-rendu.

**D17 — Normalisation en H.264 à l'import.** *Pourquoi* : l'iPhone filme en HEVC et Remotion ne
le décode pas en rendu headless ; la normalisation rend aussi les accès aux images rapides.

**D18 — Détourage de personne, pas de fond vert.** Apple Vision en local (gratuit), FAL en
secours. *Écarté* : chroma key ffmpeg (je n'ai pas de fond vert).

**D19 — Transcription locale avec whisper.cpp, débruitage avec DeepFilterNet.**

## Canvas et génération

**D20 — Un canvas libre, pas un éditeur de workflow.** C'est moi qui crée ; Claude lit et
intervient, il ne construit pas le canvas. *Écarté* : un graphe de nœuds façon ComfyUI.

**D21 — Workflows réutilisables.** Un groupe de cartes reliées s'enregistre et se relance sur de
nouvelles entrées.

**D22 — tldraw pour le canvas.** *Pourquoi* : formes personnalisées en React (cartes de
génération), flèches liées aux éléments avec texte, vidéos, sections, API complète. *Écarté* :
Excalidraw (MIT, mais pas d'éléments personnalisés ni de vidéo), React Flow (MIT, mais orienté
workflow). Licence : mode développement pendant le développement, licence hobby ensuite (à
confirmer, voir [stack.md](stack.md)).

**D23 — Barre de prompt directe, commentaire vers Claude.** Générer depuis la barre de prompt ne
coûte aucun token ; commenter un élément est une demande à Claude.

**D24 — Providers interchangeables, FAL en premier.** Registre de modèles lu depuis l'API de FAL,
formulaires générés depuis leurs schémas, coût affiché et confirmé avant toute dépense. N'importe
quel provider pour la voix et la musique.

**D25 — Clips du montage liés aux éléments du canvas.** Régénérer un plan met le montage à jour.

**D26 — Capture d'apps en composant des MCP existants.** Cezane ajoute l'enregistrement et la
mise en valeur, pas l'automatisation.

## v0.1 (16 novembre 2026)

**D27 — Codex comme fournisseur d'images gratuit.** `codex exec` génère des images sur
l'abonnement ChatGPT ; c'est le modèle par défaut de la barre de prompt. FAL reste pour la vidéo
et les modèles spécialisés, payants.

**D28 — `look` est une composition Remotion.** La grille d'images étiquetées (et l'avant/après)
est rendue par Remotion en une seule image, réduite à 720 px de large avant d'être envoyée à
Claude.

**D29 — MCP en Streamable HTTP sans session.** Un serveur MCP est créé par requête sur `/mcp` ;
le même point d'accès sert Claude headless et un Claude Code ouvert dans un terminal.

**D30 — Recherche d'outils désactivée pour Claude headless.** Avec la recherche d'outils, Claude
perd des tours à charger les outils Cezane ; ils sont chargés d'emblée (`ENABLE_TOOL_SEARCH=false`).

**D31 — Les projets de démo versionnent leurs documents, pas leurs médias.**
