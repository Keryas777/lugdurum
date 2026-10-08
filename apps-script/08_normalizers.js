/************************************************************
 * 08_normalizers.gs
 * ----------------------------------------------------------
 * Normalisation des données lues / manipulées par l’API.
 *
 * Objectif :
 * - transformer les valeurs Google Sheets en objets JS propres ;
 * - sécuriser les nombres, booléens, dates ISO, JSON stocké en cellule ;
 * - harmoniser les noms logiques utilisés côté frontend ;
 * - garder la compatibilité avec les anciens champs déjà présents.
 *
 * Ce fichier ne lit pas et n’écrit pas directement dans Sheets.
 * Il prépare seulement les données.
 ************************************************************/

var NORMALIZERS_VERSION = "V16_NORMALIZERS_SPLIT";

/* ==========================================================
   Dispatch principal
   ========================================================== */

function normalizeRowsForTable(tableKey, rows) {
  return normalizeSheetRows_(tableKey, rows);
}

function normalizeRowsForSheetKey(tableKey, rows) {
  return normalizeSheetRows_(tableKey, rows);
}

function normalizeSheetRows(tableKey, rows) {
  return normalizeSheetRows_(tableKey, rows);
}

function normalizeSheetRows_(tableKey, rows) {
  var safeRows = normalizersArray_(rows);

  return safeRows.map(function(row, index) {
    return normalizeSheetRow_(tableKey, row, index);
  });
}

function normalizeSheetRow(tableKey, row, index) {
  return normalizeSheetRow_(tableKey, row, index || 0);
}

function normalizeSheetRow_(tableKey, row, index) {
  var key = normalizersNormalizeTableKey_(tableKey);

  if (key === "inscriptions" || key === "inscriptions_evenements") {
    return normalizeInscriptionEvenementRow(row, index);
  }

  if (key === "missions" || key === "missions_vente" || key === "events") {
    return normalizeMissionVenteRow(row, index);
  }

  if (
    key === "missionsstock" ||
    key === "missions_stock" ||
    key === "stockmissions" ||
    key === "stock_missions"
  ) {
    return normalizeMissionStockRow(row, index);
  }

  if (
    key === "journees" ||
    key === "journees_vente" ||
    key === "journeesvente"
  ) {
    return normalizeJourneeVenteRow(row, index);
  }

  if (
    key === "catalogue" ||
    key === "produits" ||
    key === "products"
  ) {
    return normalizeCatalogueRow(row, index);
  }

  if (
    key === "offresvente" ||
    key === "offres_vente" ||
    key === "offers"
  ) {
    return normalizeOffreVenteRow(row, index);
  }

  if (key === "transactions") {
    return normalizeTransactionRow(row, index);
  }

  if (
    key === "venteslignes" ||
    key === "ventes_lignes" ||
    key === "saleslines"
  ) {
    return normalizeVenteLigneRow(row, index);
  }

  if (
    key === "mouvementsstock" ||
    key === "mouvements_stock" ||
    key === "stockmovements"
  ) {
    return normalizeMouvementStockRow(row, index);
  }

  if (key === "frais" || key === "expenses") {
    return normalizeFraisRow(row, index);
  }

  if (
    key === "stockpreparations" ||
    key === "stock_preparations"
  ) {
    return normalizeStockPreparationRow(row, index);
  }

  if (
    key === "stockpreparationlines" ||
    key === "stock_preparation_lignes" ||
    key === "stock_preparation_lines"
  ) {
    return normalizeStockPreparationLineRow(row, index);
  }

  if (key === "clients") {
    return normalizeClientRow(row, index);
  }

  if (key === "commandespro" || key === "commandes_pro") {
    return normalizeCommandeProRow(row, index);
  }

  if (
    key === "commandesprolignes" ||
    key === "commandes_pro_lignes"
  ) {
    return normalizeCommandeProLigneRow(row, index);
  }

  if (key === "documents") {
    return normalizeDocumentRow(row, index);
  }

  if (key === "referentiel" || key === "référentiel") {
    return normalizeReferentielRow(row, index);
  }

  if (key === "recettes") {
    return normalizeRecetteRow(row, index);
  }

  if (
    key === "recetteslignes" ||
    key === "recettes_lignes" ||
    key === "recette_lignes"
  ) {
    return normalizeRecetteLigneRow(row, index);
  }

  return normalizeGenericRow(row);
}

/* ==========================================================
   Normalizers métier
   ========================================================== */

