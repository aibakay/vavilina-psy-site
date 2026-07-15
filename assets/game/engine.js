// Игровой цикл и оркестрация состояний: loading → intro → playing →
// paused / game over → restart. Собирает вместе ввод, физику, генерацию,
// коллизии, фон, HUD, звук, хранилище и аналитику.

import { CONFIG } from "./config.js";
import { SpriteSet } from "./sprites.js";
import { Player } from "./player.js";
import { Spawner, drawObstacle, drawBonus } from "./spawner.js";
import { hitsObstacle, collectsBonus } from "./collisions.js";
import { Background } from "./background.js";
import { InputManager } from "./input.js";
import { Hud } from "./hud.js";
import { SoundManager } from "./audio.js";
import { getBestDistance, saveBestDistance } from "./storage.js";
import { initAnalytics, track, GOALS } from "./analytics.js";

const BONUS_LABELS = {
  breathing: "Дыхание",
  boundaries: "Границы",
};

export class Runner {
  constructor(root) {
    this.root = root;
    this.canvas = root.querySelector(".runner-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.state = "loading";
    this.sprites = new SpriteSet();
    this.player = new Player();
    this.spawner = new Spawner();
    this.background = new Background(this.reducedMotion);
    this.sound = new SoundManager();
    this.entities = [];

    this.metrics = { viewWidth: 0, viewHeight: 0, groundY: 0, standHeight: 0, playerX: 0 };
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.lastTime = 0;
    this.rafId = null;

    initAnalytics(root.dataset.ymId);
    this._initHud();
    this._initInput();
    this._initResize();
    this._initVisibility();
  }

  // --- Инициализация ------------------------------------------------------

  _initHud() {
    this.hud = new Hud(this.root, {
      startOrRestart: () => this.start(),
      resume: () => this.resume(),
      togglePause: () => this.togglePause(),
      jump: () => this._jump(),
      slide: () => this._slide(),
      toggleSound: () => this._toggleSound(),
      ctaBreathing: (e) => this._ctaBreathing(e),
      ctaConsultation: () => this._ctaConsultation(),
      closeBreathing: () => this._closeBreathing(),
    });
    this.hud.setSoundLabel(false);
  }

  _initInput() {
    this.input = new InputManager(this.root, this.canvas, {
      jump: () => this._jump(),
      slide: () => this._slide(),
      startOrRestart: () => {
        if (this.state === "intro" || this.state === "gameover") this.start();
      },
      togglePause: () => this.togglePause(),
    });
  }

  _initResize() {
    this._resize();

    // Дебаунс через rAF — корректно и без «дёрганья» при перетаскивании окна.
    this._resizePending = false;
    this._onResize = () => {
      if (this._resizePending) return;
      this._resizePending = true;
      requestAnimationFrame(() => {
        this._resizePending = false;
        this._resize();
      });
    };

    // Окно/поворот экрана — надёжный основной путь.
    window.addEventListener("resize", this._onResize);
    window.addEventListener("orientationchange", this._onResize);

    // ResizeObserver — дополнительно ловит изменения самого контейнера.
    if ("ResizeObserver" in window) {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(this.root.querySelector(".runner-stage"));
    }
  }

  _initVisibility() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.state === "playing") this.togglePause();
    });
  }

  async load() {
    try {
      await this.sprites.load();
    } catch (err) {
      // Спрайты не загрузились — показываем интро, игра остаётся управляемой,
      // персонаж будет отрисован как мягкий силуэт-заглушка.
      console.warn(err);
    }
    this.state = "intro";
    this.hud.setState("intro");
    this._resize();
    this._renderStatic();

    // Раскладка может «доехать» позже (шрифты, reveal-анимация). Пересчитываем
    // размер несколько раз после загрузки — надёжно и без постоянного цикла.
    const remeasure = () => {
      this._resize();
      this._renderStatic();
    };
    requestAnimationFrame(remeasure);
    [150, 500, 1000].forEach((t) => window.setTimeout(remeasure, t));
    window.addEventListener("load", remeasure, { once: true });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(remeasure).catch(() => {});
    }
  }

  // --- Метрики и размер ---------------------------------------------------

  // Отображаемым размером управляет CSS (width/height: 100%). Здесь мы только
  // держим внутренний буфер canvas в соответствии с этим размером и DPR —
  // поэтому даже устаревший буфер никогда не «вылезает» за контейнер.
  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(240, Math.round(rect.width));
    const height = Math.max(200, Math.round(rect.height));

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const m = this.metrics;
    m.viewWidth = width;
    m.viewHeight = height;
    m.groundY = height * (1 - CONFIG.view.groundRatio);
    m.standHeight = height * CONFIG.player.standHeightRatio;
    m.playerX = width * CONFIG.player.xRatio;

    this._lastW = width;
    this._lastH = height;

    if (this.state === "intro" || this.state === "gameover" || this.state === "paused") {
      this._renderStatic();
    }
  }

  // Дешёвая проверка каждый кадр: если CSS-размер изменился — пересчитать буфер.
  _ensureSize() {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (!cw || !ch) return;
    if (Math.abs(cw - this._lastW) > 1 || Math.abs(ch - this._lastH) > 1) {
      this._resize();
    }
  }

  // --- Управление состояниями --------------------------------------------

  start() {
    this.player.reset();
    this.spawner.reset();
    this.entities = [];
    this.resource = CONFIG.resource.start;
    this.distancePx = 0;
    this.speed = CONFIG.world.baseSpeed;
    this.elapsed = 0;
    this.footholds = 0;
    this.breathingTimer = 0;
    this.hitSlowTimer = 0;

    this.state = "playing";
    this.hud.setState("playing");
    // Фокус на игровое поле: после клика по кнопке «Начать» клавиатура
    // (Space/стрелки) должна сразу управлять игрой.
    this.canvas.focus({ preventScroll: true });
    track(GOALS.started);

    this.lastTime = performance.now();
    this._stopLoop();
    this.rafId = requestAnimationFrame((t) => this._loop(t));
  }

  togglePause() {
    if (this.state === "playing") {
      this.state = "paused";
      this.hud.setState("paused");
      this._stopLoop();
      this._renderStatic();
    } else if (this.state === "paused") {
      this.resume();
    }
  }

  resume() {
    if (this.state !== "paused") return;
    this.state = "playing";
    this.hud.setState("playing");
    this.lastTime = performance.now();
    this._stopLoop();
    this.rafId = requestAnimationFrame((t) => this._loop(t));
  }

  finish() {
    this.state = "gameover";
    this._stopLoop();
    const distanceM = this.distancePx * CONFIG.world.metersPerPx;
    const best = saveBestDistance(distanceM);
    this.hud.setFinal({ distance: distanceM, footholds: this.footholds, best });
    this.hud.setState("gameover");
    this.sound.finish();
    track(GOALS.finished);
    this._renderStatic();
  }

  _stopLoop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  // --- Действия игрока ----------------------------------------------------

  _jump() {
    if (this.state === "intro" || this.state === "gameover") {
      this.start();
      return;
    }
    if (this.state !== "playing") return;
    if (this.player.jump(this.sound)) track(GOALS.jump);
  }

  _slide() {
    if (this.state !== "playing") return;
    if (this.player.slide(this.sound)) track(GOALS.slide);
  }

  _toggleSound() {
    const enabled = this.sound.toggle();
    this.hud.setSoundLabel(enabled);
  }

  // --- CTA ----------------------------------------------------------------

  _ctaBreathing(event) {
    track(GOALS.ctaBreathing);
    const href = CONFIG.cta.breathingHref;
    if (href) {
      // Внешняя/внутренняя ссылка на реальную практику, если задана.
      window.location.href = href;
      return;
    }
    // Иначе — встроенная дыхательная практика.
    if (event) event.preventDefault();
    this.hud.setState("breathing");
  }

  _closeBreathing() {
    this.hud.setState("gameover");
  }

  _ctaConsultation() {
    track(GOALS.ctaConsultation);
    const href = CONFIG.cta.consultationHref || "#contacts";
    const target = document.querySelector(href);
    if (target) {
      target.scrollIntoView({ behavior: this.reducedMotion ? "auto" : "smooth" });
    } else {
      window.location.href = href;
    }
  }

  // --- Цикл ---------------------------------------------------------------

  _loop(now) {
    if (this.state !== "playing") return;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.05) dt = 0.05; // защита от «скачка» после сворачивания вкладки

    this._ensureSize();
    this._update(dt);
    this._render();

    if (this.state === "playing") {
      this.rafId = requestAnimationFrame((t) => this._loop(t));
    }
  }

  _update(dt) {
    this.elapsed += dt;

    // Плавный рост скорости с потолком.
    this.speed = Math.min(
      CONFIG.world.maxSpeed,
      CONFIG.world.baseSpeed + CONFIG.world.speedGrowth * this.elapsed
    );

    // Бонус «Дыхание» замедляет мир.
    let slow = 1;
    if (this.breathingTimer > 0) {
      this.breathingTimer = Math.max(0, this.breathingTimer - dt);
      slow = CONFIG.world.breathingSlowFactor;
    }
    // Короткое замедление после столкновения — ощутимый «сбой ритма».
    if (this.hitSlowTimer > 0) {
      this.hitSlowTimer = Math.max(0, this.hitSlowTimer - dt);
      slow = Math.min(slow, CONFIG.player.hitSlowFactor);
    }

    const movedPx = this.speed * slow * dt;
    this.distancePx += movedPx;

    this.background.update(movedPx);
    this.player.update(dt);

    // Двигаем и отсеиваем объекты.
    for (const e of this.entities) e.x -= movedPx;
    this.entities = this.entities.filter((e) => e.x > -300);

    // Спавним новые (дистанция считается от фактической скорости мира).
    const created = this.spawner.update(movedPx, this.speed * slow, this.metrics.viewWidth);
    if (created.length) this.entities.push(...created);

    this._handleCollisions();

    // Медленное снижение ресурса при долгом беге.
    this.resource = Math.max(
      CONFIG.resource.min,
      this.resource - CONFIG.resource.drainPerSecond * dt
    );

    this._syncHud();

    if (this.resource <= CONFIG.resource.min) this.finish();
  }

  _handleCollisions() {
    for (const e of this.entities) {
      if (e.type === "obstacle" && !e.hit) {
        if (hitsObstacle(this.player, e, this.metrics)) {
          e.hit = true;
          if (this.player.invulnerable > 0) continue;
          if (this.player.consumeShield()) {
            this.player.applyKnockback(); // короткая неуязвимость, без урона
            continue;
          }
          this.resource = Math.max(
            CONFIG.resource.min,
            this.resource - CONFIG.resource.collisionDamage
          );
          this.player.applyKnockback();
          this.hitSlowTimer = CONFIG.player.hitSlowDuration;
          this.sound.hit();
        }
      } else if (e.type === "bonus" && !e.collected) {
        if (collectsBonus(this.player, e, this.metrics)) {
          e.collected = true;
          this._applyBonus(e.kind);
          this.sound.bonus();
          track(GOALS.bonus);
        }
      }
    }
    this.entities = this.entities.filter((e) => !(e.type === "bonus" && e.collected));
  }

  _applyBonus(kind) {
    const R = CONFIG.resource;
    switch (kind) {
      case "foothold":
        this.resource = Math.min(R.max, this.resource + R.footholdRestore);
        this.footholds += 1;
        break;
      case "support":
        this.resource = Math.min(R.max, this.resource + R.supportRestore);
        this.hud.toast(CONFIG.copy.supportHint);
        break;
      case "breathing":
        this.breathingTimer = CONFIG.spawn.breathingDuration;
        this.hud.toast(CONFIG.copy.breathingHint);
        break;
      case "boundaries":
        this.player.activateShield();
        break;
      default:
        break;
    }
  }

  _activeBonusLabel() {
    if (this.breathingTimer > 0) return BONUS_LABELS.breathing;
    if (this.player.shielded) return BONUS_LABELS.boundaries;
    return "";
  }

  _syncHud() {
    this.hud.updateStats({
      distance: this.distancePx * CONFIG.world.metersPerPx,
      resource: this.resource,
      footholds: this.footholds,
      activeBonus: this._activeBonusLabel(),
    });
  }

  // --- Отрисовка ----------------------------------------------------------

  _render() {
    const { ctx, metrics: m } = this;
    const resourceNorm = this.resource / CONFIG.resource.max;
    ctx.clearRect(0, 0, m.viewWidth, m.viewHeight);
    this.background.draw(ctx, m, resourceNorm);

    for (const e of this.entities) {
      if (e.type === "obstacle") drawObstacle(ctx, e, m, this.reducedMotion);
      else drawBonus(ctx, e, m, this.elapsed, this.reducedMotion);
    }

    this._drawPlayer();
  }

  // Статичная сцена для intro/paused/gameover (без запуска цикла).
  _renderStatic() {
    const { ctx, metrics: m } = this;
    if (!m.viewWidth) return;
    const resourceNorm =
      this.state === "gameover" && typeof this.resource === "number"
        ? this.resource / CONFIG.resource.max
        : 1;
    ctx.clearRect(0, 0, m.viewWidth, m.viewHeight);
    this.background.draw(ctx, m, resourceNorm);
    if (this.state === "paused" || this.state === "gameover") {
      for (const e of this.entities) {
        if (e.type === "obstacle") drawObstacle(ctx, e, m, this.reducedMotion);
        else drawBonus(ctx, e, m, this.elapsed || 0, this.reducedMotion);
      }
    }
    this._drawPlayer(true);
  }

  _drawPlayer(idle = false) {
    const { ctx, metrics: m, player } = this;
    if (!this.sprites.ready) {
      this._drawPlayerFallback(idle);
      return;
    }

    const footX = m.playerX;
    const footY = m.groundY - (idle ? 0 : player.y);

    // Мягкая тень.
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = "#4d2b23";
    const shadowW = m.standHeight * 0.5;
    ctx.beginPath();
    ctx.ellipse(footX, m.groundY, shadowW * (idle ? 0.9 : 1 - Math.min(0.5, player.y / 240)), shadowW * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Защитный контур «Границы».
    if (!idle && player.shielded) {
      ctx.save();
      ctx.strokeStyle = "rgba(201, 162, 74, 0.85)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(footX, footY - m.standHeight * 0.45, m.standHeight * 0.45, m.standHeight * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Мерцание при неуязвимости.
    let alpha = 1;
    if (!idle && player.invulnerable > 0) {
      alpha = 0.4 + 0.6 * Math.abs(Math.sin(this.elapsed * 20));
    }
    ctx.save();
    ctx.globalAlpha = alpha;

    const img = this._currentSprite(idle);
    this.sprites.draw(ctx, img, footX, footY, m.standHeight);
    ctx.restore();
  }

  _currentSprite(idle) {
    const s = this.sprites.images;
    if (idle || this.state !== "playing") return s.idle;
    const p = this.player;
    if (p.state === "jump") return s.jump;
    if (p.state === "slide") return s.slide;
    // Беговой цикл.
    const frame = Math.floor(p.runTime * CONFIG.sprites.runFrameFps) % s.run.length;
    return s.run[frame];
  }

  _drawPlayerFallback(idle) {
    // Простой силуэт, если PNG недоступны.
    const { ctx, metrics: m, player } = this;
    const footX = m.playerX;
    const footY = m.groundY - (idle ? 0 : player.y);
    const h = player && player.state === "slide" && !idle ? m.standHeight * 0.55 : m.standHeight;
    ctx.fillStyle = "#731817";
    ctx.beginPath();
    const w = h * 0.4;
    ctx.roundRect ? ctx.roundRect(footX - w / 2, footY - h, w, h, 10) : ctx.rect(footX - w / 2, footY - h, w, h);
    ctx.fill();
  }

  destroy() {
    this._stopLoop();
    this.input?.destroy();
    this._ro?.disconnect();
    if (this._onResize) {
      window.removeEventListener("resize", this._onResize);
      window.removeEventListener("orientationchange", this._onResize);
    }
  }
}
