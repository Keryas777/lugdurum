# Mise en production — accueil contextualisé par journée

Ce document prépare une mise en production, sans l’exécuter. La PR #50 modifie le frontend et trois fichiers Apps Script (`03_get_data.js`, `04_home_data.js`, `06_write_bundles_vente.js`). Aucune colonne ni donnée Sheets n’est modifiée.

## Compatibilité

| Frontend | Apps Script | Comportement attendu | Appréciation |
|---|---|---|---|
| Ancien | Ancien | Ancien sélecteur global et ancien contrat d’accueil | Comportement actuel avant livraison |
| Ancien | Nouveau | L’absence de `work_context` conserve le mode historique de `getHomeData`; les anciennes écritures gardent leurs noms d’action | Compatible à vérifier sur les chemins historiques |
| Nouveau | Ancien | Le frontend vérifie le contexte runtime; si l’API historique ne fournit pas les identifiants concordants, il recharge `getCoreData` et résout la journée côté client | Mode de transition prévu, dépend des tables complètes disponibles |
| Nouveau | Nouveau | Résolution serveur et navigateur sur les mêmes identifiants de journée, événement et stock | Mode cible |

La matrice de compatibilité est déduite des branches de code existantes; seules les cases nouvelles/nouvelles sont couvertes par le contrat de la PR. Le test navigateur intercepte l’API et ne remplace pas un essai de préproduction avec l’ancien déploiement Apps Script.

## Ordre recommandé

1. Vérifier les tests et faire une sauvegarde du SHA `main`, du SHA Apps Script actif et de l’identifiant de déploiement WebApp.
2. Fusionner la PR quand elle sera validée.
3. Publier d’abord Apps Script à partir de `main` avec le workflow manuel existant. Il est protégé par `workflow_dispatch`, exige la saisie `DEPLOYER_LUGDURUM`, vérifie le déploiement existant puis exécute `clasp push --force` et `clasp create-deployment --deploymentId`.
4. Vérifier une lecture `getHomeData` et les écritures autorisées/refusées, sans utiliser de vente réelle.
5. Laisser GitHub Pages publier `main`, puis vérifier l’accueil avec les profils concernés.
6. Demander aux appareils en ligne de recharger la PWA; garder un suivi des appareils hors ligne avant de confirmer la fin de migration.

Apps Script ne se déploie pas automatiquement sur chaque push : le workflow observé est manuel et nécessite les secrets `CLASP_CREDENTIALS_JSON`, `APPS_SCRIPT_ID` ainsi que l’identifiant du déploiement existant extrait du frontend. Le workflow de connexion est limité à la branche `chore/import-apps-script` et ne déploie rien. Ne jamais imprimer les secrets dans les journaux.

## Ventes hors ligne et file d’attente

La file `lugdurum_pending_writes` est conservée par le changement d’accueil. Le code n’efface pas cette file. Les actions déjà en attente restent rejouées par l’API existante. Les écritures rejetées par la nouvelle vérification d’affectation ou de clôture doivent rester visibles comme erreurs à traiter; ne pas vider la file ni changer les identifiants d’une vente en attente. Avant bascule, attendre que les appareils en ligne synchronisent; les appareils hors ligne doivent se reconnecter avant une vente sur une journée dont les affectations ont changé.

## Retour arrière

1. Suspendre toute nouvelle vente et noter le SHA fautif.
2. Restaurer Apps Script au commit précédent connu (checkout du SHA sauvegardé, puis lancement contrôlé du workflow manuel; il actualise le même ID de déploiement). Vérifier `getHomeData` et une lecture de tables.
3. Restaurer GitHub Pages au commit frontend antérieur par un commit de revert sur `main`; ne pas réécrire l’historique. Vérifier que les liens de cache reviennent aux versions du HTML restauré.
4. Faire recharger les appareils en ligne. Les appareils hors ligne doivent rester fermés aux nouvelles écritures jusqu’à resynchronisation et contrôle de leur file; ne supprimer aucune entrée en attente.
5. Contrôler les ventes synchronisées après le retour arrière avant reprise normale.

Le retour arrière des deux composants doit être coordonné. Un ancien frontend avec le nouveau Apps Script est le repli de transition prévu; restaurer Apps Script avant Pages évite de laisser le frontend nouveau appeler durablement un backend ancien.
