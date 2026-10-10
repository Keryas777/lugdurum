/*
  00_config.gs

  Configuration globale API Lugdurum.

  Ce fichier contient uniquement :
  - les noms exacts des onglets Google Sheets ;
  - les mappings d’actions GET ;
  - les configurations d’upsert ;
  - les listes de colonnes optimisées pour les vues rapides ;
  - les constantes métier partagées.

  Ne pas mettre ici :
  - doGet / doPost ;
  - fonctions de lecture/écriture Sheets ;
  - fonctions métier ;
  - tests.
*/

const SHEETS = {
  utilisateurs: "utilisateurs",
  catalogue: "catalogue",
  offresVente: "offres_vente",

  inscriptions: "inscriptions_evenements",

  missions: "missions_vente",
  missionsStock: "missions_stock",
  journees: "journees_vente",

  mouvementsStock: "mouvements_stock",

  transactions: "transactions",
  ventesLignes: "ventes_lignes",
  frais: "frais",

  clotures: "clotures_journees",

  clients: "clients",
  commandesPro: "commandes_pro",
  commandesProLignes: "commandes_pro_lignes",
  commandesLignes: "commandes_pro_lignes",
  documents: "documents",
  referentiel: "referentiel",
  referentiels: "referentiel",

  recettes: "recettes",
  recettesIngredients: "recettes_ingredients",
  ingredients: "ingredients",
  cuvees: "cuvees",
  cuveesIngredientsReels: "cuvees_ingredients_reels",
  matieresPremieres: "matieres_premieres",
  matieresLots: "matieres_lots",
  cuveesMatieresConsommees: "cuvees_matieres_consommees",
  mouvementsMatieres: "mouvements_matieres"
};

const API_VERSION = "V17_HOME_EVENT_SELECTOR_FIX_NAMES";

const SHEET_CONFIG = {
  inscriptions: {
    sheetName: SHEETS.inscriptions,
    idKey: "inscription_id"
  },
  missions: {
    sheetName: SHEETS.missions,
    idKey: "mission_id"
  },
  missionsStock: {
    sheetName: SHEETS.missionsStock,
    idKey: "mission_id"
  },
  journees: {
    sheetName: SHEETS.journees,
    idKey: "journee_id"
  },
  mouvementsStock: {
    sheetName: SHEETS.mouvementsStock,
    idKey: "mouvement_stock_id"
  },
  transactions: {
    sheetName: SHEETS.transactions,
    idKey: "transaction_id"
  },
  ventesLignes: {
    sheetName: SHEETS.ventesLignes,
    idKey: "ligne_id"
  },
  frais: {
    sheetName: SHEETS.frais,
    idKey: "frais_id"
  },
  clotures: {
    sheetName: SHEETS.clotures,
    idKey: "salon_id"
  },
  clients: {
    sheetName: SHEETS.clients,
    idKey: "client_id"
  },
  commandesPro: {
    sheetName: SHEETS.commandesPro,
    idKey: "commande_id"
  },
  commandesProLignes: {
    sheetName: SHEETS.commandesProLignes,
    idKey: "commande_ligne_id"
  },
  commandesLignes: {
    sheetName: SHEETS.commandesProLignes,
    idKey: "commande_ligne_id"
  },
  documents: {
    sheetName: SHEETS.documents,
    idKey: "document_id"
  },

  recettes: {
    sheetName: SHEETS.recettes,
    idKey: "recette_id"
  },
  recettesIngredients: {
    sheetName: SHEETS.recettesIngredients,
    idKey: "recette_ingredient_id"
  },
  ingredients: {
    sheetName: SHEETS.ingredients,
    idKey: "ingredient_id"
  },
  cuvees: {
    sheetName: SHEETS.cuvees,
    idKey: "cuvee_id"
  },
  cuveesIngredientsReels: {
    sheetName: SHEETS.cuveesIngredientsReels,
    idKey: "cuvee_ingredient_id"
  },
  matieresPremieres: {
    sheetName: SHEETS.matieresPremieres,
    idKey: "matiere_id"
  },
  matieresLots: {
    sheetName: SHEETS.matieresLots,
    idKey: "lot_id"
  },
  cuveesMatieresConsommees: {
    sheetName: SHEETS.cuveesMatieresConsommees,
    idKey: "conso_id"
  },
  mouvementsMatieres: {
    sheetName: SHEETS.mouvementsMatieres,
    idKey: "mouvement_matiere_id"
  }
};

