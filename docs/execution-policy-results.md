# Mesures PAM-29 — résultats du corpus figé

Généré par `node scripts/report-execution.mjs` depuis les trois rapports JSON versionnés.
Les erreurs et refus sont conservés ; aucune proposition incorrecte n’est effacée.

## Totaux

| Groupe | N | Positifs | Négatifs | Auto | Faux déclenchements | Auto erronés | Confirmations | Propositions erronées | Refus | Refus positifs | Plans exacts | Erreurs de validation | Erreurs de mots / mots de référence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| calibration-baseline | 90 | 39 | 51 | 5 | 0 | 0 | 25 | 20 | 60 | 22 | 48 | 3 | 158 / 348 |
| calibration-policy | 90 | 39 | 51 | 0 | 0 | 0 | 30 | 20 | 60 | 22 | 48 | 3 | 158 / 348 |
| heldout-policy | 90 | 39 | 51 | 0 | 0 | 0 | 25 | 19 | 65 | 27 | 44 | 0 | 118 / 362 |

## calibration-baseline

### Modalité

| Groupe | N | Positifs | Négatifs | Auto | Faux déclenchements | Auto erronés | Confirmations | Propositions erronées | Refus | Refus positifs | Plans exacts | Erreurs de validation | Erreurs de mots / mots de référence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| text | 30 | 13 | 17 | 4 | 0 | 0 | 8 | 5 | 18 | 5 | 20 | 1 | 0 / 0 |
| clean | 30 | 13 | 17 | 1 | 0 | 0 | 11 | 10 | 18 | 7 | 13 | 1 | 60 / 174 |
| noise | 30 | 13 | 17 | 0 | 0 | 0 | 6 | 5 | 24 | 10 | 15 | 1 | 98 / 174 |

### Catégorie

| Groupe | N | Positifs | Négatifs | Auto | Faux déclenchements | Auto erronés | Confirmations | Propositions erronées | Refus | Refus positifs | Plans exacts | Erreurs de validation | Erreurs de mots / mots de référence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| open | 15 | 15 | 0 | 0 | 0 | 0 | 6 | 4 | 9 | 9 | 2 | 2 | 20 / 50 |
| media | 6 | 6 | 0 | 0 | 0 | 0 | 1 | 1 | 5 | 5 | 0 | 0 | 8 / 26 |
| sensitive | 9 | 9 | 0 | 3 | 0 | 0 | 3 | 0 | 3 | 3 | 6 | 1 | 10 / 34 |
| free-input | 9 | 9 | 0 | 2 | 0 | 0 | 2 | 2 | 5 | 5 | 2 | 0 | 41 / 44 |
| negation | 9 | 0 | 9 | 0 | 0 | 0 | 3 | 3 | 6 | 0 | 6 | 0 | 14 / 36 |
| ambiguity | 9 | 0 | 9 | 0 | 0 | 0 | 2 | 2 | 7 | 0 | 7 | 0 | 9 / 34 |
| negative | 9 | 0 | 9 | 0 | 0 | 0 | 5 | 5 | 4 | 0 | 4 | 0 | 5 / 44 |
| quotation | 6 | 0 | 6 | 0 | 0 | 0 | 1 | 1 | 5 | 0 | 5 | 0 | 9 / 32 |
| unknown-name | 3 | 0 | 3 | 0 | 0 | 0 | 2 | 2 | 1 | 0 | 1 | 0 | 3 / 8 |
| transcription-only | 15 | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 15 | 0 | 39 / 40 |

### Langue configurée

| Groupe | N | Positifs | Négatifs | Auto | Faux déclenchements | Auto erronés | Confirmations | Propositions erronées | Refus | Refus positifs | Plans exacts | Erreurs de validation | Erreurs de mots / mots de référence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| fr | 54 | 30 | 24 | 5 | 0 | 0 | 13 | 9 | 36 | 17 | 28 | 3 | 101 / 228 |
| en | 21 | 9 | 12 | 0 | 0 | 0 | 12 | 11 | 9 | 5 | 5 | 0 | 18 / 80 |
| de | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 3 | 0 | 8 / 8 |
| es | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 3 | 0 | 2 / 8 |
| it | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 3 | 0 | 11 / 10 |
| nl | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 3 | 0 | 11 / 6 |
| pl | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 3 | 0 | 7 / 8 |

