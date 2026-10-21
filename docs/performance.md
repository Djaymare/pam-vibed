# Capacité et protocole de mesure de PAM

PAM accepte jusqu’à 32 applications enregistrées. Ce plafond de profil ne
garantit pas que tous leurs outils tiennent simultanément dans le modèle.
Une demande propose au plus 32 outils. Ce plafond préventif est distinct du
contexte : le catalogue de 56 outils d’un profil de huit lecteurs enrichis a
atteint le délai de 40 secondes dans la campagne exploratoire. Il est refusé
avant l’initialisation native en production ; les demandes précises conservent
leur seul outil. Le plafond n’est pas une garantie de latence pour 32 outils.
Needle 3 utilise un contexte de 8 192 tokens. Chaque lecteur peut ajouter six
commandes média, et Deezer ses propres outils. Les descriptions et alias font
aussi partie du catalogue. Une demande précise peut donc tenir alors qu’une
demande nécessitant le catalogue entier dépasse le contexte.

Le routage existant conserve un seul outil lorsqu’une commande identifie une
application et une action sans ambiguïté. Les demandes composées ou ambiguës
conservent leurs outils ; aucune troncature arbitraire, recherche approximative
ou sélection par le score du modèle n’est ajoutée. La validation des cibles,
arguments, capacités actuelles, cardinalité et confirmations reste appliquée.

## Budget du contexte

Après `needle_reset`, `needle_init` renvoie le nombre réel de tokens du préfixe
complet, système et outils inclus. PAM lui ajoute le nombre d’octets UTF-8 de
la demande, borne conservatrice de ses tokens, 256 tokens pour la réponse et
32 pour le cadrage. Le total doit être inférieur ou égal à 8 192. Cette borne
peut refuser une demande que le tokenizer aurait comprimée davantage ; elle
ne promet pas une longueur fixe en caractères.

Au-delà de 32 outils proposés, PAM explique la limite par demande et invite à
préciser une application et une action ou désactiver des applications.
Si le préfixe et les réserves occupent tout le contexte, PAM explique que le
catalogue est trop volumineux : nommer précisément une application et une
action, désactiver des applications ou raccourcir descriptions et alias.
Si la demande fait dépasser le budget restant, le message cite les outils
sélectionnés et propose aussi une demande plus courte. Aucun effet n’est
émis ; la demande revient sans proposition exécutable. Ce refus de capacité
n’est pas présenté comme une panne qui nécessiterait de recharger le moteur.

## Reproduire le benchmark

Utiliser un environnement Windows x64 isolé conforme à `docs/development.md`,
avec les dépendances de cet OS, Node/npm et Rust fixés par le dépôt. Préparer
les modèles avec `npm run prepare:runtime`. Compiler le helper de découverte
depuis ces sources :

```powershell
cargo build --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --example discovery
$env:PAM_BENCH_DISCOVERY = (Resolve-Path src-tauri/target/x86_64-pc-windows-msvc/debug/examples/discovery.exe).Path
npm run bench:performance -- artifacts/performance.json
```

Le helper par défaut se trouve dans la copie Windows utilisée pour les
validations locales, sous `artifacts/pam34/windows/`. La variable ci-dessus
permet d’utiliser un checkout neuf sans cette copie. Le benchmark échoue si
le helper, les modèles, Koffi ou la voix Windows requise sont absents. Il ne
remplace pas un moteur réel par un mock.

La voix locale `Microsoft Hortense Desktop` produit « Ouvre Bloc-notes » en
PCM mono 16 kHz. Aucun microphone ni audio personnel n’est utilisé. Les profils
temporaires décrivent 1, 8 et 32 applications, avec deux variantes : lancement
simple et lecteurs synthétiques ayant six capacités, six alias et une longue
description. Leur configuration est validée par le schéma de production.
Les sessions média et effets sont simulés ; aucun lecteur personnel n’est
commandé. Les fichiers temporaires sont supprimés après chaque scénario.

Chaque scénario démarre dans un processus Node distinct, conserve ses trois
générations successives de worker et mesure dix répétitions par génération
pour le statut chaud, la demande texte précise, l’audio, la demande générique
avec catalogue complet et l’effet confirmé simulé. Cela donne 30 observations
par parcours chaud et trois chargements par scénario. `PAM_BENCH_CYCLES` (3–10)
et `PAM_BENCH_REPETITIONS` (5–100) permettent d’allonger la campagne.

Le processus parent mesure son démarrage, puis dix découvertes réelles Windows
(nouveau helper à chaque scan). Seuls les durées et nombres d’entrées sont
conservés. La découverte du catalogue synthétique et des sessions simulées est
mesurée séparément dans les demandes.

L’observateur optionnel `onPerformance` de l’assistant reçoit exclusivement
`stage`, `durationMs`, `success` pour découverte, warmup, transcription,
routage et effet. Ses exceptions ne modifient pas les opérations. Il n’écrit
aucun journal en production et ne reçoit ni phrase, ni chemin, ni application,
ni argument, ni audio ou réponse du modèle. Le benchmark ajoute uniquement des
compteurs et identifiants de scénarios synthétiques.

Le rapport JSON conserve toutes les durées, les p50/p95 au rang supérieur,
minimums et maximums, les budgets natifs, le RSS/heap/external avant/après
chargement et requêtes, et après fermeture de chaque worker. Un échantillonnage
RSS à 50 ms estime le pic, sans garantir de capturer un pic plus court. Une
seconde au repos par génération mesure le CPU du processus, en pourcentage
d’un seul cœur, avec cet échantillonneur encore actif. Ce n’est pas une mesure
énergétique de l’ordinateur ni une mesure du processus WebView2/Rust.

## Limites d’interprétation

« Froid » signifie nouveau processus ou nouveau worker avec rechargement des
poids. Le cache disque de Windows n’est pas vidé : aucun démarrage après
redémarrage de la machine n’est revendiqué. Les trois générations montrent les
valeurs de mémoire successives ; elles ne garantissent ni une absence de fuite
à long terme, ni une borne mémoire universelle. Les p95 de trois chargements
sont leur maximum observé. Les latences dépendent de la machine et de sa charge.

Les temps d’effets concernent l’émission simulée et la journalisation PAM ;
ils ne prouvent pas l’ouverture ou la lecture effective d’une application.
L’audio synthétique et les phrases répétées ne constituent pas une mesure de
qualité vocale ou de compréhension ; le corpus distinct de PAM-29 reste la
preuve de cette évaluation. Aucun objectif chiffré n’est promis par ce ticket.
Les optimisations audio/découverte éventuelles relèvent de PAM-39, à décider
sur un besoin mesuré. Les résultats de cette campagne sont dans
`docs/performance-results.md` et `docs/evaluation/performance.json`.

La comparaison PAM-39 de la découverte Windows, ses fixtures verrouillées et
ses limites sont décrites dans `docs/discovery-performance.md`. Ses résultats
avant/après sont distincts de la campagne de référence ci-dessus.
