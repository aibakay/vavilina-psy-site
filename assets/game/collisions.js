// Коллизии с немного уменьшенными хитбоксами — чтобы игра ощущалась честной.
// Учитывает бег, прыжок, подкат и активную защиту.

import { CONFIG } from "./config.js";
import { obstacleRect, bonusCircle } from "./spawner.js";

// Прямоугольник хитбокса персонажа в логических px.
export function playerHitbox(player, m) {
  const H = m.standHeight;
  const cfg = player.state === "slide" ? CONFIG.hitbox.playerSlide : CONFIG.hitbox.playerStand;
  const w = cfg.w * H;
  const h = cfg.h * H;
  const footX = m.playerX;
  const footY = m.groundY - player.y; // ноги с учётом высоты прыжка
  return {
    x: footX - w / 2 + cfg.offX * H,
    y: footY - h + cfg.offY * H,
    w,
    h,
  };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function circleRectOverlap(circle, rect) {
  const nx = Math.max(rect.x, Math.min(circle.cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(circle.cy, rect.y + rect.h));
  const dx = circle.cx - nx;
  const dy = circle.cy - ny;
  return dx * dx + dy * dy <= circle.r * circle.r;
}

// Проверяет столкновение персонажа с препятствием (с сжатием хитбокса).
export function hitsObstacle(player, entity, m) {
  const box = playerHitbox(player, m);
  const raw = obstacleRect(entity, m);
  const k = CONFIG.hitbox.obstacle;
  const shrunk = {
    x: raw.x + (raw.w * (1 - k)) / 2,
    y: raw.y + (raw.h * (1 - k)) / 2,
    w: raw.w * k,
    h: raw.h * k,
  };
  return rectsOverlap(box, shrunk);
}

// Проверяет сбор бонуса (хитбокс чуть увеличен).
export function collectsBonus(player, entity, m) {
  const box = playerHitbox(player, m);
  const circle = bonusCircle(entity, m);
  const grown = { cx: circle.cx, cy: circle.cy, r: circle.r * CONFIG.hitbox.bonus };
  return circleRectOverlap(grown, box);
}
