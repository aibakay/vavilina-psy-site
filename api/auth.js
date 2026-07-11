// Вход в панель редактирования по паролю (без GitHub-аккаунта у клиента).
//
// Панель Sveltia CMS ждёт, что окно авторизации вернёт валидный GitHub-токен.
// Здесь мы закрываем вход простым паролем и, при верном пароле, отдаём один
// общий токен владельца. Все правки коммитятся от имени владельца.
//
// Переменные окружения в Vercel:
//   GITHUB_TOKEN   — fine-grained Personal Access Token (доступ только к этому
//                    репозиторию, права Contents: read/write)
//   ADMIN_PASSWORD — пароль для входа в панель

const crypto = require("crypto");

function readRawBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

async function getSubmittedPassword(req) {
  if (req.body) {
    if (typeof req.body === "object") return req.body.password || "";
    if (typeof req.body === "string") return new URLSearchParams(req.body).get("password") || "";
  }
  const raw = await readRawBody(req);
  return new URLSearchParams(raw).get("password") || "";
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function sendHtml(res, html) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(html);
}

// Форма ввода пароля.
function formPage(error) {
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Вход в панель</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        background: #f4f1ec; color: #2b2b2b; }
      form { background: #fff; padding: 32px; border-radius: 16px; width: min(90vw, 340px);
        box-shadow: 0 12px 40px rgba(0,0,0,.08); box-sizing: border-box; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      p.sub { margin: 0 0 20px; color: #7a746c; font-size: 14px; }
      label { display: block; font-size: 13px; margin-bottom: 6px; color: #5a544c; }
      input { width: 100%; padding: 12px 14px; font-size: 15px; border: 1px solid #dcd6cc;
        border-radius: 10px; box-sizing: border-box; }
      input:focus { outline: none; border-color: #b08d57; }
      button { width: 100%; margin-top: 16px; padding: 12px; font-size: 15px; font-weight: 600;
        color: #fff; background: #2b2b2b; border: 0; border-radius: 10px; cursor: pointer; }
      button:hover { background: #444; }
      .error { color: #b3261e; font-size: 13px; margin-top: 12px; }
    </style>
  </head>
  <body>
    <form method="POST" action="/api/auth">
      <h1>Панель редактирования</h1>
      <p class="sub">Введите пароль для входа.</p>
      <label for="password">Пароль</label>
      <input id="password" name="password" type="password" autocomplete="current-password" autofocus required />
      <button type="submit">Войти</button>
      ${error ? `<div class="error">${error}</div>` : ""}
    </form>
  </body>
</html>`;
}

// Страница успеха: возвращает токен в окно панели (протокол Netlify/Decap).
function successPage(token, targetOrigin) {
  const message = JSON.stringify(
    `authorization:github:success:${JSON.stringify({ token, provider: "github" })}`,
  );
  const target = JSON.stringify(targetOrigin || "*");
  return `<!doctype html>
<html lang="ru">
  <head><meta charset="utf-8" /><title>Вход выполнен…</title></head>
  <body>
    <p>Входим…</p>
    <script>
      (function () {
        var message = ${message};
        var allowed = ${target};
        function receive(e) {
          if (allowed !== "*" && e.origin !== allowed) return;
          window.opener && window.opener.postMessage(message, allowed === "*" ? e.origin : allowed);
          window.removeEventListener("message", receive, false);
        }
        window.addEventListener("message", receive, false);
        window.opener && window.opener.postMessage("authorizing:github", allowed);
      })();
    </script>
  </body>
</html>`;
}

module.exports = async (req, res) => {
  const token = process.env.GITHUB_TOKEN;
  const password = process.env.ADMIN_PASSWORD;

  if (!token || !password) {
    sendHtml(res, formPage("Панель не настроена: задайте GITHUB_TOKEN и ADMIN_PASSWORD в Vercel."));
    return;
  }

  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const selfOrigin = `${proto}://${host}`;

  if (req.method === "POST") {
    const submitted = await getSubmittedPassword(req);
    if (safeEqual(submitted, password)) {
      sendHtml(res, successPage(token, selfOrigin));
    } else {
      sendHtml(res, formPage("Неверный пароль."));
    }
    return;
  }

  sendHtml(res, formPage());
};
