# Préparation de la diffusion Windows

Le canal prévu est une remise manuelle privée, hors ligne, à des testeurs
explicitement autorisés. Aucun serveur de mise à jour ni publication publique
n'est configuré. La préparation locale ne vaut pas autorisation de diffuser.
Un auto-updater n'est pas nécessaire pour ce canal.

## Identité et conditions de livraison

Une version distribuée doit avoir un numéro SemVer unique et cohérent dans
`package.json`, `src-tauri/tauri.conf.json` et `src-tauri/Cargo.toml`, un SHA Git
complet validé, une cible x64 et un buildId. Ne jamais remplacer un paquet déjà
remis sous le même numéro. Conserver les deux versions exactes N et N+1 pour
l'essai d'upgrade puis de retour à N.

Le parcours non signé et ses contrôles de provenance sont décrits dans
[portable.md](portable.md). Les signatures doivent être appliquées **avant** le
gel des SHA-256 distribués. Un hash doit être obtenu par un canal déjà approuvé ;
un hash placé à côté d'un fichier inconnu ne prouve pas son origine.

Avant toute signature destinée à diffusion : vérifier les quatre checks CI sur
le SHA exact selon [ci-quality.md](ci-quality.md), traiter les avis du suivi de
sécurité, vérifier les licences/SBOM, puis obtenir l'autorisation de diffusion.
Un check absent, ignoré ou rouge bloque cette étape. La signature d'un éditeur
ne remplace ni cette revue ni la validation du contenu installé.

## Configuration de signature préparée

Le certificat et sa clé privée restent dans le magasin Windows CurrentUser/My
du poste de signature ou dans un dispositif de signature approuvé. Ne pas créer
de certificat autosigné pour prétendre valider la confiance d'un utilisateur.
Ne pas exporter de clé, ajouter de racine de confiance ou acheter un certificat
automatiquement. Les fichiers PFX, mots de passe et jetons restent hors dépôt.

Après provisionnement explicite par le responsable de la signature :

```powershell
$env:PAM_SIGNING_THUMBPRINT = '<40 chiffres hex du certificat approuve>'
$env:PAM_SIGNING_TIMESTAMP_URL = 'https://<serveur RFC3161 du fournisseur>'
npm run signing:config
```

Le générateur refuse une empreinte absente ou mal formée et une URL non HTTPS,
avec identifiants ou fragment. Il écrit uniquement le fragment Tauri
`artifacts/release/tauri.signing.json` : certificat sélectionné par empreinte,
digest SHA-256 et horodatage RFC 3161. L'empreinte SHA-1 désigne le certificat ;
elle ne choisit pas SHA-1 pour signer le fichier. Aucun secret n'est copié.
Générer ce fichier ne signe rien et ne prouve pas que la clé est disponible.

**Intégration du build signé encore à valider.** Ce fragment n'est pas chargé
automatiquement par `build:portable` ou `package:windows`. Le build actuel fige
les empreintes des ressources avant Tauri ; le bundler peut signer des DLL/EXE
ressources pendant NSIS. Il faut préparer les copies de signature et leurs
inventaires dans un staging dédié, préserver les caches épinglés, puis vérifier
le paquet signé et son reçu sur les octets finaux. Ne pas signer après coup un
portable publié : son manifeste deviendrait invalide. Ne pas contourner les
contrôles d'intégrité pour obtenir un build vert. La configuration seule n'est
pas une livraison signée et cet assemblage reste du travail de PAM-38.

