# Mesures de capacité et performance PAM-30

Généré par `node scripts/report-performance.mjs` depuis `docs/evaluation/performance.json`. Les données brutes et empreintes sont versionnées. Protocole et limites : `docs/performance.md`.

Campagne du 2026-10-17T23:53:41.907Z au 2026-10-18T00:01:50.766Z. Windows 10.0.19045, x64, Intel(R) Core(TM) i7-14700KF, 28 processeurs logiques, 63.82 Gio de RAM. Node v24.21.0, npm runtime 11.19.0, Koffi koffi 3.3.2. Needle c7c415a3d1b3d929014bc6e866d51ebb971f7089, Whistle b358ddadd89b7a713b5aa131f23032d3cca1b251. Rust 1.99.0, helper de découverte recompilé en mode debug, cible x86_64-pc-windows-msvc et Cargo.lock conservé.

Six processus isolés, profils synthétiques validés, audio SAPI français local ; seuls les modèles et la découverte Windows sont réels. Effets et sessions média simulés. Trois générations successives par scénario, dix répétitions par génération et parcours. Le pic RSS est échantillonné à 50 ms ; le repos dure une seconde par génération. Aucun résultat ne constitue une garantie de performance ou de stabilité à long terme.

## Démarrage et latences

Toutes les valeurs sont en millisecondes. Chaque cellule est p50 / p95, au rang supérieur. N = 30 par parcours chaud, N = 3 par chargement froid. Le JSON conserve les distributions complètes et les valeurs par génération.

| Apps / profil | Processus prêt | Statut froid | Statut chaud | Découverte synthétique | Texte précis | Audio total | Whistle | Routage audio | Catalogue générique | Effet simulé |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 / plain | 58.41 (N=1) | 135.71 / 225.57 | 27.27 / 72.81 | 0.02 / 0.04 | 293.72 / 300.08 | 422.13 / 428.60 | 88.91 / 93.22 | 313.94 / 317.62 | 358.17 / 365.82 | 2.48 / 2.86 |
| 1 / rich | 64.23 (N=1) | 194.79 / 232.78 | 36.47 / 70.29 | 0.24 / 0.29 | 290.32 / 298.01 | 546.79 / 4214.16 | 89.44 / 93.33 | 434.00 / 4089.99 | 452.41 / 459.18 | 2.51 / 2.76 |
| 8 / plain | 54.44 (N=1) | 197.86 / 230.58 | 37.61 / 70.73 | 0.09 / 0.16 | 294.25 / 301.97 | 458.02 / 1948.39 | 87.99 / 95.35 | 350.87 / 1833.62 | 180.64 / 350.92 | 1.68 / 2.51 |
| 8 / rich | 57.18 (N=1) | 114.55 / 152.16 | 15.12 / 35.13 | 32.78 / 80.26 | 302.74 / 492.01 | 131.02 / 240.94 | 54.17 / 69.26 | 1.44 / 1.66 | 73.13 / 166.67 | 2.07 / 2.79 |
| 32 / plain | 60.87 (N=1) | 143.22 / 163.65 | 36.03 / 50.76 | 0.45 / 0.67 | 155.37 / 162.16 | 303.23 / 3810.90 | 50.68 / 54.55 | 236.77 / 3742.46 | 243.54 / 248.95 | 1.70 / 2.61 |
| 32 / rich | 56.85 (N=1) | 118.36 / 127.30 | 16.78 / 30.13 | 534.55 / 549.01 | 2317.39 / 2377.99 | 1159.08 / 1194.12 | 70.55 / 76.31 | 2.26 / 2.94 | 1088.08 / 1102.45 | 2.33 / 6.68 |

Ces durées incluent les refus et ne sont pas des latences de réussite uniquement. Une transcription synthétique qui ne désigne pas exactement la cible peut conserver tout le catalogue puis être refusée. Les résultats suivants empêchent de présenter ce refus rapide comme une amélioration de compréhension.

| Apps / profil | Texte : propositions / refus | Audio : propositions / refus | Générique : propositions / refus | Refus explicites de capacité (texte / audio / générique) |
| --- | ---: | ---: | ---: | --- |
| 1 / plain | 30 / 0 | 30 / 0 | 30 / 0 | 0 / 0 / 0 |
| 1 / rich | 30 / 0 | 30 / 0 | 30 / 0 | 0 / 0 / 0 |
| 8 / plain | 30 / 0 | 30 / 0 | 30 / 0 | 0 / 0 / 0 |
| 8 / rich | 30 / 0 | 0 / 30 | 0 / 30 | 0 / 30 / 30 |
| 32 / plain | 30 / 0 | 30 / 0 | 30 / 0 | 0 / 0 / 0 |
| 32 / rich | 30 / 0 | 0 / 30 | 0 / 30 | 0 / 30 / 30 |

La découverte Windows en helper neuf : N=10, p50 2942.43 ms, p95 3056.35 ms, maximum 3056.35 ms. Les nombres d’entrées restent dans le JSON ; aucun nom d’application n’est conservé.

## Mémoire et repos après reprises

RSS en Mio pour les générations 1 → 2 → 3. Les colonnes exposent les valeurs successives plutôt que masquer une croissance par une moyenne. CPU de repos en pourcentage d’un seul cœur.

