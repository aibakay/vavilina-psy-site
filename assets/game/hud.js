// UI-слой: живой счёт (HUD), оверлеи состояний, экранные кнопки, кнопка звука.
// Семантическая разметка приходит из шаблона (runner.njk) — здесь мы только
// переключаем состояния, обновляем значения и вешаем обработчики.

export class Hud {
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;

    // Живые значения.
    this.elDistance = root.querySelector("[data-hud='distance']");
    this.elResourceBar = root.querySelector("[data-hud='resource-bar']");
    this.elResourceValue = root.querySelector("[data-hud='resource-value']");
    this.elFootholds = root.querySelector("[data-hud='footholds']");
    this.elBonus = root.querySelector("[data-hud='active-bonus']");

    // Финальные значения.
    this.elFinalDistance = root.querySelector("[data-final='distance']");
    this.elFinalFootholds = root.querySelector("[data-final='footholds']");
    this.elFinalBest = root.querySelector("[data-final='best']");

    // Всплывающая мягкая подсказка (фразы бонусов).
    this.elToast = root.querySelector("[data-hud='toast']");
    this._toastTimer = null;

    this.overlays = Array.from(root.querySelectorAll("[data-overlay]"));
    this.stage = root.querySelector(".runner-stage");

    this._wire();
  }

  _wire() {
    const h = this.handlers;
    this.root.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const action = btn.dataset.action;
        switch (action) {
          case "start":
          case "restart":
            h.startOrRestart?.();
            break;
          case "resume":
            h.resume?.();
            break;
          case "pause":
            h.togglePause?.();
            break;
          case "jump":
            h.jump?.();
            break;
          case "slide":
            h.slide?.();
            break;
          case "sound":
            h.toggleSound?.();
            break;
          case "breathing":
            h.ctaBreathing?.(e);
            break;
          case "consultation":
            h.ctaConsultation?.();
            break;
          case "breathing-close":
            h.closeBreathing?.();
            break;
          default:
            break;
        }
      });
    });
  }

  setState(state) {
    this.overlays.forEach((el) => {
      el.hidden = el.dataset.overlay !== state;
    });
    if (this.stage) this.stage.dataset.state = state;
  }

  setSoundLabel(enabled) {
    const btn = this.root.querySelector("[data-action='sound']");
    if (!btn) return;
    btn.setAttribute("aria-pressed", String(enabled));
    btn.setAttribute("aria-label", enabled ? "Выключить звук" : "Включить звук");
    btn.textContent = enabled ? "♪" : "♪̶";
    btn.classList.toggle("is-on", enabled);
  }

  updateStats({ distance, resource, footholds, activeBonus }) {
    if (this.elDistance) this.elDistance.textContent = `${Math.floor(distance)} м`;
    const pct = Math.round(resource);
    if (this.elResourceValue) this.elResourceValue.textContent = `${pct}%`;
    if (this.elResourceBar) {
      this.elResourceBar.style.width = `${pct}%`;
      this.elResourceBar.parentElement?.setAttribute("aria-valuenow", String(pct));
      // Спокойная смена оттенка без резких «тревожных» цветов.
      const low = pct < 30;
      this.elResourceBar.classList.toggle("is-low", low);
    }
    if (this.elFootholds) this.elFootholds.textContent = String(footholds);
    if (this.elBonus) {
      this.elBonus.textContent = activeBonus || "";
      this.elBonus.hidden = !activeBonus;
    }
  }

  setFinal({ distance, footholds, best }) {
    if (this.elFinalDistance) this.elFinalDistance.textContent = `${Math.floor(distance)} м`;
    if (this.elFinalFootholds) this.elFinalFootholds.textContent = String(footholds);
    if (this.elFinalBest) this.elFinalBest.textContent = `${Math.floor(best)} м`;
  }

  // Мягкая фраза (бонусы «Дыхание» / «Поддержка»).
  toast(message) {
    if (!this.elToast || !message) return;
    this.elToast.textContent = message;
    this.elToast.classList.add("is-visible");
    clearTimeout(this._toastTimer);
    this._toastTimer = window.setTimeout(() => {
      this.elToast.classList.remove("is-visible");
    }, 2600);
  }
}
