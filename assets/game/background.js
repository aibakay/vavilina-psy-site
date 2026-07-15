// Фон и параллакс: спокойный парковый силуэт в несколько слоёв, лёгкий туман.
// Фон светлеет при высоком ресурсе и слегка приглушается при низком.
// При prefers-reduced-motion параллакс и туман ослаблены.

const PALETTE = {
  skyTop: [248, 243, 237],
  skyBottom: [234, 216, 207],
  hillFar: "rgba(115, 115, 90, 0.18)",
  hillNear: "rgba(115, 115, 90, 0.28)",
  ground: "#e7d8ce",
  groundLine: "rgba(115, 24, 23, 0.18)",
};

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

export class Background {
  constructor(reducedMotion) {
    this.reducedMotion = reducedMotion;
    // Смещения слоёв (px), копятся по мере движения мира.
    this.offFar = 0;
    this.offNear = 0;
    this.offFog = 0;
    this.offGround = 0;
    // Заранее сгенерированные силуэты холмов/деревьев (стабильная форма).
    this.farHills = this._makeHills(9, 0.45);
    this.nearTrees = this._makeTrees(7);
    this.fog = this._makeFog(4);
  }

  _makeHills(count, base) {
    const arr = [];
    for (let i = 0; i < count; i += 1) {
      arr.push({ t: i / count, h: base + Math.random() * 0.25, w: 0.28 + Math.random() * 0.2 });
    }
    return arr;
  }

  _makeTrees(count) {
    const arr = [];
    for (let i = 0; i < count; i += 1) {
      arr.push({ t: (i + 0.5) / count, h: 0.5 + Math.random() * 0.4 });
    }
    return arr;
  }

  _makeFog(count) {
    const arr = [];
    for (let i = 0; i < count; i += 1) {
      arr.push({ t: i / count, y: 0.3 + Math.random() * 0.3, r: 0.3 + Math.random() * 0.25 });
    }
    return arr;
  }

  update(movedPx) {
    const factor = this.reducedMotion ? 0.15 : 1;
    this.offFar = (this.offFar + movedPx * 0.12 * factor) % 100000;
    this.offNear = (this.offNear + movedPx * 0.5 * factor) % 100000;
    this.offFog = (this.offFog + movedPx * 0.06 * factor) % 100000;
    // Земля движется с полной скоростью мира — главный визуальный сигнал бега.
    // Не ослабляется при reduced-motion: без него непонятна сама механика.
    this.offGround = (this.offGround + movedPx) % 100000;
  }

  // resourceNorm: 0..1. Управляет светлотой фона.
  draw(ctx, m, resourceNorm) {
    const { viewWidth: W, viewHeight: Hpx, groundY } = m;
    const lift = 0.85 + resourceNorm * 0.15; // светлее при высоком ресурсе

    // Небо — вертикальный градиент.
    const top = PALETTE.skyTop.map((c) => Math.min(255, mix(c, 255, (lift - 0.85) / 0.15 * 0.5)));
    const bottom = PALETTE.skyBottom.map((c) => mix(c, 255, (lift - 0.85)));
    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, `rgb(${top[0]},${top[1]},${top[2]})`);
    sky.addColorStop(1, `rgb(${bottom[0]},${bottom[1]},${bottom[2]})`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, Hpx);

    // Дальние холмы.
    this._drawHills(ctx, W, groundY, this.offFar);
    // Ближние деревья-силуэты.
    this._drawTrees(ctx, W, groundY, this.offNear);
    // Туман.
    this._drawFog(ctx, W, groundY, this.offFog, resourceNorm);

    // Земля.
    ctx.fillStyle = PALETTE.ground;
    ctx.fillRect(0, groundY, W, Hpx - groundY);
    ctx.strokeStyle = PALETTE.groundLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY + 1);
    ctx.lineTo(W, groundY + 1);
    ctx.stroke();

    // Бегущие отметины на земле — без них персонаж кажется стоящим на месте.
    this._drawGroundMarks(ctx, W, Hpx, groundY);
  }

  _drawGroundMarks(ctx, W, Hpx, groundY) {
    const gh = Hpx - groundY;
    const spacing = 90;

    let off = this.offGround % spacing;
    ctx.fillStyle = "rgba(115, 24, 23, 0.12)";
    for (let x = -off; x < W + spacing; x += spacing) {
      ctx.fillRect(x, groundY + gh * 0.38, 32, 3);
    }

    off = (this.offGround + spacing * 0.5) % spacing;
    ctx.fillStyle = "rgba(115, 115, 90, 0.2)";
    for (let x = -off; x < W + spacing; x += spacing) {
      ctx.fillRect(x + 18, groundY + gh * 0.68, 16, 3);
    }
  }

  _drawHills(ctx, W, groundY, off) {
    const span = W * 1.4;
    ctx.fillStyle = PALETTE.hillFar;
    this.farHills.forEach((hill) => {
      const x = ((hill.t * span - off) % span + span) % span - W * 0.2;
      const w = hill.w * W;
      const h = hill.h * groundY * 0.5;
      ctx.beginPath();
      ctx.moveTo(x - w, groundY);
      ctx.quadraticCurveTo(x, groundY - h, x + w, groundY);
      ctx.fill();
    });
  }

  _drawTrees(ctx, W, groundY, off) {
    const span = W * 1.2;
    ctx.fillStyle = PALETTE.hillNear;
    this.nearTrees.forEach((tree) => {
      const x = ((tree.t * span - off) % span + span) % span - W * 0.1;
      const h = tree.h * groundY * 0.4;
      const w = h * 0.5;
      // Крона.
      ctx.beginPath();
      ctx.arc(x, groundY - h, w * 0.7, 0, Math.PI * 2);
      ctx.fill();
      // Ствол.
      ctx.fillRect(x - w * 0.08, groundY - h, w * 0.16, h);
    });
    ctx.fillStyle = PALETTE.hillNear;
  }

  _drawFog(ctx, W, groundY, off, resourceNorm) {
    const alpha = (this.reducedMotion ? 0.06 : 0.12) * (0.6 + (1 - resourceNorm) * 0.4);
    ctx.fillStyle = `rgba(255, 250, 245, ${alpha})`;
    const span = W * 1.3;
    this.fog.forEach((cloud) => {
      const x = ((cloud.t * span - off) % span + span) % span - W * 0.15;
      const y = cloud.y * groundY;
      const r = cloud.r * W * 0.4;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}
