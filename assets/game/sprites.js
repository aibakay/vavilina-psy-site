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
  // Все кадры рисуются в ЕДИНОМ масштабе (px спрайта → px экрана), а не
  // растягиваются до одной высоты: кадры бега имеют разные размеры PNG,
  // и нормализация по высоте заставляла персонажа «пульсировать» шириной.
  // Единый масштаб сохраняет постоянный размер фигуры, а разница высот
  // кадров — это естественная разница поз (наклон в беге, присед в подкате).
  draw(ctx, image, footX, footY, standHeight) {
    if (!image) return;
    const unit = standHeight / RUN_REFERENCE_HEIGHT;
    const drawH = image.naturalHeight * unit;
    const drawW = image.naturalWidth * unit;
    ctx.drawImage(
      image,
      Math.round(footX - drawW / 2),
      Math.round(footY - drawH),
      Math.round(drawW),
      Math.round(drawH)
    );
  }
}
