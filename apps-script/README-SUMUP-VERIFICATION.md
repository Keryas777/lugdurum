# Pilote de vérification des paiements SumUp — Lugdurum

**État : expérimental et désactivé par défaut. Ne pas activer pour Gerzat sans validation.**

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

## Installation côté Apps Script (une fois les tests préparés)

1. **Utiliser en premier une copie TEST** du classeur et du projet Apps Script,
   pas le déploiement de production.
2. Copier le contenu de `apps-script/10_sumup_verification.gs` dans un **nouveau fichier**
   `10_sumup_verification.gs` du projet Apps Script.
3. Dans le routeur `01_http_router.gs`, **dans doGet(e)** et avant le dispatch
   des actions GET habituelles, ajouter exactement :

```javascript
if (action === "getSumupPaymentStatus") {
  return reply({
    ok: true,
    version: API_VERSION,
    duration_ms: Date.now() - startedAt,
    data: lugdurumGetSumupPaymentStatus(e?.parameter || {})
  });
}
```

   Ne pas mettre cette lecture dans `doPost`, ni dans une zone couverte par
   `LockService` : il n'y a **aucune écriture Google Sheets** dans cette action.

4. Dans **Paramètres du projet → Propriétés du script**, renseigner :
   - `SUMUP_API_KEY` : une **clé API secrète** obtenue dans
     SumUp → Settings → For Developers → Toolkit → API Keys.
   - `SUMUP_MERCHANT_CODE` : le code commerçant SumUp.
   
   **Ne pas** partager ces valeurs dans cette conversation, GitHub, les logs ou le JS.
   Vérifier que la clé donne effectivement la permission `transactions.history`
   ou `transactions.read`, ainsi que le droit Apps Script de faire un appel HTTP
   externe (`UrlFetchApp`).
5. Faire un **nouveau déploiement Apps Script de test** ; ne pas écraser celui de
   production par inadvertance. Avec une URL de déploiement TEST, la webapp de test
   devra aussi utiliser cette URL.
6. Après vérification des retours serveur (404 temporaire, PENDING, SUCCESSFUL,
   FAILED, REFUNDED et MISMATCH), modifier **sur une branche de test seulement** :

```javascript
// docs/vente-rapide.js
SUMUP_CONFIG.verificationEnabled = true
```

   Dans le code source, cette valeur est une propriété de l'objet `SUMUP_CONFIG`
   (et non une instruction à exécuter telle quelle dans la console).

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

**Non testé :** autorisation réelle de la clé sur le compte marchand, propagation
du `foreign-tx-id` par le Payment Switch iOS, déploiement Apps Script effectif.
