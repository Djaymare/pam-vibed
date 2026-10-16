# PAM-24 — Blocage des validations matérielles du microphone

Ticket : https://app.notion.com/p/3f7b3e0422a481488e31ed30f9b15d66

Outcome : `blocked`, précontrôle du 16 octobre 2026. Aucune livraison fonctionnelle.
Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a1440a-556d-7ce0-b99b-ee93872d458b`, génération 25.
Base : `ef68f0dbc72b3c53a5f50d8cd7c406ce9cb478b6`, branche
`codex/deezer-routing`.

## Contrat et précontrôles

L'autorisation humaine d'origine a été relue dans le chat
`01a1302e-073c-7c53-9a09-84a51b1ab6af`, tour
`01a1302e-bbe7-7a12-b52c-e190cbd18e4d`, message
`01a1302e-be0e-7f21-b801-56d9d7a578e7`. Relais nominatif
`23ce6f14-a16f-4e9b-bd7a-60496bba10cd` acquis, verrou court libéré,
branche et HEAD attendus, index et checkout propres avant ce rapport ; empreintes
des fichiers de contrôle vérifiées sans modification.

Fiche PAM-24 et prérequis PAM-17 relus intégralement dans Notion.
PAM-17 est `Terminé` ; son commit
`13d319207d5002053a7f85693d41b75859d65337` et sa preuve
`docs/tickets/PAM-17.md` sont intégrés. Cette preuve distingue explicitement les
permissions micro simulées des tests clavier réels WebView2. Elle ne satisfait
donc pas les essais matériels demandés par PAM-24.

Sous Windows, la commande en lecture seule
`Get-PnpDevice -Class AudioEndpoint -PresentOnly` détecte notamment
`Microphone (fifine Microphone)`, statut `OK`. Le résultat sans identifiants
matériels est conservé localement dans
`artifacts/autonomy/pam24-audio-endpoints.json`. Cela établit la présence d'un
périphérique ; cela ne démontre ni une capture WebView2, ni un débranchement.

## Blocage et condition de reprise

La fiche impose des essais manuels réels WebView2 : périphérique retiré, refus,
permission tardive, veille et masquage. Une intervention sur place est nécessaire
pour débrancher/rebrancher le microphone et orchestrer la veille/reprise réelle.
La disponibilité de cette intervention n'a pas été confirmée pendant le
précontrôle. La question est restée sans réponse à ce stade ; aucun refus humain
n'est déduit de ce silence.

La compétence Windows Computer Use consultée renvoie à `docs/guidance.md`, dont
la règle est : « Do not act on security or privacy permission requests. » Les
éventuelles réponses réelles aux permissions doivent être effectuées par une
personne. Aucun réglage de confidentialité, périphérique personnel ou état de
veille du poste n'a été modifié pour fabriquer un résultat. Des événements JS,
pistes simulées ou permissions préaccordées par un hôte de test ne prouvent pas
les scénarios matériels et manuels exigés.

Reprise possible avec un opérateur disponible et un hôte WebView2 utilisant un
profil jetable, après nouvelle attribution du relais selon le protocole. Le
nouveau worker devra implémenter l'ensemble du contrat, ajouter les régressions,
exécuter les scénarios manuels avec traces réelles et vérifier le masquage avant
tout changement du protocole natif. Il devra conserver la borne de 30 secondes
et les validations WAV. Aucune preuve antérieure n'autorise une clôture anticipée.

## État des critères et validations

| Critère | Résultat de cette tentative |
| --- | --- |
| Arrêt dans tous les chemins, récupération expliquée et vraie WebView2 | Non satisfait ; implémentation et scénarios natifs non exécutés. |
| Aucune piste après masquer, annuler, fermer ou refuser | Non vérifié dans la vraie WebView2. |
| Permission tardive sans reprise de capture | Non vérifié dans la vraie WebView2 ; les mocks de PAM-17 ne suffisent pas. |
| Débranchement/reprise avec récupération sans rechargement du profil | Non exécuté ; intervention matérielle requise. |

Contrôles réellement effectués : identité et génération, autorisation, contrat et
prérequis Notion, empreintes, branche/HEAD/index, ancêtre Git PAM-17 et inventaire
AudioEndpoint. `git diff --check` est exécuté pour ce rapport avant commit.

Aucun test de capture, aucune suite de promesses/pistes PAM-24, aucun test manuel
micro WebView2 et aucun build de cette tentative ne sont déclarés réussis.
L'application et ses tests restent inchangés ; seul ce rapport est versionné.
Aucun processus de test, profil ou fichier audio n'a été créé pour PAM-24.

PAM-24 doit rester ouvert, sans case cochée. Le reçu local
`artifacts/autonomy/receipts/PAM-24.json` conserve `outcome: blocked`, une liste
`deliveryCommits` vide et, séparément, le commit documentaire de ce constat.
Ce commit n'est pas une livraison du ticket. Une fois le blocage confirmé dans
Notion et le checkout propre, le protocole permet de choisir un ticket indépendant.
