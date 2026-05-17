(() => {
  "use strict";

  const CACHE_CATALOGUE = "lugdurum_catalogue_cache";
  const CACHE_OFFRES = "lugdurum_offres_vente_cache";

  const state = {
    catalogue: [],
    offres: []
  };

  const els = {
    activeCount: document.getElementById("catalogueActiveCount"),
    offersCount: document.getElementById("catalogueOffersCount"),
    list: document.getElementById("catalogueList"),
    status: document.getElementById("catalogueStatus")
  };

  const api = () => window.LugdurumAPI || null;

  const readJson = (key, fallback = []) => {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  };

  const writeJson = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const escapeAttr = (value) =>
    escapeHtml(value).replaceAll("`", "&#096;");

  const toNumber = (value, fallback = 0) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;

    const number = Number(
      String(value ?? "")
        .trim()
        .replace(/\s/g, "")
        .replace(",", ".")
    );

    return Number.isFinite(number) ? number : fallback;
  };

  const toBoolean = (value, fallback = false) => {
    if (value === true || value === false) return value;
    if (typeof value === "number") return value !== 0;

    const normalized = String(value ?? "")
      .trim()
      .toLowerCase();

    if (!normalized) return fallback;

    if (["true", "vrai", "oui", "yes", "1", "x", "actif"].includes(normalized)) {
      return true;
    }

    if (["false", "faux", "non", "no", "0", "inactif"].includes(normalized)) {
      return false;
    }

    return fallback;
  };

  const normalizeKey = (value) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const formatCurrency = (value) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(value || 0);

  const getProductImageSrc = (product) =>
    product.image_src ||
    `./assets/parfums/${String(product.parfum_code).toLowerCase()}.webp`;

  const normalizeProduct = (raw, index) => {
    const code = String(raw.parfum_code || "")
      .trim()
      .toUpperCase();

    const formatCl = toNumber(raw.format_cl, 0);

    return {
      sku_id: String(raw.sku_id || `${code}_${formatCl}`).trim(),
      parfum_code: code,
      parfum_nom: String(raw.parfum_nom || code).trim(),
      format_cl: formatCl,
      gamme_tarif: String(raw.gamme_tarif || "").trim(),
      vendable_seul: toBoolean(raw.vendable_seul, false),
      composable_coffret: toBoolean(raw.composable_coffret, false),
      cout_revient: toNumber(raw.cout_revient, 0),
      actif: toBoolean(raw.actif, false),
      visible_webapp: Object.prototype.hasOwnProperty.call(raw, "visible_webapp")
        ? toBoolean(raw.visible_webapp, true)
        : true,
      ordre_affichage: toNumber(raw.ordre_affichage, 1000 + index),
      note: String(raw.note || "").trim(),
      image_src: String(raw.image_src || "").trim()
    };
  };

  const normalizeOffer = (raw, index) => ({
    offre_id: String(raw.offre_id || "").trim(),
    libelle: String(raw.libelle || raw.offre_id || "").trim(),
    type_offre: String(raw.type_offre || "").trim().toLowerCase(),
    format_cl: toNumber(raw.format_cl, 0),
    gamme_tarif: String(raw.gamme_tarif || "").trim(),
    quantite_bouteilles: toNumber(raw.quantite_bouteilles, 0),
    prix_ttc: toNumber(raw.prix_ttc, 0),
    actif: toBoolean(raw.actif, false),
    ordre_affichage: toNumber(raw.ordre_affichage, 1000 + index),
    supplement_parfum_code: String(raw.supplement_parfum_code || "")
      .trim()
      .toUpperCase(),
    supplement_unitaire_ttc: toNumber(raw.supplement_unitaire_ttc, 0)
  });

  const findBottleOffer = (product) => {
    const productGamme = normalizeKey(product.gamme_tarif);

    return state.offres.find((offer) => {
      return (
        offer.actif &&
        offer.type_offre === "bouteille" &&
        offer.format_cl === product.format_cl &&
        normalizeKey(offer.gamme_tarif) === productGamme
      );
    });
  };

  const setStatus = (message, type = "") => {
    if (!els.status) return;

    els.status.textContent = message;
    els.status.className = "catalogueStatus";

    if (type) {
      els.status.classList.add(type);
    }
  };

  const render = () => {
    const products = state.catalogue
      .filter((product) => product.actif)
      .filter((product) => product.visible_webapp !== false)
      .sort((a, b) => {
        const byOrder = a.ordre_affichage - b.ordre_affichage;
        if (byOrder !== 0) return byOrder;

        const byCode = a.parfum_code.localeCompare(b.parfum_code);
        if (byCode !== 0) return byCode;

        return b.format_cl - a.format_cl;
      });

    els.activeCount.textContent = String(
      products.filter((product) => product.actif).length
    );

    els.offersCount.textContent = String(
      state.offres.filter((offer) => offer.actif).length
    );

    if (!products.length) {
      els.list.innerHTML = `<p class="catalogueEmpty">Aucun produit trouvé.</p>`;
      return;
    }

    els.list.innerHTML = products
      .map((product) => {
        const offer = findBottleOffer(product);
        const statusClass = product.actif ? "isGreen" : "isRed";
        const statusLabel = product.actif ? "Actif" : "Inactif";
        const cardStatusClass = product.actif ? "isActive" : "isInactive";
        const imageSrc = getProductImageSrc(product);

        return `
          <article
            class="catalogueCard isVisual ${escapeAttr(cardStatusClass)}"
            style="--catalogue-visual: url('${escapeAttr(imageSrc)}')"
          >
            <div class="catalogueCardOverlay" aria-hidden="true"></div>

            <div class="catalogueCardHeader">
              <div class="catalogueCardTitle">
                <strong>${escapeHtml(product.parfum_code)} ${escapeHtml(product.format_cl)} cL</strong>
                <span>${escapeHtml(product.parfum_nom)}</span>
              </div>

              <strong class="catalogueAmount">
                ${offer ? escapeHtml(formatCurrency(offer.prix_ttc)) : "—"}
              </strong>
            </div>

            <div class="catalogueMeta">
              <span class="catalogueBadge ${escapeAttr(statusClass)}">
                ${escapeHtml(statusLabel)}
              </span>

              ${product.gamme_tarif ? `<span>${escapeHtml(product.gamme_tarif)}</span>` : ""}
              ${product.vendable_seul ? `<span>Vente unité</span>` : ""}
              ${product.composable_coffret ? `<span>Coffret</span>` : ""}
              ${product.cout_revient ? `<span>Coût ${escapeHtml(formatCurrency(product.cout_revient))}</span>` : ""}
            </div>

            ${product.note ? `<p class="catalogueNote">${escapeHtml(product.note)}</p>` : ""}
          </article>
        `;
      })
      .join("");
  };

  const loadData = async () => {
    state.catalogue = readJson(CACHE_CATALOGUE, []).map(normalizeProduct);
    state.offres = readJson(CACHE_OFFRES, []).map(normalizeOffer);

    render();

    try {
      if (!api()?.getCatalogue || !api()?.getOffresVente) {
        throw new Error("API catalogue indisponible.");
      }

      const [catalogue, offres] = await Promise.all([
        api().getCatalogue(),
        api().getOffresVente()
      ]);

      state.catalogue = catalogue.map(normalizeProduct);
      state.offres = offres.map(normalizeOffer);

      writeJson(CACHE_CATALOGUE, state.catalogue);
      writeJson(CACHE_OFFRES, state.offres);

      setStatus("");
      render();
    } catch (error) {
      setStatus(`Données locales affichées : ${error.message}`, "isError");
    }
  };

  loadData();
})();