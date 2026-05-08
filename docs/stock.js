(() => {
  "use strict";

  /*
    V1 Stock journée :
    - Stock initial par SKU.
    - Ventes calculées depuis lugdurum_pending_transactions.
    - Réappro et ajustements enregistrés en local.
    - Ajustements possibles : dégustation, casse, perte/vol, cadeau, ajustement +, ajustement -.
    - Stock théorique = initial + réappro + ajustements - vendu.
    - Écart = stock compté - stock théorique.
    - Le stock compté peut être conservé pour le lendemain.
  */

  const JOURNEE_ACTIVE = {
    journee_id: "JOUR_SALAGNON_2026_05_04",
    mission_id: "MISSION_SALAGNON_2026",
    label: "Salagnon — J2",
    date_label: "lundi 04 mai 2026",
    user_id: "U_JEROME",
    vendeur: "Jérôme"
  };

  const NEXT_JOURNEE = {
    journee_id: "JOUR_SALAGNON_2026_05_05",
    mission_id: "MISSION_SALAGNON_2026",
    label: "Salagnon — J3",
    date_label: "mardi 05 mai 2026"
  };

  const CATALOGUE = [
    {
      sku_id: "AT_50",
      parfum_code: "AT",
      parfum_nom: "Abricot Tonka",
      format_cl: 50,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 30
    },
    {
      sku_id: "AT_20",
      parfum_code: "AT",
      parfum_nom: "Abricot Tonka",
      format_cl: 20,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 30
    },
    {
      sku_id: "MV_50",
      parfum_code: "MV",
      parfum_nom: "Mirabelle Vanille",
      format_cl: 50,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 40
    },
    {
      sku_id: "MV_20",
      parfum_code: "MV",
      parfum_nom: "Mirabelle Vanille",
      format_cl: 20,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 40
    },
    {
      sku_id: "CG_50",
      parfum_code: "CG",
      parfum_nom: "Citron Gingembre",
      format_cl: 50,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 50
    },
    {
      sku_id: "CG_20",
      parfum_code: "CG",
      parfum_nom: "Citron Gingembre",
      format_cl: 20,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 50
    },
    {
      sku_id: "OC_50",
      parfum_code: "OC",
      parfum_nom: "Orange Cannelle",
      format_cl: 50,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 60
    },
    {
      sku_id: "OC_20",
      parfum_code: "OC",
      parfum_nom: "Orange Cannelle",
      format_cl: 20,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 60
    },
    {
      sku_id: "PR_50",
      parfum_code: "PR",
      parfum_nom: "Pomelo Romarin",
      format_cl: 50,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 70
    },
    {
      sku_id: "PR_20",
      parfum_code: "PR",
      parfum_nom: "Pomelo Romarin",
      format_cl: 20,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 70
    },
    {
      sku_id: "FP_50",
      parfum_code: "FP",
      parfum_nom: "Framboise Passion",
      format_cl: 50,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 80
    },
    {
      sku_id: "FP_20",
      parfum_code: "FP",
      parfum_nom: "Framboise Passion",
      format_cl: 20,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 80
    },
    {
      sku_id: "LP_50",
      parfum_code: "LP",
      parfum_nom: "Litchi Poivre de Sichuan",
      format_cl: 50,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 90
    },
    {
      sku_id: "LP_20",
      parfum_code: "LP",
      parfum_nom: "Litchi Poivre de Sichuan",
      format_cl: 20,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 90
    },
    {
      sku_id: "VT_50",
      parfum_code: "VT",
      parfum_nom: "Vanille Tonka",
      format_cl: 50,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 100
    },
    {
      sku_id: "VT_20",
      parfum_code: "VT",
      parfum_nom: "Vanille Tonka",
      format_cl: 20,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 100
    },
    {
      sku_id: "PE_50",
      parfum_code: "PE",
      parfum_nom: "Pain d'Épices",
      format_cl: 50,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 110
    },
    {
      sku_id: "PE_20",
      parfum_code: "PE",
      parfum_nom: "Pain d'Épices",
      format_cl: 20,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 110
    },
    {
      sku_id: "VB_50",
      parfum_code: "VB",
      parfum_nom: "Vanille Bleue",
      format_cl: 50,
      actif: true,
      visible_webapp: true,
      ordre_affichage: 120
    }
  ];

  const STORAGE_KEYS = {
    transactions: "lugdurum_pending_transactions",
    stockDay: `lugdurum_stock_day_${JOURNEE_ACTIVE.journee_id}`,
    movements: "lugdurum_stock_movements",
    tomorrowSeed: `lugdurum_stock_seed_${NEXT_JOURNEE.journee_id}`
  };

  const MOVEMENT_TYPES = {
    REAPPRO: {
      label: "Réappro",
      impact: 1
    },
    DEGUSTATION: {
      label: "Dégustation",
      impact: -1
    },
    CASSE: {
      label: "Casse",
      impact: -1
    },
    PERTE: {
      label: "Vol / perte",
      impact: -1
    },
    CADEAU: {
      label: "Cadeau",
      impact: -1
    },
    AJUSTEMENT_PLUS: {
      label: "Ajustement +",
      impact: 1
    },
    AJUSTEMENT_MOINS: {
      label: "Ajustement -",
      impact: -1
    }
  };

  const state = {
    filter: "ALL",
    stockRows: {},
    movements: []
  };

  const els = {
    stockList: document.getElementById("stockList"),
    summaryInitial: document.getElementById("summaryInitial"),
    summarySold: document.getElementById("summarySold"),
    summaryReappro: document.getElementById("summaryReappro"),
    summaryAdjustments: document.getElementById("summaryAdjustments"),
    summaryTheoretical: document.getElementById("summaryTheoretical"),
    summaryGap: document.getElementById("summaryGap"),
    summaryGapCard: document.getElementById("summaryGapCard"),
    stockGlobalStatus: document.getElementById("stockGlobalStatus"),
    stockStatusMessage: document.getElementById("stockStatusMessage"),
    saveStockBtn: document.getElementById("saveStockBtn"),
    reuseTomorrowBtn: document.getElementById("reuseTomorrowBtn"),
    closeDayBtn: document.getElementById("closeDayBtn")
  };

  const toNumber = (value) => {
    const number = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(number) ? number : 0;
  };

  const formatQty = (value) => {
    const number = toNumber(value);
    return Number.isInteger(number) ? String(number) : number.toFixed(2);
  };

  const readJson = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  };

  const writeJson = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
  };

  const getProducts = () =>
    CATALOGUE
      .filter((product) => product.actif)
      .filter((product) => product.visible_webapp)
      .sort((a, b) => {
        if (a.ordre_affichage !== b.ordre_affichage) {
          return a.ordre_affichage - b.ordre_affichage;
        }

        return b.format_cl - a.format_cl;
      });

  const ensureStockRows = () => {
    getProducts().forEach((product) => {
      if (!state.stockRows[product.sku_id]) {
        state.stockRows[product.sku_id] = {
          sku_id: product.sku_id,
          stock_initial: 0,
          stock_compte_fin: "",
          note: "",
          statut_stock: "non_compte",
          source_stock_initial: "manuel",
          updated_at: ""
        };
      }
    });
  };

  const getTransactions = () => readJson(STORAGE_KEYS.transactions, []);

  const getSoldBySku = () => {
    const map = new Map();

    getTransactions()
      .filter((transaction) => transaction.journee_id === JOURNEE_ACTIVE.journee_id)
      .filter((transaction) => transaction.statut !== "annulee")
      .forEach((transaction) => {
        const lines = Array.isArray(transaction.lignes) ? transaction.lignes : [];

        lines.forEach((line) => {
          const skuId = line.sku_id;
          const qty = toNumber(line.quantite);

          if (!skuId || qty <= 0) return;

          map.set(skuId, (map.get(skuId) || 0) + qty);
        });
      });

    return map;
  };

  const getMovementsForSku = (skuId) =>
    state.movements
      .filter((movement) => movement.journee_id === JOURNEE_ACTIVE.journee_id)
      .filter((movement) => movement.sku_id === skuId);

  const getMovementTotals = (skuId) => {
    const movements = getMovementsForSku(skuId);

    return movements.reduce(
      (totals, movement) => {
        const impact = toNumber(movement.impact_stock);

        if (movement.type_mouvement === "REAPPRO") {
          totals.reappro += impact;
        } else {
          totals.adjustments += impact;
        }

        totals.totalImpact += impact;

        return totals;
      },
      {
        reappro: 0,
        adjustments: 0,
        totalImpact: 0
      }
    );
  };

  const getRowComputed = (product, soldBySku) => {
    const saved = state.stockRows[product.sku_id] || {};
    const initial = toNumber(saved.stock_initial);
    const sold = soldBySku.get(product.sku_id) || 0;
    const movements = getMovementTotals(product.sku_id);
    const theoretical = initial + movements.reappro + movements.adjustments - sold;
    const countedRaw = saved.stock_compte_fin;
    const hasCounted = countedRaw !== "" && countedRaw !== null && countedRaw !== undefined;
    const counted = hasCounted ? toNumber(countedRaw) : "";
    const gap = hasCounted ? counted - theoretical : "";

    return {
      initial,
      sold,
      reappro: movements.reappro,
      adjustments: movements.adjustments,
      theoretical,
      counted,
      hasCounted,
      gap
    };
  };

  const getVisibleProducts = () => {
    const soldBySku = getSoldBySku();

    return getProducts().filter((product) => {
      if (state.filter === "50") return product.format_cl === 50;
      if (state.filter === "20") return product.format_cl === 20;

      if (state.filter === "GAPS") {
        const computed = getRowComputed(product, soldBySku);
        return computed.hasCounted && computed.gap !== 0;
      }

      return true;
    });
  };

  const saveStockState = () => {
    const payload = {
      mission_id: JOURNEE_ACTIVE.mission_id,
      journee_id: JOURNEE_ACTIVE.journee_id,
      rows: state.stockRows,
      updated_at: new Date().toISOString()
    };

    writeJson(STORAGE_KEYS.stockDay, payload);
  };

  const saveMovements = () => {
    writeJson(STORAGE_KEYS.movements, state.movements);
  };

  const setStatus = (message, type = "") => {
    els.stockStatusMessage.textContent = message;
    els.stockStatusMessage.className = "stockStatusMessage";

    if (type) {
      els.stockStatusMessage.classList.add(type);
    }
  };

  const getSummary = () => {
    const soldBySku = getSoldBySku();

    return getProducts().reduce(
      (summary, product) => {
        const computed = getRowComputed(product, soldBySku);

        summary.initial += computed.initial;
        summary.sold += computed.sold;
        summary.reappro += computed.reappro;
        summary.adjustments += computed.adjustments;
        summary.theoretical += computed.theoretical;

        if (computed.hasCounted) {
          summary.counted += computed.counted;
          summary.gap += computed.gap;
          summary.countedRows += 1;
        }

        summary.totalRows += 1;

        return summary;
      },
      {
        initial: 0,
        sold: 0,
        reappro: 0,
        adjustments: 0,
        theoretical: 0,
        counted: 0,
        gap: 0,
        countedRows: 0,
        totalRows: 0
      }
    );
  };

  const renderSummary = () => {
    const summary = getSummary();

    els.summaryInitial.textContent = formatQty(summary.initial);
    els.summarySold.textContent = formatQty(summary.sold);
    els.summaryReappro.textContent = formatQty(summary.reappro);
    els.summaryAdjustments.textContent = formatQty(summary.adjustments);
    els.summaryTheoretical.textContent = formatQty(summary.theoretical);
    els.summaryGap.textContent = formatQty(summary.gap);

    els.summaryGapCard.classList.toggle("hasGap", summary.gap !== 0);

    if (summary.countedRows === 0) {
      els.stockGlobalStatus.textContent = "Stock en cours";
    } else if (summary.countedRows < summary.totalRows) {
      els.stockGlobalStatus.textContent = `${summary.countedRows}/${summary.totalRows} comptés`;
    } else if (summary.gap === 0) {
      els.stockGlobalStatus.textContent = "Stock vérifié";
    } else {
      els.stockGlobalStatus.textContent = "Écart à vérifier";
    }
  };

  const renderTabs = () => {
    document.querySelectorAll(".stockTab").forEach((button) => {
      const isActive = button.dataset.filter === state.filter;
      button.classList.toggle("isActive", isActive);
    });
  };

  const renderMovementOptions = () =>
    Object.entries(MOVEMENT_TYPES)
      .map(([code, type]) => `<option value="${code}">${type.label}</option>`)
      .join("");

  const renderMovementHistory = (skuId) => {
    const movements = getMovementsForSku(skuId);

    if (movements.length === 0) {
      return "";
    }

    return `
      <div class="stockMovementHistory">
        ${movements
          .slice()
          .reverse()
          .map((movement) => {
            const impact = toNumber(movement.impact_stock);
            const sign = impact > 0 ? "+" : "";
            const type = MOVEMENT_TYPES[movement.type_mouvement];
            const label = type ? type.label : movement.type_mouvement;

            return `
              <span class="stockMoveChip ${impact >= 0 ? "positive" : "negative"}">
                ${label} ${sign}${formatQty(impact)}
              </span>
            `;
          })
          .join("")}
      </div>
    `;
  };

  const renderStockCard = (product, soldBySku) => {
    const saved = state.stockRows[product.sku_id] || {};
    const computed = getRowComputed(product, soldBySku);
    const gapClass = computed.hasCounted && computed.gap !== 0 ? "hasGap" : "";
    const gapLabel = computed.hasCounted ? formatQty(computed.gap) : "—";

    return `
      <article class="stockCard" data-sku="${product.sku_id}">
        <div class="stockCardHeader">
          <div class="stockProduct">
            <div class="stockProductCodeLine">
              <strong class="stockCode">${product.parfum_code}</strong>
              <span class="stockFormatBadge">${product.format_cl} cL</span>
            </div>
            <span class="stockProductName">${product.parfum_nom}</span>
          </div>

          <strong class="stockGapPill ${gapClass}">
            ${gapLabel}
          </strong>
        </div>

        <div class="stockMetrics">
          <div class="stockMetric">
            <span>Initial</span>
            <strong>${formatQty(computed.initial)}</strong>
          </div>

          <div class="stockMetric">
            <span>Vendu</span>
            <strong>${formatQty(computed.sold)}</strong>
          </div>

          <div class="stockMetric good">
            <span>Réappro</span>
            <strong>${computed.reappro > 0 ? "+" : ""}${formatQty(computed.reappro)}</strong>
          </div>

          <div class="stockMetric ${computed.adjustments < 0 ? "bad" : computed.adjustments > 0 ? "good" : ""}">
            <span>Ajust.</span>
            <strong>${computed.adjustments > 0 ? "+" : ""}${formatQty(computed.adjustments)}</strong>
          </div>

          <div class="stockMetric">
            <span>Théorique</span>
            <strong>${formatQty(computed.theoretical)}</strong>
          </div>

          <div class="stockMetric">
            <span>Compté</span>
            <strong>${computed.hasCounted ? formatQty(computed.counted) : "—"}</strong>
          </div>

          <div class="stockMetric ${computed.hasCounted && computed.gap !== 0 ? "bad" : computed.hasCounted ? "good" : ""}">
            <span>Écart</span>
            <strong>${gapLabel}</strong>
          </div>

          <div class="stockMetric">
            <span>SKU</span>
            <strong>${product.sku_id}</strong>
          </div>
        </div>

        <div class="stockInputs">
          <div class="stockFieldGrid">
            <label class="stockField">
              <span>Stock initial</span>
              <input
                type="number"
                inputmode="numeric"
                min="0"
                step="1"
                value="${saved.stock_initial ?? 0}"
                data-stock-field="stock_initial"
                data-sku="${product.sku_id}"
              />
            </label>

            <label class="stockField">
              <span>Stock compté</span>
              <input
                type="number"
                inputmode="numeric"
                min="0"
                step="1"
                placeholder="À compter"
                value="${saved.stock_compte_fin ?? ""}"
                data-stock-field="stock_compte_fin"
                data-sku="${product.sku_id}"
              />
            </label>
          </div>

          <div class="stockMovementBox">
            <p class="stockMovementTitle">Mouvement stock</p>

            <div class="stockMovementGrid">
              <label class="stockField">
                <span>Motif</span>
                <select data-movement-type data-sku="${product.sku_id}">
                  ${renderMovementOptions()}
                </select>
              </label>

              <label class="stockField">
                <span>Quantité</span>
                <input
                  type="number"
                  inputmode="numeric"
                  min="0"
                  step="1"
                  placeholder="0"
                  data-movement-qty
                  data-sku="${product.sku_id}"
                />
              </label>

              <label class="stockField stockMovementNote">
                <span>Note</span>
                <input
                  type="text"
                  placeholder="Optionnel"
                  data-movement-note
                  data-sku="${product.sku_id}"
                />
              </label>

              <button
                class="stockMovementBtn"
                type="button"
                data-add-movement
                data-sku="${product.sku_id}"
              >
                Ajouter
              </button>
            </div>

            ${renderMovementHistory(product.sku_id)}
          </div>
        </div>
      </article>
    `;
  };

  const renderStockList = () => {
    const soldBySku = getSoldBySku();
    const products = getVisibleProducts();

    if (products.length === 0) {
      els.stockList.innerHTML = `<p class="emptyStock">Aucun produit à afficher.</p>`;
      return;
    }

    els.stockList.innerHTML = products
      .map((product) => renderStockCard(product, soldBySku))
      .join("");
  };

  const renderAll = () => {
    renderTabs();
    renderSummary();
    renderStockList();
  };

  const updateStockField = (skuId, field, value) => {
    if (!state.stockRows[skuId]) return;

    if (field === "stock_initial") {
      state.stockRows[skuId][field] = Math.max(0, toNumber(value));
    }

    if (field === "stock_compte_fin") {
      state.stockRows[skuId][field] = value === "" ? "" : Math.max(0, toNumber(value));
    }

    state.stockRows[skuId].updated_at = new Date().toISOString();

    saveStockState();
    renderAll();
  };

  const addMovement = (skuId) => {
    const card = document.querySelector(`.stockCard[data-sku="${skuId}"]`);
    if (!card) return;

    const typeInput = card.querySelector("[data-movement-type]");
    const qtyInput = card.querySelector("[data-movement-qty]");
    const noteInput = card.querySelector("[data-movement-note]");

    const typeCode = typeInput.value;
    const movementType = MOVEMENT_TYPES[typeCode];
    const qty = Math.abs(toNumber(qtyInput.value));
    const note = noteInput.value.trim();

    if (!movementType || qty <= 0) {
      setStatus("Indique une quantité avant d’ajouter un mouvement.", "isError");
      return;
    }

    const impact = qty * movementType.impact;
    const now = new Date().toISOString();

    state.movements.push({
      mouvement_id: `MS_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      date_heure: now,
      mission_id: JOURNEE_ACTIVE.mission_id,
      journee_id: JOURNEE_ACTIVE.journee_id,
      sku_id: skuId,
      type_mouvement: typeCode,
      quantite: qty,
      impact_stock: impact,
      user_id: JOURNEE_ACTIVE.user_id,
      source: "WEBAPP_STOCK_LOCAL",
      note,
      created_at: now
    });

    qtyInput.value = "";
    noteInput.value = "";

    saveMovements();
    saveStockState();
    setStatus("Mouvement ajouté.", "isSuccess");
    renderAll();
  };

  const saveAll = () => {
    saveStockState();
    saveMovements();
    setStatus("Stock enregistré en local.", "isSuccess");
  };

  const getUncountedRows = () =>
    getProducts().filter((product) => {
      const row = state.stockRows[product.sku_id];
      return !row || row.stock_compte_fin === "" || row.stock_compte_fin === null || row.stock_compte_fin === undefined;
    });

  const reuseForTomorrow = () => {
    const uncountedRows = getUncountedRows();

    if (uncountedRows.length > 0) {
      setStatus(`Compte d’abord tous les produits avant de conserver pour demain. Restants : ${uncountedRows.length}.`, "isError");
      return;
    }

    const seedRows = {};

    getProducts().forEach((product) => {
      const row = state.stockRows[product.sku_id];

      seedRows[product.sku_id] = {
        sku_id: product.sku_id,
        stock_initial: toNumber(row.stock_compte_fin),
        stock_compte_fin: "",
        note: `Report depuis ${JOURNEE_ACTIVE.label}`,
        statut_stock: "non_compte",
        source_stock_initial: "reporte_jour_precedent",
        updated_at: new Date().toISOString()
      };
    });

    writeJson(STORAGE_KEYS.tomorrowSeed, {
      mission_id: NEXT_JOURNEE.mission_id,
      journee_id: NEXT_JOURNEE.journee_id,
      source_journee_id: JOURNEE_ACTIVE.journee_id,
      rows: seedRows,
      created_at: new Date().toISOString()
    });

    setStatus(`Stock compté conservé pour ${NEXT_JOURNEE.label}.`, "isSuccess");
  };

  const closeDay = () => {
    const uncountedRows = getUncountedRows();

    if (uncountedRows.length > 0) {
      setStatus(`Impossible de clôturer : ${uncountedRows.length} produit(s) non compté(s).`, "isError");
      return;
    }

    const summary = getSummary();
    const status = summary.gap === 0 ? "valide" : "ecart_a_verifier";

    getProducts().forEach((product) => {
      const computed = getRowComputed(product, getSoldBySku());
      state.stockRows[product.sku_id].statut_stock =
        computed.gap === 0 ? "valide" : "ecart_a_verifier";
      state.stockRows[product.sku_id].updated_at = new Date().toISOString();
    });

    saveStockState();

    writeJson(`lugdurum_day_status_${JOURNEE_ACTIVE.journee_id}`, {
      mission_id: JOURNEE_ACTIVE.mission_id,
      journee_id: JOURNEE_ACTIVE.journee_id,
      statut: "cloture",
      statut_stock: status,
      closed_at: new Date().toISOString()
    });

    setStatus(
      summary.gap === 0
        ? "Journée clôturée. Aucun écart de stock."
        : `Journée clôturée avec un écart total de ${formatQty(summary.gap)}.`,
      summary.gap === 0 ? "isSuccess" : "isError"
    );

    renderAll();
  };

  const loadInitialState = () => {
    const savedDay = readJson(STORAGE_KEYS.stockDay, null);
    const tomorrowSeed = readJson(`lugdurum_stock_seed_${JOURNEE_ACTIVE.journee_id}`, null);

    if (savedDay && savedDay.rows) {
      state.stockRows = savedDay.rows;
    } else if (tomorrowSeed && tomorrowSeed.rows) {
      state.stockRows = tomorrowSeed.rows;
    }

    state.movements = readJson(STORAGE_KEYS.movements, []);
    ensureStockRows();
  };

  document.addEventListener("click", (event) => {
    const filterButton = event.target.closest("[data-filter]");
    if (filterButton) {
      state.filter = filterButton.dataset.filter;
      renderAll();
      return;
    }

    const movementButton = event.target.closest("[data-add-movement]");
    if (movementButton) {
      addMovement(movementButton.dataset.sku);
    }
  });

  document.addEventListener("change", (event) => {
    const input = event.target.closest("[data-stock-field]");
    if (!input) return;

    updateStockField(input.dataset.sku, input.dataset.stockField, input.value);
  });

  els.saveStockBtn.addEventListener("click", saveAll);
  els.reuseTomorrowBtn.addEventListener("click", reuseForTomorrow);
  els.closeDayBtn.addEventListener("click", closeDay);

  loadInitialState();
  renderAll();
})();