function normalizeInscriptionEvenementRow(row, index) {
  row = normalizeGenericRow(row);

  var paiementStatut = normalizersString_(row.paiement_statut || "A_ENVOYER");
  var paiementStatutLabel =
    normalizersString_(row.paiement_statut_label) ||
    normalizersPaymentStatusLabel_(paiementStatut);

  var vendeursPrevus = normalizersParseJsonArray_(row.vendeurs_prevus);
  var vendeursPrevusNoms = normalizersString_(row.vendeurs_prevus_noms);

  return normalizersCleanObject_({
    inscription_id: normalizersString_(row.inscription_id),
    nom: normalizersString_(row.nom || row.name),
    type_evenement: normalizersString_(row.type_evenement || row.type),
    type_evenement_label: normalizersString_(row.type_evenement_label),
    date_debut: normalizersIsoDate_(row.date_debut || row.start_date),
    date_fin: normalizersIsoDate_(row.date_fin || row.end_date || row.date_debut),
    horaires: normalizersString_(row.horaires),
    mise_en_place: normalizersString_(row.mise_en_place),
    ville: normalizersString_(row.ville),
    lieu: normalizersString_(row.lieu),
    adresse: normalizersString_(row.adresse),
    statut: normalizersString_(row.statut || "A_CONTACTER"),
    prix_emplacement: normalizersNumber_(row.prix_emplacement, 0),

    dossier_envoye: normalizersBoolean_(row.dossier_envoye, false),
    date_dossier_envoye: normalizersIsoDate_(row.date_dossier_envoye),
    acceptation: normalizersBoolean_(row.acceptation, false),
    date_acceptation: normalizersIsoDate_(row.date_acceptation),

    paiement_statut: paiementStatut,
    paiement_statut_label: paiementStatutLabel,
    caution: normalizersString_(row.caution),

    table_fournie: normalizersBoolean_(row.table_fournie, false),
    barnum_fourni: normalizersBoolean_(row.barnum_fourni, false),
    chaises_fournies: normalizersBoolean_(row.chaises_fournies, false),
    eclairage_fourni: normalizersBoolean_(row.eclairage_fourni, false),
    electricite_fournie: normalizersBoolean_(row.electricite_fournie, false),

    responsable_user_id: normalizersString_(row.responsable_user_id),
    responsable_nom: normalizersString_(row.responsable_nom),

    vendeurs_prevus: vendeursPrevus,
    vendeurs_prevus_noms: vendeursPrevusNoms,

    contact_nom: normalizersString_(row.contact_nom),
    contact_mail: normalizersString_(row.contact_mail),
    contact_tel: normalizersString_(row.contact_tel),
    commentaire: normalizersString_(row.commentaire),

    evenement_id: normalizersString_(row.evenement_id || row.mission_id),
    calendar_event_id: normalizersString_(row.calendar_event_id),
    calendar_statut: normalizersString_(row.calendar_statut),
    calendar_payload: normalizersParseJsonObject_(row.calendar_payload),

    source: normalizersString_(row.source),
    created_at: normalizersIsoDateTime_(row.created_at),
    updated_at: normalizersIsoDateTime_(row.updated_at),

    _row_index: index
  });
}

function normalizeMissionVenteRow(row, index) {
  row = normalizeGenericRow(row);

  var vendeursPrevus = normalizersParseJsonArray_(row.vendeurs_prevus);

  return normalizersCleanObject_({
    mission_id: normalizersString_(row.mission_id || row.evenement_id),
    inscription_id: normalizersString_(row.inscription_id),
    nom: normalizersString_(row.nom || row.name),
    date_debut: normalizersIsoDate_(row.date_debut || row.date),
    date_fin: normalizersIsoDate_(row.date_fin || row.date_debut || row.date),
    lieu: normalizersString_(row.lieu),
    ville: normalizersString_(row.ville),
    adresse: normalizersString_(row.adresse),
    horaires: normalizersString_(row.horaires),
    mise_en_place: normalizersString_(row.mise_en_place),
    type_evenement: normalizersString_(row.type_evenement),
    type_evenement_label: normalizersString_(row.type_evenement_label),
    duree_type: normalizersString_(row.duree_type),
    statut: normalizersString_(row.statut || "prevu"),

    vendeurs_prevus: vendeursPrevus,
    vendeurs_prevus_noms: normalizersString_(row.vendeurs_prevus_noms),
    responsable_user_id: normalizersString_(row.responsable_user_id),

    ca_total_ttc: normalizersNumber_(row.ca_total_ttc, 0),
    total_frais_ttc: normalizersNumber_(row.total_frais_ttc, 0),

    source: normalizersString_(row.source),
    note: normalizersString_(row.note),
    created_at: normalizersIsoDateTime_(row.created_at),
    updated_at: normalizersIsoDateTime_(row.updated_at),
    closed_at: normalizersIsoDateTime_(row.closed_at),

    _row_index: index
  });
}

