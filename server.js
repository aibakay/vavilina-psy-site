// Продакшн-сервер для хостинга без serverless-функций (например, Timeweb Cloud Apps).
// Отдаёт статическую сборку из _site и обслуживает /api/auth для входа в админ-панель.
// На Vercel этот файл не используется — там работает api/auth.js как serverless-функция.

const express = require("express");
const path = require("path");
const authHandler = require("./api/auth.js");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
// Доверяем только первому прокси (Caddy перед приложением), а не любым
// заголовкам X-Forwarded-* — иначе req.ip и протокол можно подделать.
app.set("trust proxy", 1);

// --- Security-заголовки ----------------------------------------------------
// Ставятся на все ответы. CSP не применяем к /admin/: панели Sveltia CMS нужны
// web-workers, wasm и обращения к api.github.com — строгий CSP её ломает.
// От кликджекинга админку всё равно защищает X-Frame-Options.
const CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' https://mc.yandex.ru; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; " +
  "img-src 'self' data: https://mc.yandex.ru; " +
  "connect-src 'self' https://mc.yandex.ru; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'";

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  if (!req.path.startsWith("/admin")) {
    res.setHeader("Content-Security-Policy", CSP);
  }
  next();
});

// --- Защита входа от перебора ----------------------------------------------
// Простой in-memory лимитер по IP: не больше AUTH_MAX_ATTEMPTS запросов за
// AUTH_WINDOW_MS. Один процесс/контейнер, состояние в памяти — этого достаточно.
const AUTH_WINDOW_MS = 15 * 60 * 1000; // 15 минут
const AUTH_MAX_ATTEMPTS = 10;
const authHits = new Map(); // ip -> { count, resetAt }

// Периодическая очистка устаревших записей, чтобы Map не рос бесконечно.
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of authHits) {
    if (now > rec.resetAt) authHits.delete(ip);
  }
}, AUTH_WINDOW_MS).unref();

function authRateLimit(req, res, next) {
  // Лимитируем только попытки входа (POST с паролем); GET просто рисует форму.
  if (req.method !== "POST") return next();
  const now = Date.now();
  const ip = req.ip || "unknown";
  let rec = authHits.get(ip);
  if (!rec || now > rec.resetAt) {
    rec = { count: 0, resetAt: now + AUTH_WINDOW_MS };
    authHits.set(ip, rec);
  }
  rec.count += 1;
  if (rec.count > AUTH_MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((rec.resetAt - now) / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).type("text").send("Слишком много попыток входа. Попробуйте позже.");
    return;
  }
  next();
}

app.all("/api/auth", authRateLimit, (req, res) => authHandler(req, res));

app.use(express.static(path.join(__dirname, "_site"), { extensions: ["html"] }));

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "_site", "404.html"), (err) => {
    if (err) res.status(404).type("text").send("Страница не найдена");
  });
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
