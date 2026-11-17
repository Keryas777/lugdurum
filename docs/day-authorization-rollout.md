# Affectations vendeurs et contexte de vente — validation

## Audit réalisé

- L’identité sélectionnée dans lugdurum_current_user_id est une préférence locale. Le module lugdurum-users.js indique déjà qu’elle ne constitue pas une connexion.
- L’accueil sélectionnait des événements missions_vente et vendeurs_prevus, ce qui ne représente pas les droits d’une journée réelle.
- La caisse résolvait son contexte à partir du stock et du jour, puis utilisait l’identifiant de stock aussi comme mission_id de transaction.
- La file d’attente conserve déjà le payload d’écriture et son identifiant. Elle ne doit pas reconstruire le contexte au moment du rejeu.
- Le classeur consulté le 17 novembre 2026 contient les 21 journées de Noël et leur colonne vendeurs_autorises. Les 21 valeurs sont renseignées. Les stock_mission_id de ces journées sont vides et aucune mission de stock ouverte n’est présente.

## Changements proposés

- La sélection des journées lit uniquement journees_vente.vendeurs_autorises. Le jour français courant est prioritaire, puis vient la date future la plus proche. Plusieurs journées le même jour sont affichées pour choix explicite.
- La caisse exige un jour ouvert, un vendeur présent dans l’affectation de la journée, une mission de stock réellement associée et la date française courante.
- Les anciens jours sans vendeurs_autorises restent lisibles. Aucune permission d’écriture ne leur est accordée automatiquement.
- La transaction et les lignes gardent le vrai identifiant d’événement dans mission_id, le jour dans journee_id, le stock associé dans stock_mission_id et le vendeur de l’appareil dans user_id.
- La consultation d’un autre marché passe par consult=1, ne remplace pas les clés de contexte actif et bloque les boutons d’encaissement.
- Le contrôle Apps Script recoupe la journée, l’événement, le stock, le statut et l’affectation au vendeur lors d’une écriture de vente rapide. Il valide la cohérence métier, pas l’identité de l’appelant.

## Limite d’authentification

Le déploiement Apps Script actuel est appelé par l’application avec un identifiant vendeur fourni côté navigateur. Cet identifiant est modifiable et ne peut pas prouver qui a envoyé la requête. Une vérification de user_id côté Apps Script est donc une barrière contre les erreurs et les incohérences, pas une authentification fiable.

Pour imposer une identité vérifiée, la solution minimale ultérieure est un point d’entrée serveur authentifié qui valide un jeton Google/OpenID Connect pour chaque écriture, puis dérive l’utilisateur depuis ce jeton au lieu de faire confiance au champ du navigateur. Cela nécessite une décision d’architecture et une configuration d’accès Google; aucun nouveau compte ou stockage n’est introduit par cette PR.

## Stocks qui restent à préparer

Aucun stock initial ni mission de stock n’est créé par ce changement. En particulier, la mission longue durée de William et les deux journées partagées avec le stock d’Anthony restent à associer via le parcours métier de préparation avant toute vente. Jusqu’à cette association, l’accueil propose la préparation du stock et la caisse refuse l’encaissement.

## Tests exécutés

- node --check docs/vente-rapide.js
- node --test tests/vente-rapide.test.cjs — 26 réussis.
- node --test tests/day-context.test.cjs — 12 réussis.

Les tests utilisent des données factices. Aucun ticket n’a été écrit dans le classeur de production.

## Déploiement après validation

1. Publier une nouvelle version du projet Apps Script depuis les fichiers apps-script/06_write_bundles_vente.js et apps-script/08_normalizers.js. Ne pas remplacer l’URL de déploiement utilisée par la PWA.
2. Publier les fichiers statiques GitHub Pages ensemble afin que lugdurum-day-context.js, la normalisation des journées et les contrôles de caisse arrivent au même moment.
3. Vérifier d’abord dans une copie de test du classeur avec des missions de stock fictives et des écritures de test.
4. Ne pas enregistrer de ventes dans le classeur réel pendant la validation.

## Scénarios manuels sur iPhone Safari

1. Choisir William et ouvrir l’accueil : Colombier-Saugnieu J1 doit apparaître pour le 28 novembre, puis J2 pour le 29. Le 6 décembre, seule Vernaison doit être proposée pour William.
2. Choisir Anthony et vérifier La Tour-de-Salvagny J1 le 5 décembre et J2 le 6 décembre. William et Anthony doivent voir la même journée partagée du 5 décembre.
3. Vérifier qu’une journée future sans mission de stock réelle mène à la préparation et que la caisse reste bloquée.
4. Ouvrir une journée d’un collègue en consultation : les boutons d’encaissement restent désactivés et le contexte enregistré par défaut ne change pas.
5. Dans une copie de test, démarrer un ticket hors ligne, changer la journée/le vendeur et synchroniser. Le ticket doit garder ses identifiants, son vendeur, son jour et son stock initiaux; une journée clôturée ou une autorisation retirée doit laisser l’écriture en attente et visible en erreur.
6. Garder un panier ouvert jusqu’au changement de date française : le panier doit rester affiché et aucune nouvelle journée ne doit lui être attribuée automatiquement.