function normalizeMissionStockRow(row, index) {
  row = normalizeGenericRow(row);

  return normalizersCleanObject_({
    mission_id: normalizersString_(row.mission_id),
    evenement_id: normalizersString_(row.evenement_id || row.event_id),
    nom: normalizersString_(row.nom || row.name),
    date_debut: normalizersIsoDate_(row.date_debut || row.date),
    date_fin: normalizersIsoDate_(row.date_fin || row.date_debut || row.date),
    statut: normalizersString_(row.statut || "stock_a_preparer"),
    stock_prepare: normalizersBoolean_(row.stock_prepare, false),

    responsable_user_id: normalizersString_(row.responsable_user_id),
    journees_count: normalizersNumber_(row.journees_count, 0),

    total_bouteilles_preparees: normalizersNumber_(row.total_bouteilles_preparees, 0),
    total_50cl_prepare: normalizersNumber_(row.total_50cl_prepare, 0),
    total_20cl_prepare: normalizersNumber_(row.total_20cl_prepare, 0),
    parfums_prepare_count: normalizersNumber_(row.parfums_prepare_count, 0),

    ca_total_ttc: normalizersNumber_(row.ca_total_ttc, 0),
    total_frais_ttc: normalizersNumber_(row.total_frais_ttc, 0),

    source: normalizersString_(row.source),
    note: normalizersString_(row.note),
    created_at: normalizersIsoDateTime_(row.created_at),
    updated_at: normalizersIsoDateTime_(row.updated_at),
    closed_at: normalizersIsoDateTime_(row.closed_at),

    _row_index: index
  });
}

function normalizeJourneeVenteRow(row, index) {
  row = normalizeGenericRow(row);

  return normalizersCleanObject_({
    journee_id: normalizersString_(row.journee_id),
    mission_id: normalizersString_(row.mission_id),
    evenement_id: normalizersString_(row.evenement_id || row.mission_id),
    stock_mission_id: normalizersString_(row.stock_mission_id || row.mission_stock_id),
    mission_stock_id: normalizersString_(row.mission_stock_id || row.stock_mission_id),
    date: normalizersIsoDate_(row.date || row.date_debut),
    jour_label: normalizersString_(row.jour_label || row.label),
    statut: normalizersString_(row.statut || "prevu"),

    meteo: normalizersString_(row.meteo),
    affluence_ressentie: normalizersString_(row.affluence_ressentie),

    ca_total_ttc: normalizersNumber_(row.ca_total_ttc, 0),
    total_frais_ttc: normalizersNumber_(row.total_frais_ttc, 0),
    nb_transactions: normalizersNumber_(row.nb_transactions, 0),

    source: normalizersString_(row.source),
    note: normalizersString_(row.note),
    created_at: normalizersIsoDateTime_(row.created_at),
    updated_at: normalizersIsoDateTime_(row.updated_at),
    started_at: normalizersIsoDateTime_(row.started_at),
    closed_at: normalizersIsoDateTime_(row.closed_at),

    _row_index: index
  });
}

function normalizeCatalogueRow(row, index) {
  row = normalizeGenericRow(row);

  var parfumCode = normalizersString_(row.parfum_code).toUpperCase();
  var formatCl = normalizersNumber_(row.format_cl, 0);

  return normalizersCleanObject_({
    sku_id: normalizersString_(row.sku_id) || parfumCode + "_" + String(formatCl),
    parfum_code: parfumCode,
    parfum_nom: normalizersString_(row.parfum_nom || parfumCode),
    format_cl: formatCl,
    gamme_tarif: normalizersString_(row.gamme_tarif),
    vendable_seul: normalizersBoolean_(row.vendable_seul, false),
    composable_coffret: normalizersBoolean_(row.composable_coffret, false),
    cout_revient: normalizersNumber_(row.cout_revient, 0),
    actif: normalizersHasOwn_(row, "actif")
      ? normalizersBoolean_(row.actif, false)
      : true,
    visible_webapp: normalizersHasOwn_(row, "visible_webapp")
      ? normalizersBoolean_(row.visible_webapp, true)
      : true,
    ordre_affichage: normalizersNumber_(row.ordre_affichage, 1000 + index),
    note: normalizersString_(row.note),
    image_src: normalizersString_(row.image_src),
    created_at: normalizersIsoDateTime_(row.created_at),
    updated_at: normalizersIsoDateTime_(row.updated_at),

    _row_index: index
  });
}

