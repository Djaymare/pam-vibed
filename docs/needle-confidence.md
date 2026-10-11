# Confiance Needle et commandes françaises

PAM conserve la demande et la transcription françaises. Lorsqu’une commande simple désigne exactement une action et une application configurées, il transmet une formulation interne anglaise à Needle : « Play sur le navigateur » devient `Play audio in Opera GX`. Les demandes composées et les valeurs à transmettre restent dans leur forme originale. Aucune traduction générale ni aucun service distant n’est ajouté.

Les noms transmis au modèle sont courts (`play_opera_gx`, `pause_opera_gx`, `open_deezer`). Le sidecar les résout vers les identifiants internes existants, sans modifier le catalogue, les libellés français ou les confirmations enregistrées. Les collisions entre noms d’applications reçoivent un suffixe stable. Les métadonnées internes restent exclues du modèle.

Les descriptions de lancement et de contrôle multimédia sont en anglais. Les schémas des protocoles Deezer restent ceux précédemment vérifiés : leur remplacement général a régressé sur la copie d’un identifiant numérique pendant l’intégration réelle. Les limites de lecture d’une chanson précise et d’insertion en prochaine position restent documentées dans [windows-media-deezer.md](windows-media-deezer.md).

## Résultats mesurés

Essais du 11 octobre 2026 avec la DLL et le modèle Needle épinglés dans `src-tauri/runtime/manifest.json`, le profil isolé de `scripts/smoke-confidence.mjs` et le seuil de test de 65 % :

| Demande originale | Score brut Needle | Action correcte |
| --- | ---: | --- |
| Play sur le navigateur, ancienne formulation interne | 23,46 % | Reprendre la lecture Opera GX |
| Play sur le navigateur, nouvelle formulation interne | 72,02 % | Reprendre la lecture Opera GX |
| Pause le navigateur | 78,54 % | Mettre Opera GX en pause |
| Piste suivante le navigateur | 79,59 % | Passer à la piste suivante Opera GX |
| Piste précédente le navigateur | 82,17 % | Passer à la piste précédente Opera GX |
| Play Diseur | 73,22 % | Reprendre Deezer |
| Pause Diseur | 78,77 % | Mettre Deezer en pause |
| Piste précédente Deezer | 62,47 % | Bonne action, confirmation maintenue |

Le score affiché provient directement de Needle. PAM ne le majore pas et ne change pas les préférences personnelles. La bonne action peut encore recevoir un score inférieur au seuil ; la confirmation reste alors nécessaire. Ces résultats concernent les formulations et les outils testés, pas l’ensemble des demandes en français.

## Contrôle de la demande originale

Avant toute exécution ou proposition à confirmer, PAM vérifie aussi la demande française originale :

- Les négations simples au début de la demande ou d’une proposition après `et`, `puis`, `mais`, `and`, `then` ou `but` empêchent l’exécution du plan. Une demande composée contenant une négation doit être reformulée en commandes séparées.
- Les commandes citées seules ou rapportées par les préfixes reconnus, comme « Elle a dit », ne sont pas exécutées.
- Si une application est nommée, une proposition pour une autre application est rejetée. Le choix manuel explicite d’une application lors d’une correction conserve sa priorité et sa validation obligatoire.
- Un ordre multimédia simple pour un lecteur inconnu, ambigu ou sans capacité disponible ne devient pas un lancement d’application.
- Les citations et les entrées explicitement transmises à un éditeur restent des données. Une demande composée positive conserve ses actions.

Ces contrôles reconnaissent les constructions décrites et testées ; ils ne constituent pas une analyse générale de toutes les négations françaises. La validation existante du plan, des arguments, des capacités Windows et des confirmations reste active.

## Reproduire

```powershell
npm test
npm run test:confidence
npm run test:integration
npm run test:media
# Vérifier les mêmes commandes avec le sidecar et le runtime du portable :
node scripts/smoke-confidence.mjs artifacts/PAM-windows-needle-confidence
```

`test:confidence` exécute Needle sur 32 cas fixes : 16 commandes positives et 16 refus attendus, comprenant négations françaises/anglaises, citations, applications inconnues/désactivées et commandes composées. Les sessions et les exécutions sont simulées ; aucun lecteur personnel n’est contrôlé. Le profil temporaire est supprimé. Le rapport est écrit dans `artifacts/needle-confidence-results.json`, ignoré par Git.

Les tests unitaires vérifient également les propositions erronées à 99–100 % de confiance, les collisions, les capacités absentes, la résolution des noms publics, les confirmations et la parité texte/vocal.

Références officielles : [conception des outils Needle](https://www.cactuscompute.com/blog/designing-tools-for-needle), [signification et limites du score](https://www.cactuscompute.com/blog/needle-confidence).
