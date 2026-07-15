// Ввод: клавиатура, мышь, касания и экранные кнопки.
// Гарантирует, что стрелки/пробел/свайп внутри игры не прокручивают страницу.

export class InputManager {
  constructor(root, canvas, handlers) {
    this.root = root;
    this.canvas = canvas;
    // handlers: { jump, slide, startOrRestart, togglePause }
    this.handlers = handlers;
    this._bound = [];
    this._touchStart = null;
    this._attach();
  }

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._bound.push(() => target.removeEventListener(type, fn, opts));
  }

  _attach() {
    // Клавиатура работает, когда фокус на игре (или её элементах).
    this._on(this.root, "keydown", (e) => this._onKeyDown(e));

    // Указатель (мышь/тач) по игровому полю → прыжок.
    this._on(this.canvas, "pointerdown", (e) => {
      // Игнорируем правую кнопку.
      if (e.button && e.button !== 0) return;
      this.handlers.jump?.();
    });

    // Свайп вниз → подкат. Отдельно от pointer, чтобы различать жест.
    this._on(
      this.canvas,
      "touchstart",
      (e) => {
        const t = e.touches[0];
        this._touchStart = { x: t.clientX, y: t.clientY, time: performance.now() };
      },
      { passive: true }
    );

    this._on(
      this.canvas,
      "touchmove",
      (e) => {
        if (!this._touchStart) return;
        const t = e.touches[0];
        const dy = t.clientY - this._touchStart.y;
        const dx = t.clientX - this._touchStart.x;
        if (dy > 40 && dy > Math.abs(dx)) {
          this.handlers.slide?.();
          this._touchStart = null;
          // Не даём странице прокручиваться от свайпа внутри игры.
          e.preventDefault();
        }
      },
      { passive: false }
    );

    this._on(this.canvas, "touchend", () => {
      this._touchStart = null;
    });
  }

  _onKeyDown(e) {
    switch (e.key) {
      case " ":
      case "Spacebar":
      case "ArrowUp":
        e.preventDefault();
        this.handlers.jump?.();
        break;
      case "ArrowDown":
        e.preventDefault();
        this.handlers.slide?.();
        break;
      case "Enter":
        e.preventDefault();
        this.handlers.startOrRestart?.();
        break;
      case "Escape":
        this.handlers.togglePause?.();
        break;
      default:
        break;
    }
  }

  destroy() {
    this._bound.forEach((off) => off());
    this._bound = [];
  }
}
