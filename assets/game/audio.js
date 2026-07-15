// Лёгкие короткие звуки через Web Audio API — без аудиофайлов и автозапуска.
// Звук выключен по умолчанию и инициализируется только после действия игрока.

export class SoundManager {
  constructor() {
    this.enabled = false;
    this.ctx = null;
  }

  // Создаёт AudioContext лениво — строго в ответ на жест пользователя.
  _ensureContext() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    this.ctx = new Ctx();
    return this.ctx;
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
    if (this.enabled) {
      const ctx = this._ensureContext();
      if (ctx && ctx.state === "suspended") ctx.resume();
    }
    return this.enabled;
  }

  toggle() {
    return this.setEnabled(!this.enabled);
  }

  // Мягкий тон: тип волны, частоты, длительность, громкость.
  _tone({ type = "sine", from = 440, to = null, duration = 0.15, gain = 0.05 }) {
    if (!this.enabled) return;
    const ctx = this._ensureContext();
    if (!ctx || ctx.state !== "running") return;

    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    const now = ctx.currentTime;

    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    if (to !== null) osc.frequency.exponentialRampToValueAtTime(to, now + duration);

    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(gain, now + 0.02);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(amp).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  jump() {
    this._tone({ type: "sine", from: 420, to: 720, duration: 0.16, gain: 0.05 });
  }

  bonus() {
    this._tone({ type: "triangle", from: 660, to: 990, duration: 0.18, gain: 0.05 });
  }

  hit() {
    this._tone({ type: "sine", from: 260, to: 150, duration: 0.22, gain: 0.06 });
  }

  finish() {
    this._tone({ type: "sine", from: 400, to: 240, duration: 0.5, gain: 0.05 });
  }
}
