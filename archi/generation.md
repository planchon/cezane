# Génération IA

## Providers

- **Interchangeables** : FAL en premier (images, édition avec références, vidéos, détourage, lip
  sync, upscale…), et n'importe quel provider de voix, musique, bruitages ou texte derrière la
  même interface.
- Chaque provider déclare ses modèles avec leurs capacités (texte → image, édition d'image avec
  références, image → vidéo, première/dernière image, voix, musique, lip sync…), le schéma de
  leurs paramètres et leur prix.

## Registre de modèles

- FAL expose la liste de ses modèles par catégorie (`GET https://api.fal.ai/v1/models`) et le
  schéma des paramètres de chacun (option `expand=openapi-3.0`).
- Le formulaire de réglages d'une carte de génération est généré depuis ce schéma : un nouveau
  modèle FAL apparaît sans écrire de code ([canvas.md](canvas.md)).
- Les autres providers déclarent leurs modèles dans le même format.

## Coûts

- Prix unitaire (`GET https://api.fal.ai/v1/models/pricing`) et estimation avant lancement
  (`POST https://api.fal.ai/v1/models/pricing/estimate`), affichés sur chaque carte et pour
  chaque lot.
- Plafond de budget ; confirmation dans l'UI avant toute dépense.
- Suivi des dépenses (`GET https://api.fal.ai/v1/models/usage`).

## Exécution

- File de jobs du serveur et API de file d'attente de FAL (`https://queue.fal.run/…` : envoi,
  statut, résultat, annulation).
- Le serveur suit lui-même l'avancement : les webhooks de FAL demanderaient une URL publique,
  qu'une app locale n'a pas.
- Les fichiers d'entrée sont envoyés sur le stockage de FAL ; les résultats sont téléchargés dans
  `media/` et passent par l'ingestion ([ingestion.md](ingestion.md)).

## Provenance

Chaque résultat garde sa recette complète (provider, modèle, prompt, entrées, réglages, seed,
coût) pour être régénéré ou varié ([projet.md](projet.md)).

## Vidéo 100 % IA

Le parcours type, que je mène dans le canvas avec l'aide de Claude quand je le veux :

```
Idée → Script → Bible (personnages, lieux, style) → Plans → Images clés → Vidéos
     → Voix, lip sync, musique, bruitages → Montage → Versions et commentaires
```

- Le script est un texte généré dans le canvas, qui sert d'entrée aux cartes suivantes.
- Les fiches personnages servent de références pour chaque plan, pour garder des visages et des
  tenues cohérents.
- Avant un lot (par exemple 30 plans), Cezane affiche l'estimation totale et attend ma
  confirmation.
- Les plans arrivent dans le montage comme clips liés au canvas : choisir une autre variante ou
  régénérer un plan met le montage à jour ([canvas.md](canvas.md)).
