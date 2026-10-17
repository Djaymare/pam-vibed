# PAM-28 — Langues proposées et exécutables

Ticket : https://app.notion.com/p/3f7b3e0422a4819d94a8c0fd961c86f7

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a14554-d38e-7e22-af2a-a2d6f7438e64`, génération 30. Base :
`16c72587e1bf625d46a390357c6908b481b8d79d`, branche `codex/deezer-routing`.
PAM-18 est confirmé Terminé ; son commit
`73df40b1fe5857b8237f941d002e58bb33874ea5` est intégré. Contrat et relation
bloquante relus dans Notion ; aucun changement de périmètre.

## Résultat et preuves des critères

1. **Corpus pour chaque langue annoncée et limites connues avant sélection.**
   `tests/fixtures/language-corpus.json` contient les sept langues concrètes,
   avec ouverture, négation, ambiguïté et correction. `sidecar/languages.json`
   est la source partagée des noms français, libellés de portée et messages de
   garde-fou. `SettingsView.vue` affiche les limites avant le champ, dans son
   aide accessible et dans chaque option. `tests/languages.test.mjs` contrôle
   l’ordre des éléments, leur contenu, les options et `aria-describedby`.
   La matrice complète et les limites figurent dans `docs/languages.md`.
2. **Tests des langues exécutables.** Français et anglais sont les seules
   langues de commande annoncées. `sidecar/languages.test.cjs` couvre ouverture,
   négation, alternative ambiguë, correction explicitement choisie puis
   confirmée, refus des citations et collisions d’alias d’application. Le
   modèle simulé propose délibérément une ouverture avec une confiance de 0,99 :
   cela ne contourne pas les refus. `scripts/smoke-languages.mjs` valide le même
   corpus avec Needle Windows réel, dont correction textuelle inférée en FR/EN.
   Les suites existantes de confiance et routage vérifient les autres actions.
3. **Langues réservées à la transcription identifiées et réellement limitées.**
   Allemand, espagnol, italien, néerlandais et polonais portent la mention
   « transcription uniquement ». Le planificateur conserve la transcription
   puis rend un résultat sans appels avant alias ou inférence. Les tests audio
   Whistle simulés vérifient la conservation du texte et de la langue, zéro
   inférence et zéro effet. Le néerlandais « Open Test », identique à une
   commande anglaise, et une formulation mémorisée sont aussi refusés.
   La détection automatique n’autorise les commandes que si Whistle renvoie
   FR/EN ; absence de langue, langue inconnue ou non prise en charge et texte
   seul sont refusés. La locale d’inférence Needle ne redéfinit plus la langue
   transcrite. Une action manuellement choisie dans la correction reste une
   proposition à confirmer, sans exécution automatique.
4. **Protections FR/EN et routages verts.** Les refus existants de négation et
   citation sont conservés et leurs messages centralisés. Les choix « Test ou
   Autre / Test or Autre » et les noms partagés sont refusés pour l’ouverture ;
   les demandes conjointes explicites gardent leur comportement. Les paramètres,
   confirmations, règles de confiance, capacités média, lancement sans shell et
   validation native existants restent en place. Les contrôles ci-dessous passent.

Les aperçus d’import et de restauration affichent aussi le nom français de la
langue. Les codes persistés et le schéma IPC restent inchangés. Les ressources
Tauri et le vérificateur de bundle exigent les deux fichiers de langues ; un
test vérifie ce raccordement. Le ticket ne revendique pas une traduction globale
de l’application : l’interface et les explications restent en français.

## Validation réellement exécutée

Environnement : Windows x64, Node 24.21.0 / npm 11.19.0, moteurs locaux dans
`src-tauri/runtime`. Traces locales sous `artifacts/autonomy/` (ignorées par Git).
Les preuves reproductibles et fixtures sont versionnées, sans dépendance à ces
traces pour les tests.

| Commande | Résultat / trace |
| --- | --- |
| `npm test` | 375/375, zéro échec ou ignoré ; `pam28-npm-test.log`. Inclut 25 tests de politique linguistique et deux tests Vue/catalogue. |
| `node scripts/smoke-languages.mjs` | 30 contrôles sur sept langues ; huit inférences Needle réelles en FR/EN ; aucun lancement personnel ; `pam28-real-languages.log`, `artifacts/language-results.json`. |
| `npm run test:confidence` | 32 cas et quatre contrôles de formulations ; score étudié 0,2346 → 0,7202 ; `pam28-confidence.log`. |
| `npm run test:deezer:routing` | 48 contrôles Needle réel corrects ; `pam28-deezer-routing.log`. |
| `npm run test:media:commands` | 65 contrôles Needle réel corrects ; `pam28-media-commands.log`. |
| `npm run build` dans la copie Windows aux entrées identiques | TypeScript et Vite réussis ; `pam28-build.log`, `pam28-build-inputs.json` : 75 fichiers comparés octet par octet et par SHA-256. |
| ESLint sur composables, vues, aperçu d’import, helper de langues et planificateur | Zéro avertissement ; `pam28-lint.log`. |
| Prettier sur les nouveaux fichiers et les composants/planificateur touchés | Réussi ; `pam28-format.log`. |
| `git diff --check` | Réussi ; `pam28-diff-check.log`. |

Le build racine a refusé les dépendances Linux existantes. Elles sont préservées,
et la compilation Windows utilise les mêmes sources et le même verrou. Les
premiers essais du nouveau corpus utilisaient à tort une méthode IPC `execute` :
ils ont été corrigés vers `confirm`. Les tests Vue ont aussi révélé les imports
JSON manquants du chargeur historique d’import/restauration ; son chargement a
été corrigé, sans retirer d’assertion. Le composant de test des préférences a
reçu sa fixture de diagnostics. La suite finale complète passe. Un lancement
initial du script de copie depuis le mauvais répertoire a échoué avant copie ;
le lancement depuis la racine et la comparaison des 75 entrées ont réussi.
Aucun de ces essais échoués n’est compté comme une validation réussie.

## Fichiers et limites

Catalogue JSON/CJS et helper Vue de langues ; configuration et planificateur
Node ; messages de garde-fou d’ouverture ; préférences et aperçus d’import /
restauration ; configuration ESLint ; ressources Tauri et vérificateur de bundle ;
corpus et tests sidecar/Vue ; chargeur historique de tests ; script d’inférence
réelle et commande npm ; matrice des langues et cette preuve.

Les tests de transcription utilisent des réponses Whistle simulées : aucune
précision acoustique multilingue n’est revendiquée. L’inférence Needle est réelle
dans les quatre scripts Windows ; les lancements et lecteurs sont des effets
simulés. Les tests Vue utilisent un renderer mémoire ; aucun test WebView2,
microphone physique, application personnelle, nouveau paquet portable/NSIS,
signature ou déploiement n’est revendiqué. Les scripts ferment les moteurs et
suppriment leurs profils jetables dans `finally`. Vérification effectuée par le
worker implémenteur. Aucun sous-agent, push ou publication.
