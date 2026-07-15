// Физика и состояния персонажа: бег, прыжок, подкат, неуязвимость.
// Персонаж стоит на месте по X; управление меняет вертикальное состояние.

import { CONFIG } from "./config.js";

export class Player {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = "run"; // run | jump | slide
    this.vy = 0;
    this.y = 0; // смещение «ног» над землёй (0 = на земле)
    this.slideTimer = 0;
    this.invulnerable = 0; // сек оставшейся неуязвимости
    this.shielded = false; // активный бонус «Границы»
    this.runTime = 0; // для анимации бегового цикла
    this.wantSlide = false; // подкат «заказан» в воздухе — выполнится при приземлении
  }

  get onGround() {
    return this.y <= 0.0001 && this.state !== "jump";
  }

  jump(sound) {
    if (this.state === "jump") return false;
    // Из подката тоже можно выпрыгнуть.
    this.state = "jump";
    this.vy = CONFIG.player.jumpVelocity;
    this.slideTimer = 0;
    this.wantSlide = false;
    sound?.jump();
    return true;
  }

  slide(sound) {
    if (this.state === "slide") {
      // Продлеваем подкат.
      this.slideTimer = CONFIG.player.slideDuration;
      return false;
    }
    if (this.state === "jump") {
      // В воздухе персонаж не телепортируется вниз: ускоряем падение,
      // а подкат начнётся в момент приземления.
      this.vy = Math.max(this.vy, 900);
      this.wantSlide = true;
      return false;
    }
    this.state = "slide";
    this.slideTimer = CONFIG.player.slideDuration;
    sound?.slide?.();
    return true;
  }

  applyKnockback() {
    this.invulnerable = CONFIG.player.invulnerableTime;
  }

  activateShield() {
    this.shielded = true;
  }

  // Тратит щит на одно столкновение. Возвращает true, если удар поглощён.
  consumeShield() {
    if (this.shielded) {
      this.shielded = false;
      return true;
    }
    return false;
  }

  update(dt) {
    if (this.invulnerable > 0) this.invulnerable = Math.max(0, this.invulnerable - dt);

    if (this.state === "jump") {
      this.vy += CONFIG.player.gravity * dt;
      this.y -= this.vy * dt; // vy отрицательна вверх → y растёт вверх
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        if (this.wantSlide) {
          this.wantSlide = false;
          this.state = "slide";
          this.slideTimer = CONFIG.player.slideDuration;
        } else {
          this.state = "run";
        }
      }
    } else if (this.state === "slide") {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0) {
        this.state = "run";
      }
    } else {
      this.runTime += dt;
    }
  }
}