const GET_ACTIONS = {
  getUtilisateurs: SHEETS.utilisateurs,
  getCatalogue: SHEETS.catalogue,
  getOffresVente: SHEETS.offresVente,

  getInscriptions: SHEETS.inscriptions,
  getInscriptionsEvenements: SHEETS.inscriptions,

  getMissions: SHEETS.missions,
  getMissionsStock: SHEETS.missionsStock,

  getJournees: SHEETS.journees,
  getJourneesVente: SHEETS.journees,

  getMouvementsStock: SHEETS.mouvementsStock,

  getTransactions: SHEETS.transactions,
  getVentesLignes: SHEETS.ventesLignes,
  getFrais: SHEETS.frais,

  getClotures: SHEETS.clotures,
  getCloturesJournees: SHEETS.clotures,

  getClients: SHEETS.clients,
  getCommandesPro: SHEETS.commandesPro,
  getCommandesProLignes: SHEETS.commandesProLignes,
  getCommandesLignes: SHEETS.commandesProLignes,
  getDocuments: SHEETS.documents,
  getReferentiel: SHEETS.referentiel,
  getReferentiels: SHEETS.referentiel,

  getRecettes: SHEETS.recettes,
  getRecettesIngredients: SHEETS.recettesIngredients,
  getIngredients: SHEETS.ingredients,
  getCuvees: SHEETS.cuvees,
  getCuveesIngredientsReels: SHEETS.cuveesIngredientsReels,
  getMatieresPremieres: SHEETS.matieresPremieres,
  getMatieresLots: SHEETS.matieresLots,
  getCuveesMatieresConsommees: SHEETS.cuveesMatieresConsommees,
  getMouvementsMatieres: SHEETS.mouvementsMatieres
};

const EMPTY_GET_ACTIONS = {
  getStockPreparations: true,
  getStockPreparationLines: true,
  getStockPreparationLignes: true
};

const CORE_DATA_TABLES = {
  utilisateurs: SHEETS.utilisateurs,
  catalogue: SHEETS.catalogue,
  offresVente: SHEETS.offresVente,
  offres_vente: SHEETS.offresVente,

  inscriptions: SHEETS.inscriptions,
  inscriptions_evenements: SHEETS.inscriptions,

  missions: SHEETS.missions,
  missions_vente: SHEETS.missions,

  missionsStock: SHEETS.missionsStock,
  missions_stock: SHEETS.missionsStock,

  journees: SHEETS.journees,
  journees_vente: SHEETS.journees,

  mouvementsStock: SHEETS.mouvementsStock,
  mouvements_stock: SHEETS.mouvementsStock,

  transactions: SHEETS.transactions,

  ventesLignes: SHEETS.ventesLignes,
  ventes_lignes: SHEETS.ventesLignes,

  frais: SHEETS.frais,

  clotures: SHEETS.clotures,
  cloturesJournees: SHEETS.clotures,
  clotures_journees: SHEETS.clotures,

  clients: SHEETS.clients,

  commandesPro: SHEETS.commandesPro,
  commandes_pro: SHEETS.commandesPro,

  commandesProLignes: SHEETS.commandesProLignes,
  commandes_pro_lignes: SHEETS.commandesProLignes,
  commandesLignes: SHEETS.commandesProLignes,
  commandes_lignes: SHEETS.commandesProLignes,

  documents: SHEETS.documents,

  referentiel: SHEETS.referentiel,
  referentiels: SHEETS.referentiel,

  recettes: SHEETS.recettes,

  recettesIngredients: SHEETS.recettesIngredients,
  recettes_ingredients: SHEETS.recettesIngredients,

  ingredients: SHEETS.ingredients,

  cuvees: SHEETS.cuvees,

  cuveesIngredientsReels: SHEETS.cuveesIngredientsReels,
  cuvees_ingredients_reels: SHEETS.cuveesIngredientsReels,

  matieresPremieres: SHEETS.matieresPremieres,
  matieres_premieres: SHEETS.matieresPremieres,

  matieresLots: SHEETS.matieresLots,
  matieres_lots: SHEETS.matieresLots,

  cuveesMatieresConsommees: SHEETS.cuveesMatieresConsommees,
  cuvees_matieres_consommees: SHEETS.cuveesMatieresConsommees,

  mouvementsMatieres: SHEETS.mouvementsMatieres,
  mouvements_matieres: SHEETS.mouvementsMatieres
};

