// Обёртка над Yandex.Metrika. Не подключает отдельную библиотеку —
// использует уже существующий на сайте счётчик (window.ym), если он настроен.
// Никаких персональных или медицинских данных не передаётся.

let counterId = null;

export function initAnalytics(id) {
  const parsed = Number(id);
  counterId = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function track(goal) {
  if (!counterId || typeof window.ym !== "function") return;
  try {
    window.ym(counterId, "reachGoal", goal);
  } catch {
    // Молча игнорируем — аналитика не должна ломать игру.
  }
}

export const GOALS = {
  started: "runner_started",
  jump: "runner_jump",
  slide: "runner_slide",
  bonus: "runner_bonus_collected",
  finished: "runner_finished",
  ctaBreathing: "runner_cta_breathing",
  ctaConsultation: "runner_cta_consultation",
};
