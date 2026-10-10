(function () {
  "use strict";

  // Identité du vendeur = préférence locale de CE navigateur/PWA.
  // N'est ni une connexion ni une autorisation d'accès aux données.
  const KEY = "lugdurum_current_user_id";
  const CACHE = "lugdurum_users_list_cache";
  // Repli initial fidèle à l'onglet utilisateurs, vérifié le 10/10/2026.
  // Dès que l'API serveur sait lire cet onglet, sa liste prévaut.
  const SEED = [
    { user_id: "U_JEROME", nom: "Jérôme", role: "admin", actif: true },
    { user_id: "U_ANTHONY", nom: "Anthony", role: "vendeur", actif: true },
    { user_id: "U_WILL", nom: "William", role: "vendeur", actif: true }
  ];

  const mounts = [];
  const validUsers = (rows) => (Array.isArray(rows) ? rows : [])
    .filter((u) => u && typeof u === "object")
    .map((u) => ({
      user_id: String(u.user_id || "").trim(),
      nom: String(u.nom || "").trim(),
      role: String(u.role || "").trim(),
      actif: !["false", "0", "non", "inactif"].includes(String(u.actif ?? true).trim().toLowerCase())
    }))
    .filter((u) => u.user_id && u.nom && u.actif);

  const fromCache = (() => {
    try { return JSON.parse(localStorage.getItem(CACHE) || "null"); }
    catch (_error) { return null; }
  })();
  let users = validUsers(fromCache);
  if (!users.length) users = SEED.slice();

  const getCurrent = () => {
    let id = "";
    try { id = String(localStorage.getItem(KEY) || "").trim(); }
    catch (_error) { return null; }
    return users.find((u) => u.user_id === id) || null;
  };

  const draw = (mount) => {
    const current = getCurrent();
    if (mount.nameElement) {
      mount.nameElement.textContent = current ? current.nom : "Choisir vendeur";
    }
    mount.button.setAttribute("aria-label",
      current ? "Vendeur : " + current.nom + ". Changer de vendeur" : "Choisir le vendeur sur cet appareil");
    mount.button.setAttribute("aria-haspopup", "dialog");
    mount.button.setAttribute("aria-expanded", "false");
  };

  const updateMounts = () => mounts.forEach(draw);

  const select = (id) => {
    const user = users.find((item) => item.user_id === String(id || ""));
    if (!user) return false;
    try { localStorage.setItem(KEY, user.user_id); }
    catch (_error) { return false; }
    if (window.LugdurumAPI && typeof window.LugdurumAPI.setCurrentUserId === "function") {
      window.LugdurumAPI.setCurrentUserId(user.user_id);
    }
    updateMounts();
    mounts.forEach((mount) => {
      if (typeof mount.onChange === "function") mount.onChange(user);
    });
    return true;
  };

  const ensureStyle = () => {
    if (document.getElementById("lugdurumVendorStyle")) return;
    const style = document.createElement("style");
    style.id = "lugdurumVendorStyle";
    style.textContent = [
      ".vendorSelectOverlay[hidden]{display:none!important}",
      ".vendorSelectOverlay{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;",
      "padding:16px;background:rgba(31,27,22,.55)}",
      ".vendorSelectPanel{width:min(100%,390px);max-height:90dvh;overflow-y:auto;",
      "background:#f6f1e8;color:#1f1b16;border-radius:20px;padding:22px;",
      "box-shadow:0 20px 55px rgba(31,27,22,.3)}",
      ".vendorSelectPanel h2{margin:0 0 6px;font-size:1.4rem}",
      ".vendorSelectPanel p{font-size:.88rem;line-height:1.4;margin:0 0 16px}",
      ".vendorSelectList{display:grid;gap:10px}",
      ".vendorSelectOption{min-height:54px;border:1px solid #c7b79e;border-radius:14px;",
      "background:#fffaf1;color:#1f1b16;text-align:left;padding:12px 15px;",
      "font-size:1.03rem;font-weight:800;touch-action:manipulation}",
      ".vendorSelectOption.isSelected{border:2px solid #3f6f4f;background:#e4f1e5}",
      ".vendorSelectCancel{width:100%;min-height:44px;margin-top:16px;border:0;",
      "border-radius:12px;background:#e5ddd0;color:#1f1b16;font-weight:800}",
      ".vendorSelectTrigger{white-space:nowrap;cursor:pointer}"
    ].join("");
    document.head.appendChild(style);
  };

  const open = (mount) => {
    if (typeof mount.canChange === "function" && !mount.canChange()) {
      if (typeof mount.onBlocked === "function") mount.onBlocked();
      return;
    }
    ensureStyle();
    const overlay = document.createElement("div");
    overlay.className = "vendorSelectOverlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Choisir le vendeur");

    const panel = document.createElement("div");
    panel.className = "vendorSelectPanel";
    const heading = document.createElement("h2");
    heading.textContent = "Qui effectue les ventes ?";
    const subtitle = document.createElement("p");
    subtitle.textContent = "Choix conservé sur ce téléphone uniquement. Les ventes précédentes ne changent pas.";
    const list = document.createElement("div");
    list.className = "vendorSelectList";
    const current = getCurrent();
    const close = () => {
      overlay.remove();
      mount.button.setAttribute("aria-expanded", "false");
      mount.button.focus?.();
    };
    users.forEach((u) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "vendorSelectOption" +
        (current && current.user_id === u.user_id ? " isSelected" : "");
      button.textContent = u.nom + " · " + (u.role === "admin" ? "Administrateur" : "Vendeur");
      button.addEventListener("click", () => {
        if (select(u.user_id)) close();
      });
      list.appendChild(button);
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "vendorSelectCancel";
    cancel.textContent = "Fermer";
    cancel.addEventListener("click", close);
    panel.appendChild(heading);
    panel.appendChild(subtitle);
    panel.appendChild(list);
    panel.appendChild(cancel);
    overlay.appendChild(panel);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    document.body.appendChild(overlay);
    mount.button.setAttribute("aria-expanded", "true");
    (list.querySelector(".isSelected") || list.querySelector("button") || cancel)?.focus();
  };

  const mount = (options = {}) => {
    if (!options.button) return;
    const instance = {
      button: options.button,
      nameElement: options.nameElement || null,
      onChange: options.onChange,
      canChange: options.canChange,
      onBlocked: options.onBlocked
    };
    mounts.push(instance);
    options.button.classList.add("vendorSelectTrigger");
    options.button.addEventListener("click", () => open(instance));
    draw(instance);
  };

  let fetching = null;
  const refreshFromSheet = () => {
    const api = window.LugdurumAPI;
    if (!api || typeof api.getCoreTable !== "function") return Promise.resolve(users);
    if (fetching) return fetching;
    fetching = api.getCoreTable("utilisateurs", { flushBeforeRead: false, timeoutMs: 6500 })
      .then((rows) => {
        const fresh = validUsers(rows);
        if (fresh.length) {
          users = fresh;
          try { localStorage.setItem(CACHE, JSON.stringify(users)); }
          catch (_error) {}
          updateMounts();
        }
        return users;
      })
      .catch(() => users)
      .finally(() => { fetching = null; });
    return fetching;
  };

  window.LugdurumUsers = {
    getCurrent,
    getUserId: () => getCurrent()?.user_id || "",
    select,
    mount,
    refreshFromSheet,
    list: () => users.slice()
  };
})();
