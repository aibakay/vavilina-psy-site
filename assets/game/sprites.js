// Загрузка и нормализованная отрисовка спрайтов персонажа.
// PNG имеют разные размеры, поэтому «стоячие» кадры (idle/run/jump)
// приводятся к одной видимой высоте, а подкат рисуется как естественный
// присед — с тем же масштабом пикселей, что и беговой кадр.

import { CONFIG } from "./config.js";

// Исходная высота эталонного бегового кадра (px) — по ней считаем масштаб подката.
const RUN_REFERENCE_HEIGHT = 452;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Не удалось загрузить спрайт: ${src}`));
    img.src = src;
  });
}

export class SpriteSet {
  constructor() {
    this.images = {};
    this.ready = false;
  }

  async load() {
    const s = CONFIG.sprites;
    const [idle, run1, run2, run3, jump, slide] = await Promise.all([
      loadImage(s.idle),
      loadImage(s.run[0]),
      loadImage(s.run[1]),
      loadImage(s.run[2]),
      loadImage(s.jump),
      loadImage(s.slide),
    ]);
    this.images = { idle, run: [run1, run2, run3], jump, slide };
    this.ready = true;
    return this;
  }

  // Рисует спрайт с привязкой к «ногам» (footX, footY — точка опоры на земле).
  // standHeight — целевая видимая высота стойки в логических px.
  draw(ctx, image, footX, footY, standHeight, { crouch = false } = {}) {
    if (!image) return { width: 0, height: standHeight };

    let drawH;
    let drawW;
    if (crouch) {
      // Тот же «масштаб пикселей», что и у бегового кадра, → естественный присед.
      const unit = standHeight / RUN_REFERENCE_HEIGHT;
      drawH = image.naturalHeight * unit;
      drawW = image.naturalWidth * unit;
    } else {
      // Стоячие кадры: приводим к одинаковой видимой высоте.
      drawH = standHeight;
      drawW = standHeight * (image.naturalWidth / image.naturalHeight);
    }

    const x = Math.round(footX - drawW / 2);
    const y = Math.round(footY - drawH);
    ctx.drawImage(image, x, y, Math.round(drawW), Math.round(drawH));
    return { width: drawW, height: drawH };
  }
}