const EMPTY_CORE_TABLES = {
  stockPreparations: true,
  stock_preparations: true,
  stockPreparationLines: true,
  stockPreparationLignes: true,
  stock_preparation_lignes: true
};

const HOME_COLUMNS = {
  inscriptions: [
    "inscription_id",
    "nom",
    "type_evenement",
    "date_debut",
    "date_fin",
    "horaires",
    "mise_en_place",
    "ville",
    "lieu",
    "adresse",
    "statut",
    "prix_emplacement",
    "dossier_envoye",
    "date_dossier_envoye",
    "acceptation",
    "date_acceptation",
    "paiement_statut",
    "paiement_statut_label",
    "caution",
    "table_fournie",
    "barnum_fourni",
    "chaises_fournies",
    "eclairage_fourni",
    "electricite_fournie",
    "responsable_user_id",
    "contact_nom",
    "contact_mail",
    "contact_tel",
    "commentaire",
    "evenement_id",
    "vendeurs_prevus",
    "vendeurs_prevus_noms",
    "source",
    "created_at",
    "updated_at"
  ],

  missions: [
    "mission_id",
    "evenement_id",
    "inscription_id",
    "nom",
    "date_debut",
    "date_fin",
    "lieu",
    "ville",
    "adresse",
    "horaires",
    "mise_en_place",
    "type_evenement",
    "type_evenement_label",
    "duree_type",
    "statut",
    "vendeurs_prevus",
    "vendeurs_prevus_noms",
    "responsable_user_id",
    "note",
    "source",
    "created_at",
    "updated_at"
  ],

  missionsStock: [
    "mission_id",
    "evenement_id",
    "nom",
    "ville",
    "lieu",
    "adresse",
    "type_evenement",
    "type_evenement_label",
    "date_debut",
    "date_fin",
    "statut",
    "stock_prepare",
    "responsable_user_id",
    "journees_count",
    "note",
    "source",
    "created_at",
    "updated_at"
  ],

  journees: [
    "journee_id",
    "mission_id",
    "evenement_id",
    "stock_mission_id",
    "mission_stock_id",
    "date",
    "jour_label",
    "statut",
    "source",
    "created_at",
    "updated_at"
  ],

  mouvementsStock: [
    "mouvement_stock_id",
    "mouvement_id",
    "mission_id",
    "stock_mission_id",
    "mission_stock_id",
    "journee_id",
    "type_mouvement",
    "mouvement_type",
    "type",
    "categorie",
    "sku_id",
    "quantite",
    "quantity",
    "qty",
    "statut",
    "source",
    "created_at",
    "updated_at"
  ],

  transactions: [
    "transaction_id",
    "mission_id",
    "stock_mission_id",
    "evenement_id",
    "journee_id",
    "date_heure",
    "date",
    "mode_paiement",
    "paiement_provider",
    "paiement_statut",
    "total_encaisse_ttc",
    "total_encaisse",
    "total_catalogue_ttc",
    "total_catalogue",
    "statut",
    "source",
    "created_at",
    "updated_at"
  ],

  clotures: [
    "salon_id",
    "cloture_id",
    "journee_id",
    "date_cloture",
    "total_reel",
    "total_tickets_calcule",
    "ecart",
    "note",
    "created_at",
    "updated_at"
  ]
};

