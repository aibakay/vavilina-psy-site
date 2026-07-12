// Продакшн-сервер для хостинга без serverless-функций (например, Timeweb Cloud Apps).
// Отдаёт статическую сборку из _site и обслуживает /api/auth для входа в админ-панель.
// На Vercel этот файл не используется — там работает api/auth.js как serverless-функция.

const express = require("express");
const path = require("path");
const authHandler = require("./api/auth.js");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.set("trust proxy", true);

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
