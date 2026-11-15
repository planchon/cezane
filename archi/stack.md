# Stack

| Rôle | Choix |
|---|---|
| Langage, runtime, paquets, tests | TypeScript, Bun (workspaces) |
| Schémas et validation | Zod (sert aussi aux schémas d'entrée des outils MCP) |
| Serveur MCP | `@modelcontextprotocol/sdk`, transport HTTP |
| Interface | Electron + React |
| Canvas | tldraw |
| Composition et motion design | Remotion |
| Vidéo et audio | ffmpeg / ffprobe 8 (Homebrew), VideoToolbox |
| Transcription | whisper.cpp (Metal) |
| Débruitage voix | DeepFilterNet |
| Détourage | Apple Vision via un helper Swift ; FAL en secours |
| Génération | FAL + providers de voix, musique, texte au choix |
| Agent | Claude Code (`claude -p`, abonnement) |

Les raisons de ces choix et les options écartées sont dans [decisions.md](decisions.md).

## Environnement constaté

- Mac M1 Pro, 8 cœurs, 16 Go de RAM.
- ffmpeg 8.1 (Homebrew) : encodeurs VideoToolbox (H.264, HEVC, ProRes), `lut3d`, `chromakey`,
  `afftdn`, `arnndn`, `loudnorm`, `acompressor`, `sidechaincompress` disponibles ; pas de libass,
  freetype ni `drawtext` (aucun texte rendu par ffmpeg, ce qui ne gêne pas : Remotion s'en
  charge).
- Claude Code 2.1.322.
- Google Chrome installé (utilisé par Remotion).

## Licences

- **Remotion** : gratuite pour un indépendant, y compris en usage commercial.
- **tldraw** : on développe avec le SDK en mode développement (pas de clé nécessaire). Pour
  l'usage réel, on prendra la licence hobby (gratuite, filigrane « made with tldraw »).

## Points à valider à l'implémentation

- **Licence hobby tldraw** : elle est réservée aux projets non commerciaux ; confirmer auprès de
  tldraw qu'un outil personnel servant à produire du contenu monétisé est couvert, avant de
  quitter la phase de développement.
- Lecture des vidéos détourées (WebM VP9 avec alpha) par le composant `<Video>` de Remotion ;
  sinon `<OffthreadVideo transparent>`.
- Stabilité du détourage Apple Vision d'une frame à l'autre (bords qui scintillent) ; lissage ou
  bascule vers FAL.
- API de rendu de Remotion sous Bun ; sinon le worker tourne sous Node.
- Paramètres d'encodage communs à tous les segments pour un recollage sans réencodage.