### Seuil seul, politique initiale simulée sur les réponses natives

| Seuil | Auto | Faux déclenchements | Auto erronés | Confirmations |
| ---: | ---: | ---: | ---: | ---: |
| 0.1 | 25 | 11 | 5 | 5 |
| 0.3 | 6 | 0 | 0 | 24 |
| 0.5 | 6 | 0 | 0 | 24 |
| 0.7 | 5 | 0 | 0 | 25 |
| 0.8 | 3 | 0 | 0 | 27 |
| 0.9 | 0 | 0 | 0 | 30 |
| 1 | 0 | 0 | 0 | 30 |

## calibration-policy

### Modalité

| Groupe | N | Positifs | Négatifs | Auto | Faux déclenchements | Auto erronés | Confirmations | Propositions erronées | Refus | Refus positifs | Plans exacts | Erreurs de validation | Erreurs de mots / mots de référence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| text | 30 | 13 | 17 | 0 | 0 | 0 | 12 | 5 | 18 | 5 | 20 | 1 | 0 / 0 |
| clean | 30 | 13 | 17 | 0 | 0 | 0 | 12 | 10 | 18 | 7 | 13 | 1 | 60 / 174 |
| noise | 30 | 13 | 17 | 0 | 0 | 0 | 6 | 5 | 24 | 10 | 15 | 1 | 98 / 174 |

### Catégorie

| Groupe | N | Positifs | Négatifs | Auto | Faux déclenchements | Auto erronés | Confirmations | Propositions erronées | Refus | Refus positifs | Plans exacts | Erreurs de validation | Erreurs de mots / mots de référence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| open | 15 | 15 | 0 | 0 | 0 | 0 | 6 | 4 | 9 | 9 | 2 | 2 | 20 / 50 |
| media | 6 | 6 | 0 | 0 | 0 | 0 | 1 | 1 | 5 | 5 | 0 | 0 | 8 / 26 |
| sensitive | 9 | 9 | 0 | 0 | 0 | 0 | 6 | 0 | 3 | 3 | 6 | 1 | 10 / 34 |
| free-input | 9 | 9 | 0 | 0 | 0 | 0 | 4 | 2 | 5 | 5 | 2 | 0 | 41 / 44 |
| negation | 9 | 0 | 9 | 0 | 0 | 0 | 3 | 3 | 6 | 0 | 6 | 0 | 14 / 36 |
| ambiguity | 9 | 0 | 9 | 0 | 0 | 0 | 2 | 2 | 7 | 0 | 7 | 0 | 9 / 34 |
| negative | 9 | 0 | 9 | 0 | 0 | 0 | 5 | 5 | 4 | 0 | 4 | 0 | 5 / 44 |
| quotation | 6 | 0 | 6 | 0 | 0 | 0 | 1 | 1 | 5 | 0 | 5 | 0 | 9 / 32 |
| unknown-name | 3 | 0 | 3 | 0 | 0 | 0 | 2 | 2 | 1 | 0 | 1 | 0 | 3 / 8 |
| transcription-only | 15 | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 15 | 0 | 39 / 40 |

### Langue configurée

| Groupe | N | Positifs | Négatifs | Auto | Faux déclenchements | Auto erronés | Confirmations | Propositions erronées | Refus | Refus positifs | Plans exacts | Erreurs de validation | Erreurs de mots / mots de référence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| fr | 54 | 30 | 24 | 0 | 0 | 0 | 18 | 9 | 36 | 17 | 28 | 3 | 101 / 228 |
| en | 21 | 9 | 12 | 0 | 0 | 0 | 12 | 11 | 9 | 5 | 5 | 0 | 18 / 80 |
| de | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 3 | 0 | 8 / 8 |
| es | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 3 | 0 | 2 / 8 |
| it | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 3 | 0 | 11 / 10 |
| nl | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 3 | 0 | 11 / 6 |
| pl | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 3 | 0 | 7 / 8 |

### Seuil seul, politique initiale simulée sur les réponses natives

