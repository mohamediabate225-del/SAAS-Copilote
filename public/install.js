if ("serviceWorker" in navigator) {
  fetch("/api/public-config").then(response => response.ok ? response.json() : null)
    .then(config => config?.offline_demo ? navigator.serviceWorker.register("/demo-worker.js") : undefined)
    .catch(() => {});
}
