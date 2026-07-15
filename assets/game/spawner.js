// Генерация препятствий и бонусов + их программная отрисовка (Canvas-примитивы).
// Ничего защищённого авторским правом — только простые геометрические образы.
//
// Все размеры хранятся как доли высоты стойки персонажа (H), а пиксельная
// геометрия считается на лету — это делает объекты корректными после ресайза.

import { CONFIG } from "./config.js";

// Спокойная пастельная палитра, согласованная с сайтом.
const C = {
  wine: "#731817",
  wineSoft: "rgba(115, 24, 23, 0.16)",
  ink: "#4b403c",
  olive: "#73735a",
  paper: "#fffaf5",
  cloud: "rgba(120, 112, 130, 0.35)",
  cloudEdge: "rgba(120, 112, 130, 0.55)",
  mint: "#7fa88f",
  sky: "#8aa6c2",
  gold: "#c9a24a",
};

// --- Каталог препятствий ------------------------------------------------

// jump: перепрыгнуть (низкое, на земле). duck: пригнуться (высокое, с зазором).
const OBSTACLES = {
  stack: { action: "jump", w: 0.5, h: 0.42, label: "Стопка дел" },
  notifications: { action: "jump", w: 0.6, h: 0.34, label: "Уведомления" },
  deadline: { action: "jump", w: 0.4, h: 0.52, label: "Дедлайн" },
  cloud: { action: "duck", w: 0.9, gap: 0.55, h: 0.5, label: "Облако мыслей" },
  should: { action: "duck", w: 0.8, gap: 0.55, h: 0.4, label: "«Ты должен»" },
};

const OBSTACLE_KINDS = Object.keys(OBSTACLES);

// --- Каталог бонусов ----------------------------------------------------

const BONUSES = {
  foothold: { r: 0.18, label: "Точка опоры" },
  breathing: { r: 0.22, label: "Дыхание" },
  boundaries: { r: 0.22, label: "Границы" },
  support: { r: 0.22, label: "Поддержка" },
};