const RECETTES_COLUMNS = {
  recettes: [
    "recette_id",
    "recette_source_id",
    "nom",
    "parfum_code",
    "parfum_nom",
    "version",
    "annee_reference",
    "statut",
    "type_recette",
    "description",
    "volume_reference_l",
    "sucre_cible_g_l",
    "dilution_cible_pct",
    "temps_maceration_jours",
    "fabrication_note",
    "degustation_note",
    "note",
    "created_at",
    "updated_at"
  ],

  recettesIngredients: [
    "recette_ingredient_id",
    "recette_id",
    "ingredient_id",
    "nom_ingredient",
    "categorie",
    "quantite_par_litre_rhum",
    "unite",
    "ordre_affichage",
    "obligatoire",
    "note",
    "created_at",
    "updated_at"
  ],

  ingredients: [
    "ingredient_id",
    "nom",
    "categorie",
    "unite_defaut",
    "actif",
    "note",
    "created_at",
    "updated_at"
  ],

  cuveesResume: [
    "cuvee_id",
    "recette_id",
    "recette_source_id",
    "nom",
    "parfum_code",
    "parfum_nom",
    "version",
    "annee_production",
    "type_cuvee",
    "statut",
    "date_lancement",
    "date_archivage",
    "volume_rhum_l",
    "volume_final_estime_l",
    "dilution_pct_estimee",
    "pertes_l",
    "nombre_bouteilles_50",
    "nombre_bouteilles_20",
    "nombre_bouteilles_total",
    "cout_ingredients_specifiques",
    "cout_matieres_globales",
    "cout_total",
    "cout_unitaire_50_estime",
    "prix_vente_50_ttc",
    "prix_vente_20_ttc",
    "marge_brute_50_estimee",
    "note_fabrication",
    "note_degustation",
    "created_at",
    "updated_at"
  ],

  cuveesIngredientsReels: [
    "cuvee_ingredient_id",
    "cuvee_id",
    "recette_id",
    "ingredient_id",
    "nom_ingredient",
    "categorie",
    "quantite_prevue",
    "quantite_reelle",
    "unite",
    "cout_total_reel",
    "fournisseur",
    "note",
    "created_at",
    "updated_at"
  ],

  matieresPremieres: [
    "matiere_id",
    "nom",
    "categorie",
    "unite_stock",
    "actif",
    "note",
    "created_at",
    "updated_at"
  ],

  matieresLotsResume: [
    "lot_id",
    "matiere_id",
    "nom_lot",
    "nom_matiere",
    "categorie",
    "fournisseur",
    "date_achat",
    "quantite_initiale",
    "quantite_restante",
    "unite",
    "cout_total",
    "cout_unitaire",
    "statut",
    "facture_reference",
    "note",
    "created_at",
    "updated_at"
  ],

  cuveesMatieresConsommees: [
    "conso_id",
    "cuvee_id",
    "lot_id",
    "matiere_id",
    "nom_matiere",
    "categorie",
    "quantite_consommee",
    "unite",
    "cout_unitaire_snapshot",
    "cout_total_impute",
    "note",
    "created_at",
    "updated_at"
  ],

  mouvementsMatieres: [
    "mouvement_matiere_id",
    "lot_id",
    "matiere_id",
    "type_mouvement",
    "source_type",
    "source_id",
    "cuvee_id",
    "date_mouvement",
    "nom_matiere",
    "categorie",
    "quantite",
    "unite",
    "cout_unitaire_snapshot",
    "cout_total_snapshot",
    "note",
    "created_at",
    "updated_at"
  ]
};

const HOME_HISTORICAL_SOURCE = "SAISIE_HISTORIQUE";

const HOME_INITIAL_STOCK_MOVEMENT_TYPES = [
  "preparation_initiale",
  "stock_initial",
  "preparation_stock",
  "initial_stock",
  "entree_initiale",
  "preparation"
];