| Apps / profil | RSS après chargement | RSS après requêtes | RSS après fermeture | Pic RSS | CPU repos p50 / p95 |
| --- | --- | --- | --- | ---: | ---: |
| 1 / plain | 181.25 → 189.87 → 194.60 | 212.80 → 219.31 → 220.43 | 154.73 → 161.05 → 162.02 | 220.94 | 0.00 / 1.58 |
| 1 / rich | 181.02 → 193.14 → 188.95 | 225.26 → 222.86 → 225.67 | 169.14 → 164.30 → 169.35 | 229.61 | 0.00 / 0.00 |
| 8 / plain | 180.94 → 192.87 → 193.84 | 221.69 → 220.35 → 225.36 | 165.73 → 161.52 → 166.56 | 226.50 | 0.00 / 0.00 |
| 8 / rich | 181.59 → 224.88 → 265.11 | 334.18 → 376.05 → 336.20 | 276.09 → 319.73 → 277.29 | 376.05 | 0.00 / 0.00 |
| 32 / plain | 181.52 → 197.67 → 199.06 | 237.77 → 243.77 → 242.85 | 181.68 → 184.64 → 186.63 | 246.58 | 0.00 / 0.00 |
| 32 / rich | 182.12 → 337.63 → 360.57 | 362.95 → 386.47 → 382.42 | 304.38 → 330.33 → 322.87 | 386.47 | 0.00 / 7.77 |

La plus forte hausse entre la première et la troisième fermeture est de 18.50 Mio pour 32 / rich. Cette croissance observée interdit de conclure à un plateau mémoire. Caches et allocateur ne rendent pas nécessairement immédiatement toute mémoire à Windows ; cette campagne ne distingue pas leur rétention d’une fuite native. Trois générations ne permettent pas de déclarer une absence de fuite ; aucune borne universelle ni plateau à long terme n’est garanti. Le heap JS et les allocations external sont aussi conservés dans les mesures brutes. Le pourcentage CPU inclut l’observateur RSS, pas WebView2, Rust ou la machine entière.

## Capacité réelle

Le préfixe natif inclut système et outils. Les octets outils indiquent la taille sérialisée, sans les présenter comme des tokens. La demande de contrôle représente 16 octets UTF-8 ; le rapport donne sa valeur exacte. Réserves : 256 + 32 tokens. Les budgets sont mesurés à chaque génération ; la table montre la première.

| Apps / profil | Sélection | Outils | Octets outils | Tokens préfixe | Octets demande | Budget contexte compatible | Plafond produit compatible | Refus catalogue observés |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | ---: |
| 1 / plain | all | 1 | 761 | 164 | 16 | oui | oui | 0 |
| 1 / plain | explicit | 1 | 761 | 164 | 16 | oui | oui | — |
| 1 / rich | all | 7 | 8503 | 1079 | 16 | oui | oui | 0 |
| 1 / rich | explicit | 1 | 2207 | 315 | 16 | oui | oui | — |
| 8 / plain | all | 8 | 6088 | 514 | 16 | oui | oui | 0 |
| 8 / plain | explicit | 1 | 761 | 164 | 16 | oui | oui | — |
| 8 / rich | all | 56 | 67982 | 7832 | 16 | oui | non | 30 |
| 8 / rich | explicit | 1 | 2207 | 315 | 16 | oui | oui | — |
| 32 / plain | all | 32 | 24467 | 1747 | 16 | oui | oui | 0 |
| 32 / plain | explicit | 1 | 761 | 164 | 16 | oui | oui | — |
| 32 / rich | all | 224 | 275751 | catalog_capacity | — | non mesuré | non | 30 |
| 32 / rich | explicit | 1 | 2207 | 315 | 16 | oui | oui | — |

Le produit conserve 32 applications enregistrées et au plus 32 outils proposés par demande. Une demande précise conserve la sélection sûre existante d’un seul outil. Un catalogue dépassant le plafond est refusé avant initialisation native ; un catalogue sous ce plafond reste soumis au budget de tokens. Aucun catalogue n’est tronqué et aucune action n’est choisie arbitrairement pour faire tenir la requête.

## Échecs exploratoires et portée

Une première campagne avant le plafond préventif a terminé les profils 1 simple, 1 enrichi et 8 simple, puis le processus du profil 8 enrichi (56 outils disponibles) a atteint le délai moteur de 40 secondes, code de sortie 70. Cette exécution concurrente avec d’autres validations ne sert pas aux quantiles finaux ; elle établit un risque observé de délai, sans prouver que tous les catalogues de cette taille échouent. Le plafond de 32 outils est une limite produit prudente, pas un optimum statistique ou une promesse de délai. Les mesures finales ci-dessus utilisent seules les sources livrées.

Le helper de découverte avait initialement une ancienne compilation ; la campagne finale utilise la compilation actuelle, dont le SHA-256 figure dans le JSON. Un premier lancement SAPI par Windows PowerShell a été refusé par sa politique de scripts ; l’appel de synthèse local explicite a ensuite réussi sans modifier cette politique. Une fixture comportait des alias tronqués identiques à deux chiffres : elle a été corrigée et validée avant la campagne finale.

PAM-39 peut examiner séparément les coûts de découverte ou de transport audio à partir de ces durées. Cette campagne ne démontre pas à elle seule qu’une optimisation soit nécessaire à un objectif produit : aucun objectif chiffré n’a été approuvé. Elle ne mesure ni microphone réel, ni démarrage système sans cache, ni consommation énergétique, ni lecteur personnel, ni paquet NSIS.
