# Pilote de vérification des paiements SumUp — Lugdurum

**État : vérification activée pour tous les vendeurs à la demande du propriétaire ; confirmation manuelle toujours disponible en secours. Premier paiement réel encore à valider.**

## Objectif et limites

Conserver l'ouverture actuelle de SumUp par Payment Switch sur iPhone, puis vérifier
une transaction réellement réglée à partir de sa référence externe `foreign-tx-id`.
La vérification ne doit **jamais** préjuger qu'une transaction est payée sous prétexte
qu'une redirection ou une fenêtre SumUp s'est ouverte.

L'API SumUp permet de retrouver une transaction par `foreign_transaction_id`
(`GET https://api.sumup.com/v2.1/merchants/{merchant_code}/transactions`).
Le montant, la devise, le marchand et le statut sont vérifiés **côté Apps Script**
avant de renvoyer un résultat minimal à la webapp.

Liens :
- https://developer.sumup.com/api/transactions
- https://developer.sumup.com/tools/authorization/api-keys
- https://developer.sumup.com/terminal-payments/payment-switch/ios

## Fichiers modifiés et ajoutés

- `docs/vente-rapide.js` : tentative de vérification non bloquante au retour dans la PWA,
  au maximum 5 tentatives espacées de 1,8 s, en conservant la confirmation manuelle.
- `docs/lugdurum-api.js` : lecture `verifySumupPayment` via la couche JSONP existante,
  sans nouvelle file d'écriture.
- `docs/vente-rapide.html` : versions de scripts incrémentées.
- `apps-script/10_sumup_verification.gs` : lecture serveur de SumUp, aucun secret
  dans les réponses ou sur GitHub.
- `tests/sumup-verification.test.cjs` : tests unitaires à exécuter avec Node.

Aucun onglet ni aucune colonne Google Sheets modifiés. Les identifiants de la feuille
`transactions` et du tableau `ventes_lignes` restent inchangés.

## Intégration serveur avec le dépôt GitHub

La PR #3 a importé les **11 modules Apps Script réels** dans `apps-script/`.
La PR #2 a désormais **déjà raccordé** la route `getSumupPaymentStatus`
dans `apps-script/01_http_router.js`, via `invokeGetAction_` et
`callRequiredFunction_("lugdurumGetSumupPaymentStatus", params)`.
Le module `apps-script/10_sumup_verification.gs` est versionné au même endroit.

**Ne pas recopier manuellement les fichiers dans l'éditeur Apps Script** :
la chaîne `GitHub Actions → clasp` assure l'envoi du code et la mise à jour
du déploiement existant **lorsque le workflow manuel est déclenché**.
Cette PR ne déclenche aucun déploiement automatiquement.

### Configuration privée à effectuer par le propriétaire

Dans l'éditeur du projet Apps Script concerné, ouvrir
**Paramètres du projet → Propriétés du script**, puis ajouter :

- `SUMUP_API_KEY` : clé API secrète SumUp donnant accès à
  `transactions.history` ou `transactions.read` ;
- `SUMUP_MERCHANT_CODE` : code marchand SumUp associé au compte.

Ces propriétés sont conservées côté Apps Script. **Ne jamais** les
ajouter à GitHub, dans le HTML/JS du frontend, dans les logs ou dans
la conversation. Les secrets GitHub utilisés pour l'authentification
`clasp` ne remplacent pas ces propriétés SumUp.

### Recette préalable

1. Exécuter les tests en CI (routeur JSON/JSONP et statuts du paiement).
2. Faire les essais de paiement sur un environnement TEST et une PWA de test,
   **sans écritures dans le classeur de production**.
3. Vérifier les réponses du backend `NOT_CONFIGURED`, `NOT_AUTHORIZED`,
   `NOT_FOUND`, `PENDING`, `SUCCESSFUL`, `FAILED`, `REFUNDED` et
   `MISMATCH` sans jamais valider automatiquement un statut non confirmé.
4. Vérifier sur iPhone que Payment Switch transmet réellement
   `foreign-tx-id` et que son application renvoie bien au premier plan.
5. Contrôler en production la première transaction réelle et prévoir le
   retour au mode manuel global si la vérification présente une anomalie.

Depuis la mise en production globale, la vérification automatique est **activée pour tous** ;
la confirmation manuelle du paiement SumUp est toujours conservée en secours.

## Sécurité et limitation d'accès

- **Aucune clé secrète côté navigateur**, y compris en localStorage.
- Le routeur Apps Script existant expose ses lectures en **JSONP public**. Il n'y a
  pas d'authentification forte de l'opérateur dans cette V1.