Sources de configuration : [signature Windows Tauri](https://v2.tauri.app/distribute/sign/windows/)
et [référence WindowsConfig](https://v2.tauri.app/reference/config/#windowsconfig).

## Vérification native des fichiers finaux

Le vérificateur lit un fichier précis sans l'exécuter. Donner un SHA-256 et une
empreinte d'éditeur obtenus depuis la livraison approuvée, puis le chemin absolu
de SignTool du Windows SDK. Les arguments sont passés sans shell :

```powershell
$env:PAM_SIGNTOOL_PATH = 'C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64\signtool.exe'
npm run signing:verify -- 'C:\staging\PAM.exe' '<SHA256 attendu>' '<empreinte editeur>'
npm run signing:verify -- 'C:\staging\PAM_N_x64-setup.exe' '<SHA256 attendu>' '<empreinte editeur>'
```

L'hôte par défaut est Windows PowerShell. Si un hôte PowerShell 7 est déjà
approuvé et configuré pour les scripts locaux, son chemin absolu peut être fourni
avec `PAM_POWERSHELL_PATH`. Une stratégie qui interdit le script reste un échec :
le vérificateur ne passe aucun `ExecutionPolicy Bypass` et ne change aucune
stratégie ou permission.

La vérification exige une signature Authenticode embarquée valide, le signataire
attendu, un horodatage, puis `signtool verify /pa /all /tw` sans erreur ni
avertissement. Elle contrôle le SHA-256 avant et après la vérification et renvoie
une preuve JSON datée. Un certificat de catalogue seul, un fichier altéré, un
autre éditeur ou un horodatage absent est refusé. Une impossibilité de vérifier
la chaîne/révocation n'est pas un succès. Conserver le résultat et le code de
sortie. La vérification hors ligne dépend des racines et informations de
révocation présentes : tester aussi ce cas sur les snapshots prévus.

Vérifier séparément PAM.exe, l'installeur et le désinstalleur installé. Identifier
les exécutables et DLL tiers dans le SBOM et le manifeste ; conserver leurs
signatures d'origine et empreintes approuvées. Ne pas leur attribuer un éditeur
PAM par simple proximité. Comparer `PAM.exe --pam-build-info`, le manifeste,
les reçus et le SHA validé, y compris **après extraction/installation NSIS**.
La signature du setup seule ne prouve pas le commit de son contenu.

Références : [SignTool Microsoft](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool),
[Get-AuthenticodeSignature](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature).

`npm test` couvre la configuration, les arguments littéraux, un fichier non
signé et un mauvais hash. `npm run test:signing:native` exige Windows et un
SignTool signé approuvé comme fixture, avec `PAM_SIGNTOOL_PATH`,
`PAM_SIGNATURE_FIXTURE_SHA256` et `PAM_SIGNATURE_FIXTURE_THUMBPRINT` explicites.
Il vérifie la confiance réelle, refuse un autre éditeur et une copie altérée,
puis supprime la copie sans exécuter le fichier. Une fixture ou un SDK absent
fait échouer cette suite dédiée. Elle ne signe pas PAM et ne remplace pas la VM.

## Profil, upgrade et rollback

Le profil par défaut est le dossier de configuration de l'identifiant stable
`com.enkis.pam` (sur Windows : `%APPDATA%\com.enkis.pam`). Il est distinct des
fichiers installés. `PAM_PROFILE_DIR` permet un profil de test absolu ; isoler
aussi `WEBVIEW2_USER_DATA_FOLDER`. Le portable utilise ce même profil par défaut,
il ne crée pas automatiquement un profil à côté de l'exécutable.

Avant une mise à niveau, arrêter PAM proprement et confirmer l'arrêt de ses
auxiliaires. Exporter le profil par l'interface, conserver hors dossier installé
une copie exacte du dossier complet, son SHA-256 et la version du schéma. Le
profil contient notamment `applications.json`, la sauvegarde
`applications.backup.json`, les applications et les formulations apprises.
Garder les originaux tant que la nouvelle version n'est pas validée.

Pour le portable, sélectionner un nouveau dossier complet et conserver l'ancien.
Pour NSIS, appliquer N+1 sur N dans le même périmètre currentUser. Comparer les
applications, identifiants, formulations et préférences après premier lancement.
Le runtime hors ligne WebView2 est configuré pour NSIS ; le portable nécessite
un WebView2 déjà disponible. Ne pas confondre ces deux prérequis.

Pour revenir à N : arrêter N+1, sauvegarder son état séparément, réinstaller ou
resélectionner les octets exacts de N, puis restaurer une **copie** du profil
pré-upgrade si N ne comprend pas le schéma courant. Ne pas modifier à la main un
numéro de schéma. Le refus d'une version future doit laisser les originaux
intacts et indiquer la récupération. Ne jamais ouvrir le profil réel pour ce test.

La politique de désinstallation est de conserver le profil et les fichiers
utilisateur. Toute suppression de données doit être une action distincte,
explicite et informée. Le test doit couvrir le comportement interactif et
silencieux du désinstalleur réel ; le comportement du template NSIS n'est pas
considéré validé par ce document. La suppression d'un portable ne doit cibler
que son dossier de distribution. Ne pas désinstaller WebView2 partagé.

## Matrice obligatoire sur VM propre

Utiliser deux snapshots Windows x64 identifiés, sans Node/Cargo ni PAM : l'un
avec WebView2 disponible, l'autre sans. Conserver OS/build, langue, droits,
image/snapshot, réseau désactivé, versions et SHA-256 des paquets N/N+1, identité
compilée, signatures et journaux. Aucun scénario ci-dessous n'est acquis par
une compilation ou par les tests unitaires.

| Scénario | Portable | NSIS | Preuve attendue |
| --- | --- | --- | --- |
| Première utilisation hors ligne, PATH sans Node/Cargo | Avec WebView2 déjà présent ; absence explicitement diagnostiquée sinon | Installation currentUser avec WebView2 embarqué, depuis le snapshot sans runtime | Rendu WebView2, version/buildId/commit, moteurs en mémoire ; aucun téléchargement requis |
| Upgrade N vers N+1 | Nouveau dossier complet | Installation sur N | Applications/formulations/préférences conservées, export avant/après et empreintes |
| Rollback N+1 vers N | Ancien dossier vérifié | Ancien setup vérifié, procédure interactive et silencieuse documentée | Profil compatible conservé ou copie pré-upgrade restaurée ; originaux intacts |
| Échec d'upgrade ou profil futur | Reprendre N et sa copie de profil | Échec interrompu dans la VM jetable uniquement | Au moins une copie valide, message exploitable et récupération démontrée |
| Fermeture, retrait et désinstallation | Fermer puis retirer le seul dossier portable | Désinstallation interactive puis silencieuse sur snapshots séparés | Aucun auxiliaire PAM actif, profil et sentinelle hors installation conservés |
| Authenticité négative | Copie altérée, mauvais hash et autre éditeur refusés | Mêmes rejets pour setup et désinstalleur | Codes non nuls, fichier jamais exécuté après rejet |

Créer uniquement une application de test inoffensive et deux formulations
synthétiques, ajouter une sentinelle utilisateur hors installation et comparer
leur contenu après chaque transition. Relever les chemins/PID avant fermeture
et confirmer qu'aucun processus issu de l'installation ne reste actif. Ne pas
tuer un processus personnel sur la seule base de son nom. Restaurer chaque
snapshot pour rendre les scénarios indépendants ; ne pas installer le produit
sur le poste personnel à la place de la VM.

Un rapport doit marquer chaque ligne `réussi`, `échoué` ou `non exécuté`, avec
les preuves. Toute case non exécutée garde PAM-38 ouvert. La signature publique,
la validation VM, l'assemblage signé et l'accord de remise restent requis avant
la première diffusion.