function weightedBonus() {
  const weights = CONFIG.spawn.bonusWeights;
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (const [kind, w] of Object.entries(weights)) {
    roll -= w;
    if (roll <= 0) return kind;
  }
  return "foothold";
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --- Сущности -----------------------------------------------------------

export function createObstacle(kind, xPx) {
  return { type: "obstacle", kind, x: xPx, hit: false };
}

export function createBonus(kind, xPx, heightFactor) {
  return { type: "bonus", kind, x: xPx, heightFactor, collected: false };
}

// Пиксельный прямоугольник препятствия по текущим метрикам поля.
export function obstacleRect(entity, m) {
  const def = OBSTACLES[entity.kind];
  const H = m.standHeight;
  const w = def.w * H;
  const h = def.h * H;
  if (def.action === "duck") {
    const bottom = m.groundY - def.gap * H; // нижняя кромка над землёй
    return { x: entity.x, y: bottom - h, w, h };
  }
  return { x: entity.x, y: m.groundY - h, w, h };
}

export function bonusCircle(entity, m) {
  const def = BONUSES[entity.kind];
  const H = m.standHeight;
  const r = def.r * H;
  const cx = entity.x + r;
  const cy = m.groundY - entity.heightFactor * H;
  return { cx, cy, r };
}

export function obstacleAction(kind) {
  return OBSTACLES[kind].action;
}

// --- Генератор ----------------------------------------------------------

export class Spawner {
  constructor() {
    this.reset();
  }

  reset() {
    // Дистанция (в px), которую мир проехал с прошлого спавна.
    this.distanceSinceObstacle = 0;
    this.nextGap = this._computeGap(CONFIG.world.baseSpeed);
    this.lastAction = null;
  }

  // Дистанция от текущей скорости — время реакции постоянно на любом темпе.
  _computeGap(speed) {
    const s = CONFIG.spawn;
    return Math.max(s.minGapPx, speed * (s.minGapSec + Math.random() * s.gapRandomSec));
  }

  // Вызывается каждый кадр. Возвращает массив новых сущностей (0..2).
  update(movedPx, speed, viewWidth) {
    this.distanceSinceObstacle += movedPx;
    if (this.distanceSinceObstacle < this.nextGap) return [];

    this.distanceSinceObstacle = 0;
    this.nextGap = this._computeGap(speed);

    const spawned = [];
    const spawnX = viewWidth + 40;

    // Не ставим два «пригнуться» подряд без передышки — избегаем невозможных серий.
    let kind = pick(OBSTACLE_KINDS);
    if (obstacleAction(kind) === "duck" && this.lastAction === "duck") {
      kind = pick(OBSTACLE_KINDS.filter((k) => OBSTACLES[k].action === "jump"));
    }
    this.lastAction = obstacleAction(kind);
    spawned.push(createObstacle(kind, spawnX));

    // Иногда — бонус в безопасном «окне» перед препятствием.
    if (Math.random() < CONFIG.spawn.bonusChance) {
      const bonusKind = weightedBonus();
      // Высота: точка опоры бывает и низкой, и в прыжке; редкие — в прыжке.
      const heightFactor =
        bonusKind === "foothold" ? pick([0.35, 0.7, 1.05]) : pick([0.8, 1.05]);
      spawned.push(createBonus(bonusKind, spawnX - CONFIG.spawn.bonusLeadPx, heightFactor));
    }

    return spawned;
  }
}

// --- Отрисовка ----------------------------------------------------------

export function drawObstacle(ctx, entity, m, reducedMotion) {
  const def = OBSTACLES[entity.kind];
  const rect = obstacleRect(entity, m);
  ctx.save();

  if (def.action === "duck") {
    drawDuckObstacle(ctx, entity.kind, rect, reducedMotion);
  } else {
    drawJumpObstacle(ctx, entity.kind, rect);
  }

  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function drawJumpObstacle(ctx, kind, rect) {
  const { x, y, w, h } = rect;
  ctx.fillStyle = C.wine;
  ctx.strokeStyle = C.wineSoft;
  ctx.lineWidth = 2;

  if (kind === "stack") {
    // Стопка «дел» — три листа/папки.
    const layers = 3;
    const lh = h / layers;
    for (let i = 0; i < layers; i += 1) {
      const off = (i % 2 === 0 ? -1 : 1) * w * 0.06;
      ctx.fillStyle = i % 2 === 0 ? C.wine : "#8f3a2f";
      roundRect(ctx, x + off * 0.5, y + i * lh, w, lh - 3, 4);
      ctx.fill();
    }
  } else if (kind === "notifications") {
    // Группа мелких «уведомлений».
    const cols = 3;
    const cw = w / cols;
    for (let i = 0; i < cols; i += 1) {
      const bh = h * (0.6 + 0.4 * ((i + 1) / cols));
      ctx.fillStyle = i === 1 ? C.wine : "#a2554a";
      roundRect(ctx, x + i * cw + 3, y + (h - bh), cw - 6, bh, 5);
      ctx.fill();
      // «точка» уведомления
      ctx.fillStyle = C.paper;
      ctx.beginPath();
      ctx.arc(x + i * cw + cw / 2, y + (h - bh) + 6, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "deadline") {
    // Дедлайн — часы на подставке.
    const cx = x + w / 2;
    const postW = w * 0.24;
    ctx.fillStyle = C.olive;
    roundRect(ctx, cx - postW / 2, y + h * 0.5, postW, h * 0.5, 3);
    ctx.fill();
    const r = w * 0.42;
    ctx.fillStyle = C.paper;
    ctx.strokeStyle = C.wine;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, y + r, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // стрелки
    ctx.strokeStyle = C.wine;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, y + r);
    ctx.lineTo(cx, y + r - r * 0.55);
    ctx.moveTo(cx, y + r);
    ctx.lineTo(cx + r * 0.4, y + r);
    ctx.stroke();
  }
}

function drawDuckObstacle(ctx, kind, rect) {
  const { x, y, w, h } = rect;
  if (kind === "cloud") {
    // Облако мыслей — мягкие перекрывающиеся круги.
    ctx.fillStyle = C.cloud;
    ctx.strokeStyle = C.cloudEdge;
    ctx.lineWidth = 2;
    const cy = y + h * 0.55;
    const bumps = [
      [x + w * 0.22, cy, h * 0.42],
      [x + w * 0.45, y + h * 0.42, h * 0.5],
      [x + w * 0.68, cy, h * 0.44],
      [x + w * 0.85, y + h * 0.6, h * 0.34],
    ];
    ctx.beginPath();
    bumps.forEach(([bx, by, br]) => {
      ctx.moveTo(bx + br, by);
      ctx.arc(bx, by, br, 0, Math.PI * 2);
    });
    ctx.fill();
    ctx.stroke();
  } else if (kind === "should") {
    // «Ты должен» — подвесная табличка со стрелкой вниз.
    ctx.fillStyle = "rgba(115, 24, 23, 0.9)";
    roundRect(ctx, x, y, w, h * 0.72, 8);
    ctx.fill();
    ctx.fillStyle = C.paper;
    ctx.font = `600 ${Math.round(h * 0.32)}px "Manrope", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Ты должен", x + w / 2, y + h * 0.36);
    // короткая «ножка» вниз, чтобы читалось как нависающее препятствие
    ctx.fillStyle = "rgba(115, 24, 23, 0.5)";
    roundRect(ctx, x + w / 2 - 4, y + h * 0.72, 8, h * 0.28, 3);
    ctx.fill();
  }
}

export function drawBonus(ctx, entity, m, time, reducedMotion) {
  const { cx, cy, r } = bonusCircle(entity, m);
  const bob = reducedMotion ? 0 : Math.sin(time * 3 + entity.x * 0.01) * r * 0.12;
  ctx.save();
  ctx.translate(cx, cy + bob);

  const colors = {
    foothold: C.mint,
    breathing: C.sky,
    boundaries: C.gold,
    support: C.wine,
  };
  const color = colors[entity.kind] || C.mint;

  // Мягкое свечение.
  if (!reducedMotion) {
    const glow = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.6);
    glow.addColorStop(0, "rgba(255,255,255,0.5)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  // Иконка-подсказка внутри.
  ctx.strokeStyle = C.paper;
  ctx.fillStyle = C.paper;
  ctx.lineWidth = Math.max(2, r * 0.14);
  ctx.lineCap = "round";
  if (entity.kind === "foothold") {
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (entity.kind === "breathing") {
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
    ctx.stroke();
  } else if (entity.kind === "boundaries") {
    ctx.beginPath();
    ctx.rect(-r * 0.42, -r * 0.42, r * 0.84, r * 0.84);
    ctx.stroke();
  } else if (entity.kind === "support") {
    // две смыкающиеся дуги — «рядом».
    ctx.beginPath();
    ctx.arc(-r * 0.18, 0, r * 0.35, -Math.PI / 2, Math.PI / 2);
    ctx.arc(r * 0.18, 0, r * 0.35, Math.PI / 2, -Math.PI / 2);
    ctx.stroke();
  }

  ctx.restore();
}
