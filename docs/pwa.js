if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js?v=6").catch((error) => {
      console.warn("Service worker non enregistré :", error);
    });
  });
}