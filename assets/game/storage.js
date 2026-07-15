// Локальное сохранение лучшего результата. Без лидербордов и аккаунтов —
// только личный ориентир в localStorage.

const KEY = "vsvoyem-ritme:best-distance";

export function getBestDistance() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

export function saveBestDistance(distance) {
  const best = getBestDistance();
  const next = Math.floor(distance);
  if (next <= best) return best;
  try {
    window.localStorage.setItem(KEY, String(next));
  } catch {
    // Приватный режим / отключённое хранилище — просто не сохраняем.
  }
  return next;
}