function normalizeOffreVenteRow(row, index) {
  row = normalizeGenericRow(row);

  return normalizersCleanObject_({
    offre_id: normalizersString_(row.offre_id),
    libelle: normalizersString_(row.libelle || row.offre_id),
    type_offre: normalizersString_(row.type_offre).toLowerCase(),
    format_cl: normalizersNumber_(row.format_cl, 0),
    gamme_tarif: normalizersString_(row.gamme_tarif),
    quantite_bouteilles: normalizersNumber_(row.quantite_bouteilles, 0),
    prix_ttc: normalizersNumber_(row.prix_ttc, 0),
    prix_ht: normalizersNumber_(row.prix_ht, normalizersNumber_(row.prix_ttc, 0)),
    taux_tva: normalizersNumber_(row.taux_tva, 0),
    regime_tva: normalizersString_(row.regime_tva),
    actif: normalizersHasOwn_(row, "actif")
      ? normalizersBoolean_(row.actif, false)
      : true,
    ordre_affichage: normalizersNumber_(row.ordre_affichage, 1000 + index),
    supplement_parfum_code: normalizersString_(row.supplement_parfum_code).toUpperCase(),
    supplement_unitaire_ttc: normalizersNumber_(row.supplement_unitaire_ttc, 0),
    note: normalizersString_(row.note),
    created_at: normalizersIsoDateTime_(row.created_at),
    updated_at: normalizersIsoDateTime_(row.updated_at),

    _row_index: index
  });
}

function normalizeTransactionRow(row, index) {
  row = normalizeGenericRow(row);

  var detailTicketRaw = row.detail_ticket;
  var detailTicketItems = normalizersParseJsonArray_(detailTicketRaw);

  return normalizersCleanObject_({
    transaction_id: normalizersString_(row.transaction_id || row.id),
    date_heure: normalizersIsoDateTime_(row.date_heure || row.created_at),
    mission_id: normalizersString_(row.mission_id),
    stock_mission_id: normalizersString_(row.stock_mission_id || row.mission_stock_id || row.mission_id),
    mission_stock_id: normalizersString_(row.mission_stock_id || row.stock_mission_id || row.mission_id),
    evenement_id: normalizersString_(row.evenement_id),
    journee_id: normalizersString_(row.journee_id),
    user_id: normalizersString_(row.user_id),

    mode_paiement: normalizersString_(row.mode_paiement),
    mode_paiement_label: normalizersString_(row.mode_paiement_label),
    paiement_provider: normalizersString_(row.paiement_provider),
    paiement_statut: normalizersString_(row.paiement_statut),
    sumup_foreign_tx_id: normalizersString_(row.sumup_foreign_tx_id),

    source: normalizersString_(row.source),
    source_id: normalizersString_(row.source_id),

    total_catalogue_ttc: normalizersNumber_(row.total_catalogue_ttc, 0),
    total_catalogue_ht: normalizersNumber_(row.total_catalogue_ht, 0),
    total_tva: normalizersNumber_(row.total_tva, 0),
    total_encaisse_ttc: normalizersNumber_(row.total_encaisse_ttc, 0),
    remise_totale: normalizersNumber_(row.remise_totale, 0),
    motif_remise: normalizersString_(row.motif_remise),

    statut: normalizersString_(row.statut || "validee"),
    note: normalizersString_(row.note),

    detail_ticket: normalizersSerializeJsonIfObject_(detailTicketRaw),
    detail_ticket_items: detailTicketItems,

    created_at: normalizersIsoDateTime_(row.created_at),
    updated_at: normalizersIsoDateTime_(row.updated_at),

    _row_index: index
  });
}

function normalizeVenteLigneRow(row, index) {
  row = normalizeGenericRow(row);

  return normalizersCleanObject_({
    ligne_id: normalizersString_(row.ligne_id),
    transaction_id: normalizersString_(row.transaction_id),
    mission_id: normalizersString_(row.mission_id),
    stock_mission_id: normalizersString_(row.stock_mission_id || row.mission_stock_id || row.mission_id),
    mission_stock_id: normalizersString_(row.mission_stock_id || row.stock_mission_id || row.mission_id),
    evenement_id: normalizersString_(row.evenement_id),
    journee_id: normalizersString_(row.journee_id),

    sku_id: normalizersString_(row.sku_id),
    parfum_code: normalizersString_(row.parfum_code).toUpperCase(),
    parfum_nom: normalizersString_(row.parfum_nom),
    format_cl: normalizersNumber_(row.format_cl, 0),

    quantite: normalizersNumber_(row.quantite, 0),
    type_vente: normalizersString_(row.type_vente),
    conditionnement: normalizersString_(row.conditionnement),
    offre_id: normalizersString_(row.offre_id),
    offre_libelle: normalizersString_(row.offre_libelle),

    prix_unitaire_ttc: normalizersNumber_(row.prix_unitaire_ttc, 0),
    prix_unitaire_ht: normalizersNumber_(row.prix_unitaire_ht, 0),
    taux_tva: normalizersNumber_(row.taux_tva, 0),
    montant_tva_ligne: normalizersNumber_(row.montant_tva_ligne, 0),
    total_catalogue_ligne_ttc: normalizersNumber_(row.total_catalogue_ligne_ttc, 0),
    total_catalogue_ligne_ht: normalizersNumber_(row.total_catalogue_ligne_ht, 0),
    cout_unitaire: normalizersNumber_(row.cout_unitaire, 0),
    marge_brute_ligne: normalizersNumber_(row.marge_brute_ligne, 0),

    source: normalizersString_(row.source),
    statut: normalizersString_(row.statut || "valide"),
    note: normalizersString_(row.note),
    created_at: normalizersIsoDateTime_(row.created_at),
    updated_at: normalizersIsoDateTime_(row.updated_at),

    _row_index: index
  });
}

