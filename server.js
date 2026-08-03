// Продакшн-сервер сайта. Работает в Docker-контейнере на Timeweb Cloud VPS за
// обратным прокси, который держит HTTPS и проксирует на порт 3000.
// Отдаёт статическую сборку из _site и обслуживает /api/auth для входа в админ-панель.

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

// Защита входа от перебора живёт внутри самого обработчика (lib/rate-limit.js),
// а не отдельной middleware здесь: так её нельзя обойти, повесив обработчик на
// ещё один маршрут и забыв про лимитер. Счётчик общий для всех процессов на
// сервере — см. раздел «Scaling» в README.md.
app.all("/api/auth", (req, res) => authHandler(req, res));

app.use(express.static(path.join(__dirname, "_site"), { extensions: ["html"] }));

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "_site", "404.html"), (err) => {
    if (err) res.status(404).type("text").send("Страница не найдена");
  });
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
