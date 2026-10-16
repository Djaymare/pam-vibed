# PAM-23 — Navigation et formulaires accessibles

Ticket : https://app.notion.com/p/3f7b3e0422a48138a90adbdae1f022af

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a142c1-eb39-7563-8891-1e0134bab3ae`, génération 24.
Base `39b2f75e0d660c408bf5b6c3731fbe2e01df166f`, branche
`codex/deezer-routing`. Autorisation humaine d'origine relue dans son chat,
relais nominatif, contrat Notion intégral, dépendance PAM-06 terminée et commit
intégré, index et checkout initialement propres, empreintes du dispositif vérifiés.
Vérification par le worker qui a implémenté le ticket.

## Comportement

La navigation expose exactement une `aria-current="page"`. Le premier arrêt Tab
est un lien « Aller au contenu principal ». Le changement de vue et ce lien
placent le focus sur le h1 visible, après le rendu Vue. Ils respectent les
dialogues ouverts et le mécanisme de restitution de PAM-06. Les titres des
sections Assistant et des applications suivent le h1 sans saut de niveau.
L'éditeur de formulation place le focus dans son premier champ et le restitue
à son déclencheur à la fermeture.

La directive partagée `v-field`, dans `src/composables/fieldAccessibility.ts`,
donne un identifiant unique à chaque champ, relie son label, ses aides `small`
et sa propre erreur de validation native. `aria-invalid` est mis à jour après
interaction/validation et redevient faux après correction. Les écouteurs et
le message créé par la directive sont libérés au démontage. Les aides placées
hors label ont des identifiants explicites : préférences, demande écrite,
arguments JSON et transfert de profil. La validation du tableau JSON de textes
utilise aussi la validation native ; un détail replié contenant un champ invalide
est ouvert pour rendre ce champ accessible.

Le bouton Parcourir est hors du label de l'exécutable. Une panne générale de
sauvegarde conserve la saisie et la description du formulaire sans rendre tous
ses champs invalides. Les actions avec icône gardent leurs noms accessibles et
leurs SVG décoratifs restent masqués aux lecteurs d'écran. Aucun rôle ne remplace
la sémantique native des champs et des formulaires.

## Critères et preuves

| Critère Notion | Preuve exécutée |
| --- | --- |
| Avec NVDA et clavier seul, page courante, aides, erreur du bon champ et action suivante identifiables | Parcours WebView2 : lien initial, navigation courante, focus h1, champ description avec aide, JSON invalide puis corrigé, enregistrement et restitution. Trace réelle NVDA et noms accessibles des boutons essentiels. |
| NVDA annonce vue courante, champ, aide et erreur correspondante | Trace `pam23-nvda-speech.jsonl` : « Applications bouton page courante », aide « Cette description aide Needle… », erreur « Les arguments doivent être un tableau JSON de textes… ». Trois assertions NVDA explicites dans `tests/navigation-checks.mjs`. |
| Le changement de vue ne laisse pas le focus sur un élément disparu | Assertions du focus sur h1 après navigation, du maintien dans le sélecteur/dialogue et du retour aux déclencheurs encore présents. |
| Formulaires et actions essentielles utilisables sans lecture visuelle obligatoire | Suite complète clavier WebView2 : ajout, édition, correction, formulations, préférences, transfert, confirmation de suppression et propositions. Contrôles DOM des labels/descriptions/IDs, erreurs required/JSON/pattern, champs Deezer et paramètres de correction créés dynamiquement. |

## Validations

Windows x64 ; Node 24.21.0, npm 11.19.0 ; WebView2 Edge 155,
NVDA 2026.2 portable, configuration française jetable avec synthèse silencieuse.

| Commande / contrôle | Résultat |
| --- | --- |
| `npm test` | 303 réussis, zéro échec/ignoré ; `artifacts/autonomy/pam23-test-verified.log`. |
| `npm run build` | TypeScript/Vite réussis ; `pam23-build-verified.log`. |
| `npm run lint` et `npm run format:check` | Réussis ; `pam23-lint-verified.log`, `pam23-format-check-verified.log`. |
| ESLint et Prettier des cinq composants touchés hors périmètre de la commande standard | Réussis ; `pam23-components-lint-verified.log`, `pam23-components-format-verified.log`. |
| `node scripts/test-modals.mjs`, avec `PAM_NVDA_SPEECH_LOG` | 141 contrôles réussis, dont 28 propres à PAM-23 et les quatre contrôles NVDA de PAM-21 ; `pam23-webview-full.log`. Aucun contrôle antérieur retiré. |
| `git diff --check`, relecture du diff et du contrat | Réussis ; contrat inchangé et dépendance intégrée revérifiés avant commit. |
| Vérification visuelle | Capture de l'éditeur `pam23-editor.png` relue : focus visible, label exécutable séparé, aides et défilement utilisables. |

Les commandes Windows utilisent `artifacts/pam34/windows` : 62 entrées de build
et de lint comparées octet par octet au checkout, même package-lock, reçu
`pam23-build-inputs.json`. Les dépendances Linux préexistantes du checkout sont
préservées ; le build racine les refuse (`pam23-build-root.log`). Les sorties,
codes de retour et SHA-256 sont enregistrés dans `pam23-validation-checks.json`
et le reçu de livraison. Les fichiers `artifacts/` sont des preuves locales,
les fixtures nécessaires sont suivies par Git.

Les premiers essais ont identifié le chargement de la nouvelle directive par
un ancien renderer de tests, le sélecteur du champ désormais muni d'un label
HTML, un hôte recompilé sans manifeste Common Controls et l'absence de premier
plan pour NVDA. Le chargeur/sélecteur des tests a été adapté sans retirer ses
assertions ; l'hôte Windows déjà construit avec manifeste a été utilisé.
Le premier plan de cet hôte jetable a été vérifié puis maintenu pour la suite,
avec accessibilité du renderer activée. Les échecs de capture NVDA n'ont pas
été comptés comme des validations. L'assertion antérieure d'égalité stricte
de `aria-describedby` vérifie désormais la présence simultanée de l'erreur et
de l'aide, puisque cette propriété accepte plusieurs identifiants.

## Reproduction et limites

Construire l'hôte avec `node scripts/build-modal-test-host.mjs` sous Windows,
puis définir `PAM_MODAL_TEST_HOST` vers son exécutable et éventuellement
`PAM_TEST_DEPENDENCY_ROOT` vers les dépendances Windows isolées. La suite complète
se lance avec `node scripts/test-modals.mjs` ; `--navigation-only` isole PAM-23.
Pour NVDA, suivre `tests/fixtures/nvda-status.py` avec une configuration portable
jetable et la même variable `PAM_NVDA_SPEECH_LOG` dans NVDA et la suite. Vérifier
le premier plan avant les interactions ; le journal doit contenir `plugin-ready`.

Le vrai Vue et le vrai moteur WebView2 exposent le DOM et l'arbre d'accessibilité.
Les services Tauri sont simulés, les applications/profils sont des fixtures ;
aucune application personnelle n'est lancée. La preuve NVDA porte sur ses
émissions textuelles réelles, sans prétendre à une écoute humaine de l'audio.
Les profils WebView2 sont nettoyés et les processus NVDA/hôte de test arrêtés.
La copie portable préexistante de NVDA est préservée ; la configuration de test
et les journaux restent locaux hors Git. Aucun changement Rust/IPC, packaging,
microphone matériel, push, publication ou modification du dispositif autonome.

Référence consultée : [accessibilité Vue](https://vuejs.org/guide/best-practices/accessibility.html).

## Fichiers

App, styles et vues Assistant/Applications/Préférences/éditeur/correction ;
composants sélecteur, formulations, paramètres de commande, média et transfert ;
directive partagée ; tests unitaires des arguments, pilote WebView2 et scénarios
de navigation, adaptation du renderer de récupération de profil ; cette preuve.
