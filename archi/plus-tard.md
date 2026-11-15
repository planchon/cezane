# Plus tard

## Capture d'apps

But : que Cezane prenne les bonnes captures et vidéos de démo de mes apps (SaaS dans Chrome,
apps iOS dans le simulateur), en interagissant avec le code local.

- Pas de réécriture de l'automatisation : Claude utilise des MCP existants (Chrome DevTools ou
  Playwright pour le web, un MCP simulateur + `simctl` pour iOS) et son accès au code local.
- Cezane ajoute l'enregistrement (screencast Chrome, `simctl io recordVideo`) et un « studio
  screenshot » fait de compositions Remotion : cadre d'appareil, fond, mise en avant d'une zone
  (assombrir le reste), zoom.
- Les captures entrent dans le projet comme des assets avec une provenance « capture »
  ([projet.md](projet.md)).

## Publication

But : publier et planifier sur Instagram, TikTok et YouTube.

Contraintes connues, à traiter le moment venu :

- YouTube sait planifier nativement.
- Instagram exige un compte Business ou Creator et une URL publique pour la vidéo, donc un
  hébergement temporaire.
- TikTok limite la publication publique aux apps auditées.
- Instagram et TikTok n'ont pas de planification par API : un process doit tourner à l'heure de
  publication (ma machine allumée, ou un petit service en ligne).
