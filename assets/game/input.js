// Ввод: клавиатура, мышь и касания.
//
// Управление касанием — по зонам игрового поля: верхняя часть → прыжок,
// нижняя → подкат. Это заменяет экранные кнопки (они съедали нижнюю треть
// маленького экрана) и свайп вниз (он путался с прокруткой страницы).
//
// Пока игра не запущена, касание срабатывает только на pointerup и только
// если палец почти не сдвинулся: иначе попытка прокрутить страницу поверх
// игры запускала бы забег.

// Доля высоты поля, ниже которой касание считается «подкатом».
const SLIDE_ZONE_FROM = 0.62;
// Допуски для распознавания касания как тапа, а не прокрутки.
const TAP_MAX_MOVE = 12; // px
const TAP_MAX_TIME = 600; // мс

export class InputManager {
  constructor(root, canvas, handlers) {
    this.root = root;
    this.canvas = canvas;
    // handlers: { jump, slide, startOrRestart, togglePause, getState }
    this.handlers = handlers;
    this._bound = [];
    this._pointerStart = null;
    this._attach();
  }

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._bound.push(() => target.removeEventListener(type, fn, opts));
  }

  _isPlaying() {
    return this.handlers.getState?.() === "playing";
  }

  _attach() {
    // Клавиатура работает, когда фокус на игре (или её элементах).
    this._on(this.root, "keydown", (e) => this._onKeyDown(e));

    this._on(this.canvas, "pointerdown", (e) => {
      if (e.button && e.button !== 0) return;
      this._pointerStart = { x: e.clientX, y: e.clientY, time: performance.now() };
      // Во время игры действие должно быть мгновенным — реагируем на нажатие.
      if (this._isPlaying()) this._act(e.clientY);
    });

    this._on(this.canvas, "pointerup", (e) => {
      const start = this._pointerStart;
      this._pointerStart = null;
      if (!start || this._isPlaying()) return;
      // Вне игры запускаем забег только по «чистому» тапу, а не по прокрутке.
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (moved > TAP_MAX_MOVE) return;
      if (performance.now() - start.time > TAP_MAX_TIME) return;
      this.handlers.startOrRestart?.();
    });

    this._on(this.canvas, "pointercancel", () => {
      this._pointerStart = null;
    });
  }

  // Прыжок или подкат — по вертикальной зоне касания.
  _act(clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.height) return;
    const ratio = (clientY - rect.top) / rect.height;
    if (ratio >= SLIDE_ZONE_FROM) this.handlers.slide?.();
    else this.handlers.jump?.();
  }

  _onKeyDown(e) {
    switch (e.key) {
      case " ":
      case "Spacebar":
      case "ArrowUp":
      case "w":
      case "W":
        e.preventDefault();
        this.handlers.jump?.();
        break;
      case "ArrowDown":
      case "s":
      case "S":
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