function normalizeMouvementStockRow(row, index) {
  row = normalizeGenericRow(row);

  return normalizersCleanObject_({
    mouvement_stock_id: normalizersString_(row.mouvement_stock_id),
    date_heure: normalizersIsoDateTime_(row.date_heure || row.created_at),

    mission_id: normalizersString_(row.mission_id),
    stock_mission_id: normalizersString_(row.stock_mission_id || row.mission_stock_id || row.mission_id),
    mission_stock_id: normalizersString_(row.mission_stock_id || row.stock_mission_id || row.mission_id),
    journee_id: normalizersString_(row.journee_id),

    type_mouvement: normalizersString_(row.type_mouvement || row.type),
    sens: normalizersString_(row.sens),

    sku_id: normalizersString_(row.sku_id),
    parfum_code: normalizersString_(row.parfum_code).toUpperCase(),
    parfum_nom: normalizersString_(row.parfum_nom),
    format_cl: normalizersNumber_(row.format_cl, 0),
    quantite: normalizersNumber_(row.quantite, 0),

    source: normalizersString_(row.source),
    source_id: normalizersString_(row.source_id),
    transaction_id: normalizersString_(row.transaction_id),
    ligne_id: normalizersString_(row.ligne_id),

    statut: normalizersString_(row.statut || "valide"),
    note: normalizersString_(row.note),
    user_id: normalizersString_(row.user_id),
    created_at: normalizersIsoDateTime_(row.created_at),
    updated_at: normalizersIsoDateTime_(row.updated_at),

    _row_index: index
  });
}

function normalizeFraisRow(row, index) {
  row = normalizeGenericRow(row);

  return normalizersCleanObject_({
    frais_id: normalizersString_(row.frais_id),
    date: normalizersIsoDate_(row.date),
    date_heure: normalizersIsoDateTime_(row.date_heure || row.created_at),

    mission_id: normalizersString_(row.mission_id),
    stock_mission_id: normalizersString_(row.stock_mission_id || row.mission_stock_id || row.mission_id),
    mission_stock_id: normalizersString_(row.mission_stock_id || row.stock_mission_id || row.mission_id),
    evenement_id: normalizersString_(row.evenement_id),
    journee_id: normalizersString_(row.journee_id),

    categorie: normalizersString_(row.categorie || "AUTRE"),
    categorie_label: normalizersString_(row.categorie_label || row.categorie),
    libelle: normalizersString_(row.libelle),
    montant: normalizersNumber_(row.montant, normalizersNumber_(row.montant_ttc, 0)),
    montant_ttc: normalizersNumber_(row.montant_ttc, normalizersNumber_(row.montant, 0)),

    paye_par: normalizersString_(row.paye_par),
    paye_par_nom: normalizersString_(row.paye_par_nom),
    mode_paiement: normalizersString_(row.mode_paiement),
    mode_paiement_label: normalizersString_(row.mode_paiement_label),
    justificatif_url: normalizersString_(row.justificatif_url),

    statut: normalizersString_(row.statut || "valide"),
    note: normalizersString_(row.note),
    user_id: normalizersString_(row.user_id),
    source: normalizersString_(row.source),
    created_at: normalizersIsoDateTime_(row.created_at),
    updated_at: normalizersIsoDateTime_(row.updated_at),

    _row_index: index
  });
}

/* ==========================================================
   Stock preparation / pro / documents / recettes
   ========================================================== */

function normalizeStockPreparationRow(row, index) {
  row = normalizeGenericRow(row);

  return normalizersCleanObject_({
    preparation_id: normalizersString_(row.preparation_id),
    mission_id: normalizersString_(row.mission_id),
    stock_mission_id: normalizersString_(row.stock_mission_id || row.mission_stock_id || row.mission_id),
    journee_id: normalizersString_(row.journee_id),
    statut: normalizersString_(row.statut || "brouillon"),
    note: normalizersString_(row.note),
    user_id: normalizersString_(row.user_id),
    created_at: normalizersIsoDateTime_(row.created_at),
    updated_at: normalizersIsoDateTime_(row.updated_at),
    _row_index: index
  });
}

