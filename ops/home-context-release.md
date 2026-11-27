# Mise en production — accueil contextualisé par journée

Document de préparation uniquement. La PR #50 modifie l’accueil et ses liens, le contrat `getHomeData`, la résolution de contexte Apps Script et le contrôle des écritures de vente. Aucun onglet, aucune colonne et aucune donnée Google Sheets ne sont modifiés.

## Matrice de compatibilité

| Frontend | Apps Script | Lecture et parcours | Écritures | Validation disponible |
|---|---|---|---|---|
| Ancien | Ancien | Contrat actuellement publié | Comportement actuel avant la PR | Référence de production |
| Ancien | Nouveau | `getHomeData` conserve le mode historique quand `work_context` n’est pas demandé | Le nouveau contrôle refuse les ventes sans journée, événement, stock et vendeur concordants. Les anciennes écritures en attente peuvent donc être rejetées, mais restent dans la file locale. | Contrat de compatibilité confirmé dans le code. Pas de test navigateur inter-version avec l’ancien accueil. |
| Nouveau | Ancien | Le frontend détecte un contexte runtime discordant, relit les tables avec `getCoreData` et résout la journée affectée localement. | L’ancien Apps Script n’applique pas le nouveau contrôle de vente côté serveur : ne pas autoriser les écritures pendant cette combinaison. | Scénario navigateur Playwright simulé : fallback vers les tables complètes et conservation de Communay. |
| Nouveau | Nouveau | Contexte serveur et frontend alignés sur `user_id`, `journee_id`, `mission_id`, `stock_mission_id`. | Le serveur vérifie l’affectation, la journée ouverte, les relations événement/stock et la préparation avant d’accepter une vente. | Tests Apps Script ciblés et Playwright sur l’interface réelle avec API métier simulée. Pas d’écriture de production. |

Les essais inter-version ne remplacent pas un essai de préproduction. Les écritures Apps Script n’ont pas été envoyées à Google Sheets.

## Automatisation et ordre de publication

Le workflow `.github/workflows/apps-script-deploy.yml` n’est pas automatique : il est déclenché par `workflow_dispatch`, limite l’exécution à `main` et exige la confirmation `DEPLOYER_LUGDURUM`. Il utilise les secrets GitHub `CLASP_CREDENTIALS_JSON` et `APPS_SCRIPT_ID`, vérifie le déploiement existant, exécute `clasp push --force`, puis met à jour ce déploiement. Le workflow de connexion ne fait qu’un contrôle `clasp deployments` sur `chore/import-apps-script`. Il ne publie rien.

Aucun workflow GitHub Pages dédié n’est présent dans le dépôt. La publication Pages suit la configuration du dépôt et doit être vérifiée dans l’état du déploiement après fusion. Le workflow Apps Script actuel ne peut pas publier la branche de la PR avant fusion.

Procédure la plus sûre avec les workflows actuels :

1. Choisir une fenêtre sans vente. Demander aux appareils disponibles de se reconnecter et laisser les files d’attente se synchroniser. Ne pas supprimer ni réécrire une opération en attente.
2. Noter le SHA `main`, le SHA Apps Script actif et l’identifiant du déploiement WebApp. Vérifier les tests ciblés et que la file d’attente est vide sur les appareils disponibles.
3. Après validation humaine de la PR, fusionner. Garder les ventes suspendues : le frontend peut arriver sur Pages avant la mise à jour Apps Script.
4. Vérifier le déploiement Pages et dispatcher manuellement « Deploiement Apps Script - manuel » sur `main` avec la confirmation demandée. Ne pas exposer les valeurs des secrets dans les journaux.
5. Vérifier une lecture `getHomeData` et les autorisations en test contrôlé sans transaction ni modification Sheets. Confirmer le nouveau SHA Apps Script et l’URL de déploiement attendue.
6. Faire recharger l’application sur les appareils connectés. Un appareil resté hors ligne ne doit pas enregistrer de vente pendant la fenêtre de changement ; après reconnexion, contrôler sa file et les erreurs de synchronisation avant de reprendre.
7. Reprendre les ventes seulement après vérification de la paire Nouveau frontend / Nouvel Apps Script.

La combinaison Nouveau frontend / Ancien Apps Script est un état de transition en lecture seulement : le fallback préserve le contexte visuel, mais l’ancien serveur n’a pas la nouvelle vérification d’affectation. Ne pas permettre de ventes pendant cet intervalle.

## Ventes hors ligne et opérations en attente

La PR ne vide pas `lugdurum_pending_writes` et ne change pas le mécanisme de synchronisation. Les opérations déjà présentes gardent leurs identifiants et leur contexte. Une écriture ancienne refusée par les nouvelles vérifications doit rester visible et être examinée ; ne pas la supprimer et ne pas remplacer ses identifiants par ceux d’une journée plus récente.

Avant la publication, synchroniser les appareils joignables. Les appareils temporairement hors ligne restent en pause jusqu’au rechargement de la nouvelle version et au contrôle de leur file. La PWA utilise un service worker réseau seul pour les fichiers statiques ; une ouverture à froid sans réseau n’est pas garantie. Une page déjà ouverte conserve son contexte et ses opérations locales.

## Retour arrière

1. Suspendre les ventes sur tous les appareils ; préserver `lugdurum_pending_writes` et relever les erreurs sans les purger.
2. Restaurer Apps Script à partir d’un commit de retour arrière des fichiers `apps-script/03_get_data.js`, `04_home_data.js` et `06_write_bundles_vente.js` sur `main`. Le workflow existant ne déploie que le contenu de `main` : un commit de retour arrière est nécessaire avant son lancement manuel. Mettre à jour le même identifiant de déploiement et vérifier l’API.
3. Restaurer ensuite le frontend Pages par un commit `git revert` de la livraison frontend sur `main`. Vérifier que Pages a publié le commit de retour arrière et que les références de cache du HTML correspondent au frontend restauré.
4. Garder les ventes suspendues jusqu’à ce que les deux composants soient revenus à l’ancienne version et que les appareils connectés aient rechargé la PWA.
5. Contrôler les files d’attente, les ventes acceptées et les ventes rejetées avant la reprise. Toute opération douteuse est rapprochée manuellement des historiques ; ne pas rejouer aveuglément une vente dont le résultat serveur est incertain.

Le retour arrière reste coordonné et sans réécriture d’historique. Les ventes hors ligne ne doivent jamais être perdues ou réassociées silencieusement à une autre journée.