| Seuil | Auto | Faux déclenchements | Auto erronés | Confirmations |
| ---: | ---: | ---: | ---: | ---: |
| 0.1 | 25 | 11 | 5 | 5 |
| 0.3 | 6 | 0 | 0 | 24 |
| 0.5 | 6 | 0 | 0 | 24 |
| 0.7 | 5 | 0 | 0 | 25 |
| 0.8 | 3 | 0 | 0 | 27 |
| 0.9 | 0 | 0 | 0 | 30 |
| 1 | 0 | 0 | 0 | 30 |

## heldout-policy

### Modalité

| Groupe | N | Positifs | Négatifs | Auto | Faux déclenchements | Auto erronés | Confirmations | Propositions erronées | Refus | Refus positifs | Plans exacts | Erreurs de validation | Erreurs de mots / mots de référence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| text | 30 | 13 | 17 | 0 | 0 | 0 | 9 | 5 | 21 | 8 | 17 | 0 | 0 / 0 |
| clean | 30 | 13 | 17 | 0 | 0 | 0 | 8 | 6 | 22 | 10 | 14 | 0 | 41 / 181 |
| noise | 30 | 13 | 17 | 0 | 0 | 0 | 8 | 8 | 22 | 9 | 13 | 0 | 77 / 181 |

### Catégorie

| Groupe | N | Positifs | Négatifs | Auto | Faux déclenchements | Auto erronés | Confirmations | Propositions erronées | Refus | Refus positifs | Plans exacts | Erreurs de validation | Erreurs de mots / mots de référence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| open | 15 | 15 | 0 | 0 | 0 | 0 | 3 | 1 | 12 | 12 | 2 | 0 | 4 / 50 |
| media | 6 | 6 | 0 | 0 | 0 | 0 | 1 | 1 | 5 | 5 | 0 | 0 | 10 / 26 |
| sensitive | 9 | 9 | 0 | 0 | 0 | 0 | 3 | 1 | 6 | 6 | 2 | 0 | 7 / 32 |
| free-input | 9 | 9 | 0 | 0 | 0 | 0 | 5 | 3 | 4 | 4 | 2 | 0 | 31 / 48 |
| negation | 9 | 0 | 9 | 0 | 0 | 0 | 0 | 0 | 9 | 0 | 9 | 0 | 2 / 44 |
| ambiguity | 9 | 0 | 9 | 0 | 0 | 0 | 5 | 5 | 4 | 0 | 4 | 0 | 10 / 34 |
| negative | 9 | 0 | 9 | 0 | 0 | 0 | 5 | 5 | 4 | 0 | 4 | 0 | 4 / 40 |
| quotation | 6 | 0 | 6 | 0 | 0 | 0 | 1 | 1 | 5 | 0 | 5 | 0 | 5 / 26 |
| unknown-name | 3 | 0 | 3 | 0 | 0 | 0 | 2 | 2 | 1 | 0 | 1 | 0 | 4 / 8 |
| transcription-only | 15 | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 15 | 0 | 41 / 54 |

### Langue configurée

| Groupe | N | Positifs | Négatifs | Auto | Faux déclenchements | Auto erronés | Confirmations | Propositions erronées | Refus | Refus positifs | Plans exacts | Erreurs de validation | Erreurs de mots / mots de référence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| fr | 48 | 24 | 24 | 0 | 0 | 0 | 17 | 13 | 31 | 15 | 20 | 0 | 71 / 210 |
| en | 27 | 15 | 12 | 0 | 0 | 0 | 8 | 6 | 19 | 12 | 9 | 0 | 6 / 98 |
| de | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 3 | 0 | 8 / 12 |
| es | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 3 | 0 | 9 / 10 |
| it | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 3 | 0 | 6 / 10 |
| nl | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 3 | 0 | 6 / 10 |
| pl | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 3 | 0 | 12 / 12 |

### Seuil seul, politique initiale simulée sur les réponses natives

| Seuil | Auto | Faux déclenchements | Auto erronés | Confirmations |
| ---: | ---: | ---: | ---: | ---: |
| 0.1 | 20 | 12 | 2 | 5 |
| 0.3 | 5 | 2 | 0 | 20 |
| 0.5 | 1 | 0 | 0 | 24 |
| 0.7 | 1 | 0 | 0 | 24 |
| 0.8 | 0 | 0 | 0 | 25 |
| 0.9 | 0 | 0 | 0 | 25 |
| 1 | 0 | 0 | 0 | 25 |