function normalizeStockPreparationLineRow(row, index) {
  row = normalizeGenericRow(row);

  return normalizersCleanObject_({
    line_id: normalizersString_(row.line_id || row.ligne_id),
    ligne_id: normalizersString_(row.ligne_id || row.line_id),
    preparation_id: normalizersString_(row.preparation_id),
    mission_id: normalizersString_(row.mission_id),
    stock_mission_id: normalizersString_(row.stock_mission_id || row.mission_stock_id || row.mission_id),
    journee_id: normalizersString_(row.journee_id),
    sku_id: normalizersString_(row.sku_id),
    parfum_code: normalizersString_(row.parfum_code).toUpperCase(),
    parfum_nom: normalizersString_(row.parfum_nom),
    format_cl: normalizersNumber_(row.format_cl, 0),
    quantite: normalizersNumber_(row.quantite, 0),
    statut: normalizersString_(row.statut || "valide"),
    note: normalizersString_(row.note),
    created_at: normalizersIsoDateTime_(row.created_at),
    updated_at: normalizersIsoDateTime_(row.updated_at),
    _row_index: index
  });
}

function normalizeClientRow(row, index) {
  row = normalizeGenericRow(row);

  return normalizersCleanObject_({
    client_id: normalizersString_(row.client_id),
    type_client: normalizersString_(row.type_client),
    nom: normalizersString_(row.nom),
    raison_sociale: normalizersString_(row.raison_sociale),
    siret: normalizersString_(row.siret),
    tva_intracom: normalizersString_(row.tva_intracom),
    email: normalizersString_(row.email || row.mail),
    telephone: normalizersString_(row.telephone || row.tel),
    adresse: normalizersString_(row.adresse),
    code_postal: normalizersString_(row.code_postal),
    ville: normalizersString_(row.ville),
    pays: normalizersString_(row.pays || "France"),
    note: normalizersString_(row.note),
    statut: normalizersString_(row.statut || "actif"),
    created_at: normalizersIsoDateTime_(row.created_at),
    updated_at: normalizersIsoDateTime_(row.updated_at),
    _row_index: index
  });
}

function normalizeCommandeProRow(row, index) {
  row = normalizeGenericRow(row);

  return normalizersCleanObject_({
    commande_id: normalizersString_(row.commande_id),
    client_id: normalizersString_(row.client_id),
    date_commande: normalizersIsoDate_(row.date_commande || row.date),
    statut: normalizersString_(row.statut || "brouillon"),
    total_ht: normalizersNumber_(row.total_ht, 0),
    total_tva: normalizersNumber_(row.total_tva, 0),
    total_ttc: normalizersNumber_(row.total_ttc, 0),
    mode_paiement: normalizersString_(row.mode_paiement),
    paiement_statut: normalizersString_(row.paiement_statut),
    note: normalizersString_(row.note),
    source: normalizersString_(row.source),
    created_at: normalizersIsoDateTime_(row.created_at),
    updated_at: normalizersIsoDateTime_(row.updated_at),
    _row_index: index
  });
}

function normalizeCommandeProLigneRow(row, index) {
  row = normalizeGenericRow(row);

  return normalizersCleanObject_({
    commande_ligne_id: normalizersString_(row.commande_ligne_id),
    commande_id: normalizersString_(row.commande_id),
    sku_id: normalizersString_(row.sku_id),
    parfum_code: normalizersString_(row.parfum_code).toUpperCase(),
    parfum_nom: normalizersString_(row.parfum_nom),
    format_cl: normalizersNumber_(row.format_cl, 0),
    quantite: normalizersNumber_(row.quantite, 0),
    prix_unitaire_ht: normalizersNumber_(row.prix_unitaire_ht, 0),
    prix_unitaire_ttc: normalizersNumber_(row.prix_unitaire_ttc, 0),
    taux_tva: normalizersNumber_(row.taux_tva, 0),
    total_ligne_ht: normalizersNumber_(row.total_ligne_ht, 0),
    total_ligne_ttc: normalizersNumber_(row.total_ligne_ttc, 0),
    note: normalizersString_(row.note),
    created_at: normalizersIsoDateTime_(row.created_at),
    updated_at: normalizersIsoDateTime_(row.updated_at),
    _row_index: index
  });
}

function normalizeDocumentRow(row, index) {
  row = normalizeGenericRow(row);

  return normalizersCleanObject_({
    document_id: normalizersString_(row.document_id),
    type_document: normalizersString_(row.type_document),
    client_id: normalizersString_(row.client_id),
    commande_id: normalizersString_(row.commande_id),
    numero_document: normalizersString_(row.numero_document),
    date_document: normalizersIsoDate_(row.date_document || row.date),
    statut: normalizersString_(row.statut),
    url: normalizersString_(row.url),
    total_ht: normalizersNumber_(row.total_ht, 0),
    total_tva: normalizersNumber_(row.total_tva, 0),
    total_ttc: normalizersNumber_(row.total_ttc, 0),
    note: normalizersString_(row.note),
    created_at: normalizersIsoDateTime_(row.created_at),
    updated_at: normalizersIsoDateTime_(row.updated_at),
    _row_index: index
  });
}