- Pour limiter l'énumération, seuls les identifiants très longs basés sur
  `crypto.randomUUID()` sont vérifiables. Les anciennes références courtes continuent
  à pouvoir être confirmées **manuellement**, sans requête SumUp.
- Une référence aléatoire n'est **pas** une authentification complète. Avant
  d'ouvrir cette fonctionnalité largement, préférer un endpoint authentifié
  (par exemple Cloudflare Worker avec authentification et limitation de débit).
- Le backend ne renvoie pas les détails personnels d'une transaction ; uniquement
  `verified`, `status`, la référence demandée et, en cas de succès confirmé,
  `transaction_code`.
- En cas d'indisponibilité ou de désaccord entre SumUp et le panier,
  **ne jamais valider automatiquement**.

## Comportement attendu au retour de SumUp

- `SUCCESSFUL` + même ID, montant, devise et commerçant → enregistrement automatique
  du ticket, exactement comme la confirmation manuelle actuelle ; le code SumUp
  est mentionné dans la note du ticket.
- `PENDING` ou `NOT_FOUND` → nouvelles vérifications limitées ; en l'absence
  de résultat, conserver le ticket en attente et proposer le contrôle manuel.
- `FAILED`, `CANCELLED`, `REFUNDED`, `MISMATCH` → ne jamais enregistrer
  automatiquement ; demander une vérification humaine.
- Hors-ligne / clé absente / route indisponible → parcours manuel inchangé.
- Les commandes du panier restent sur le téléphone ; le CA global se rafraîchit
  après l'écriture comme prévu dans la PR « Vente rapide Gerzat ».

## Tests

Depuis la racine du dépôt :

```sh
node --test tests/sumup-verification.test.cjs
```

Avant activation réelle : effectuer des tests manuels **sur iPhone PWA**, un
paiement à faible montant accepté et un refus simulé/annulé, un retour tardif,
un paiement trouvé avec mauvais montant et une coupure réseau. Confirmer
l'absence de doublon dans `transactions`, `ventes_lignes`,
`mouvements_stock`. Rester sur le classeur TEST pendant ces essais.

**Déjà validé :** autorisations Google, déploiement Apps Script, réponse `NOT_FOUND`
sur une référence fictive. **Encore à confirmer :** paiement `SUCCESSFUL` réel,
reprise iPhone/PWA et écritures Sheets complètes.


## Mise en production globale — octobre 2026

La route Apps Script et les permissions Google ont été déployées ; l'interrogation
d'un identifiant fictif a retourné `NOT_FOUND` via SumUp. Le propriétaire a
explicitement demandé d'activer la même vérification sur les deux vendeurs,
sans option par appareil.

- Dans `docs/vente-rapide.js`, `SUMUP_CONFIG.verificationEnabled: true` est
  désormais commun à tous les téléphones et navigateurs chargés avec la nouvelle version.
- Les paramètres historiques `?sumup_pilot=1` et `?sumup_pilot=0` sont sans effet.
- Un paiement lancé en mode CB génère une référence `LUG_<timestamp>_<UUID>`
  envoyée à SumUp via `foreign-tx-id`. À la reprise de la PWA, jusqu'à cinq
  interrogations API espacées de 1,8 s sont effectuées.
- **La confirmation automatique n'intervient qu'après `SUCCESSFUL` et concordance
  stricte de la référence, du compte marchand, de la devise et du montant.**
- Sinon le ticket reste en attente et peut être confirmé **manuellement après
  vérification du paiement dans l'application SumUp** ; pas de vente auto sur
  `NOT_FOUND`, `PENDING`, `FAILED`, `MISMATCH`, timeout ou hors-ligne.
- La PWA et Safari peuvent conserver des données locales distinctes ; s'assurer
  que la journée active est correctement chargée sur chaque appareil.
- **Un succès réel n'a pas encore été observé avec ce parcours**, et la remontée
  de `foreign-tx-id` sur un vrai encaissement iOS doit être confirmée.
- En cas de problème terrain, rétablir `verificationEnabled: false` par un
  correctif GitHub/PWA ; ne pas changer la référence d'un ticket déjà lancé.

### Recette d'encaissement

Pour un test en production, il faut utiliser un paiement réel, identifier la
transaction dans SumUp, puis comparer le résultat au ticket Lugdurum et vérifier
`transactions`, `ventes_lignes`, `mouvements_stock` pour détecter doublons
et écarts. Toute opération remboursée doit être tracée correctement dans la
comptabilité et ne doit pas créer de vente/stock fictif. Le remboursement
est une opération distincte de l'enregistrement initial de la vente dans Lugdurum.

L'API SumUp est en lecture seule ; cette intégration n'initie jamais de
remboursement. Les identifiants privés restent dans les propriétés Apps Script.
