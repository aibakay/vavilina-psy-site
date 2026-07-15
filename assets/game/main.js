// Точка входа мини-игры «В своём ритме».
// Находит контейнер на странице и запускает игру после загрузки спрайтов.

import { Runner } from "./engine.js";

function boot() {
  const root = document.querySelector("[data-runner]");
  if (!root || root.dataset.runnerReady === "1") return;
  root.dataset.runnerReady = "1";

  const runner = new Runner(root);
  runner.load();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