function normalizeReferentielRow(row, index) {
  row = normalizeGenericRow(row);

  return normalizersCleanObject_({
    referentiel_id: normalizersString_(row.referentiel_id || row.id),
    categorie: normalizersString_(row.categorie),
    code: normalizersString_(row.code),
    libelle: normalizersString_(row.libelle),
    valeur: row.valeur,
    actif: normalizersHasOwn_(row, "actif")
      ? normalizersBoolean_(row.actif, true)
      : true,
    ordre_affichage: normalizersNumber_(row.ordre_affichage, 1000 + index),
    note: normalizersString_(row.note),
    created_at: normalizersIsoDateTime_(row.created_at),
    updated_at: normalizersIsoDateTime_(row.updated_at),
    _row_index: index
  });
}

function normalizeRecetteRow(row, index) {
  row = normalizeGenericRow(row);

  return normalizersCleanObject_({
    recette_id: normalizersString_(row.recette_id),
    parfum_code: normalizersString_(row.parfum_code).toUpperCase(),
    parfum_nom: normalizersString_(row.parfum_nom),
    version: normalizersString_(row.version),
    statut: normalizersString_(row.statut || "brouillon"),
    volume_base_cl: normalizersNumber_(row.volume_base_cl, 0),
    alcool_base: normalizersString_(row.alcool_base),
    degre_base: normalizersNumber_(row.degre_base, 0),
    degre_final_estime: normalizersNumber_(row.degre_final_estime, 0),
    note: normalizersString_(row.note),
    created_at: normalizersIsoDateTime_(row.created_at),
    updated_at: normalizersIsoDateTime_(row.updated_at),
    _row_index: index
  });
}

function normalizeRecetteLigneRow(row, index) {
  row = normalizeGenericRow(row);

  return normalizersCleanObject_({
    recette_ligne_id: normalizersString_(row.recette_ligne_id || row.ligne_id),
    recette_id: normalizersString_(row.recette_id),
    ingredient: normalizersString_(row.ingredient),
    categorie: normalizersString_(row.categorie),
    quantite: normalizersNumber_(row.quantite, 0),
    unite: normalizersString_(row.unite),
    ordre_affichage: normalizersNumber_(row.ordre_affichage, 1000 + index),
    note: normalizersString_(row.note),
    created_at: normalizersIsoDateTime_(row.created_at),
    updated_at: normalizersIsoDateTime_(row.updated_at),
    _row_index: index
  });
}

/* ==========================================================
   Normalizer générique
   ========================================================== */

function normalizeGenericRow(row) {
  var output = {};

  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return output;
  }

  Object.keys(row).forEach(function(key) {
    var safeKey = String(key || "").trim();

    if (!safeKey) return;

    output[safeKey] = row[key];
  });

  return output;
}

/* ==========================================================
   Helpers publics compatibles anciens noms
   ========================================================== */

function normalizeBoolean(value, fallback) {
  return normalizersBoolean_(value, fallback);
}

function normalizeNumber(value, fallback) {
  return normalizersNumber_(value, fallback);
}

function normalizeString(value) {
  return normalizersString_(value);
}

function normalizeIsoDate(value) {
  return normalizersIsoDate_(value);
}

function normalizeIsoDateTime(value) {
  return normalizersIsoDateTime_(value);
}

function parseJsonCell(value, fallback) {
  var parsed = normalizersParseJson_(value, fallback);

  return parsed;
}

function parseJsonArrayCell(value) {
  return normalizersParseJsonArray_(value);
}

function parseJsonObjectCell(value) {
  return normalizersParseJsonObject_(value);
}

function normalizeCoreDataPayload(coreData) {
  return normalizeCoreDataPayload_(coreData);
}

function normalizeCoreDataPayload_(coreData) {
  coreData = coreData || {};

  return {
    inscriptions: normalizeSheetRows_("inscriptions", coreData.inscriptions || coreData.inscriptions_evenements || []),
    missions: normalizeSheetRows_("missions", coreData.missions || coreData.missions_vente || coreData.events || []),
    missions_vente: normalizeSheetRows_("missions", coreData.missions_vente || coreData.missions || coreData.events || []),
    events: normalizeSheetRows_("missions", coreData.events || coreData.missions || coreData.missions_vente || []),
    missionsStock: normalizeSheetRows_("missionsStock", coreData.missionsStock || coreData.missions_stock || []),
    missions_stock: normalizeSheetRows_("missionsStock", coreData.missions_stock || coreData.missionsStock || []),
    journees: normalizeSheetRows_("journees", coreData.journees || coreData.journees_vente || []),
    journees_vente: normalizeSheetRows_("journees", coreData.journees_vente || coreData.journees || []),
    catalogue: normalizeSheetRows_("catalogue", coreData.catalogue || []),
    offresVente: normalizeSheetRows_("offresVente", coreData.offresVente || coreData.offres_vente || []),
    offres_vente: normalizeSheetRows_("offresVente", coreData.offres_vente || coreData.offresVente || []),
    transactions: normalizeSheetRows_("transactions", coreData.transactions || []),
    ventesLignes: normalizeSheetRows_("ventesLignes", coreData.ventesLignes || coreData.ventes_lignes || []),
    ventes_lignes: normalizeSheetRows_("ventesLignes", coreData.ventes_lignes || coreData.ventesLignes || []),
    mouvementsStock: normalizeSheetRows_("mouvementsStock", coreData.mouvementsStock || coreData.mouvements_stock || []),
    mouvements_stock: normalizeSheetRows_("mouvementsStock", coreData.mouvements_stock || coreData.mouvementsStock || []),
    frais: normalizeSheetRows_("frais", coreData.frais || [])
  };
}

/* ==========================================================
   Helpers internes
   ========================================================== */

function normalizersArray_(value) {
  return Array.isArray(value) ? value : [];
}

function normalizersHasOwn_(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizersString_(value) {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value).trim();
}

function normalizersNumber_(value, fallback) {
  var safeFallback =
    fallback === undefined || fallback === null
      ? 0
      : fallback;

  if (typeof value === "number" && isFinite(value)) {
    return value;
  }

  var normalized = String(value === null || value === undefined ? "" : value)
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");

  if (!normalized) {
    return safeFallback;
  }

  var number = Number(normalized);

  return isFinite(number) ? number : safeFallback;
}

function normalizersBoolean_(value, fallback) {
  var safeFallback =
    fallback === undefined || fallback === null
      ? false
      : fallback;

  if (value === true) return true;
  if (value === false) return false;

  if (typeof value === "number") {
    return value !== 0;
  }

  var normalized = normalizersString_(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (!normalized) return safeFallback;

  if (
    [
      "true",
      "vrai",
      "oui",
      "yes",
      "1",
      "x",
      "actif",
      "active",
      "valide",
      "validee",
      "ok"
    ].indexOf(normalized) >= 0
  ) {
    return true;
  }

  if (
    [
      "false",
      "faux",
      "non",
      "no",
      "0",
      "inactif",
      "inactive",
      "annule",
      "annulee"
    ].indexOf(normalized) >= 0
  ) {
    return false;
  }

  return safeFallback;
}

function normalizersIsoDate_(value) {
  if (!value) return "";

  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(
      value,
      Session.getScriptTimeZone(),
      "yyyy-MM-dd"
    );
  }

  var raw = normalizersString_(value);

  if (!raw) return "";

  var match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (match) {
    return match[1] + "-" + match[2] + "-" + match[3];
  }

  var date = new Date(raw);

  if (!isNaN(date.getTime())) {
    return Utilities.formatDate(
      date,
      Session.getScriptTimeZone(),
      "yyyy-MM-dd"
    );
  }

  return raw;
}

function normalizersIsoDateTime_(value) {
  if (!value) return "";

  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString();
  }

  var raw = normalizersString_(value);

  if (!raw) return "";

  var date = new Date(raw);

  if (!isNaN(date.getTime())) {
    return date.toISOString();
  }

  return raw;
}

function normalizersParseJson_(value, fallback) {
  var safeFallback =
    fallback === undefined
      ? null
      : fallback;

  if (value === null || value === undefined || value === "") {
    return safeFallback;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(String(value));
  } catch (error) {
    return safeFallback;
  }
}

function normalizersParseJsonArray_(value) {
  var parsed = normalizersParseJson_(value, []);

  return Array.isArray(parsed) ? parsed : [];
}

function normalizersParseJsonObject_(value) {
  var parsed = normalizersParseJson_(value, null);

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed;
  }

  return null;
}

function normalizersSerializeJsonIfObject_(value) {
  if (value === null || value === undefined) return "";

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function normalizersNormalizeTableKey_(value) {
  return normalizersString_(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-\s]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function normalizersPaymentStatusLabel_(value) {
  var key = normalizersString_(value);

  if (key === "A_ENVOYER") return "À envoyer";
  if (key === "ENVOYE") return "Envoyé";
  if (key === "ENCAISSE") return "Encaissé";
  if (key === "PAYE") return "Payé";
  if (key === "SUMUP_LANCE") return "SumUp lancé";

  return key || "À envoyer";
}

function normalizersCleanObject_(object) {
  var output = {};

  Object.keys(object || {}).forEach(function(key) {
    var value = object[key];

    if (value === undefined) return;

    output[key] = value;
  });

  return output;
}