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
const rateLimit = require("../lib/rate-limit.js");

// Тело запроса к /api/auth — это форма входа с единственным полем `password`.
// Килобайта на неё хватает с большим запасом, поэтому читаем строго с лимитом:
// иначе любой желающий отправит POST на сотню мегабайт и уронит контейнер по
// памяти (OOM), просто потому что тело склеивалось в строку без ограничений.
const MAX_PAYLOAD_SIZE = 1024; // байт

// Маркер «тело превысило лимит» — его нельзя спутать с пустым телом.
const PAYLOAD_TOO_LARGE = Symbol("payload-too-large");

// Поток может выдать ошибку в любой момент (обрыв сокета, req.destroy() ниже).
// Без слушателя событие 'error' на потоке роняет весь процесс, поэтому вешаем
// пустую заглушку на оба потока в самом начале обработки.
function ignoreStreamErrors(stream) {
  if (stream && typeof stream.on === "function") stream.on("error", () => {});
}

function chunkSize(chunk) {
  return Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
}

function readRawBody(req, limit = MAX_PAYLOAD_SIZE) {
  return new Promise((resolve) => {
    // Заголовок может врать, но если он честно объявляет слишком большое тело —
    // отказываем, не прочитав ни байта.
    const declared = Number(req.headers && req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      resolve(PAYLOAD_TOO_LARGE);
      return;
    }

    let chunks = [];
    let size = 0;
    let settled = false;

    // Слушатели намеренно не снимаем: поздние 'error'/'aborted' должны попадать
    // в обработчик, а не всплывать как необработанное событие. Повторные вызовы
    // гасит флаг settled.
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    req.on("data", (chunk) => {
      if (settled) return;
      size += chunkSize(chunk);
      if (size > limit) {
        chunks = []; // отпускаем уже накопленное
        req.pause(); // перестаём вычитывать сокет прямо сейчас
        done(PAYLOAD_TOO_LARGE);
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    req.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => done(""));
    req.on("aborted", () => done(""));
  });
}

async function getSubmittedPassword(req) {
  if (req.body) {
    // На некоторых платформах тело разбирает сама платформа — там свои лимиты,
    // но проверяем и этот путь, чтобы правило было одно для всех входов.
    if (typeof req.body === "string") {
      if (Buffer.byteLength(req.body) > MAX_PAYLOAD_SIZE) return PAYLOAD_TOO_LARGE;
      return new URLSearchParams(req.body).get("password") || "";
    }
    if (typeof req.body === "object") return req.body.password || "";
  }
  const raw = await readRawBody(req);
  if (raw === PAYLOAD_TOO_LARGE) return PAYLOAD_TOO_LARGE;
  return new URLSearchParams(raw).get("password") || "";
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Ответ мог уже уйти (или соединение — умереть): второй res.send() бросил бы
// исключение, поэтому все отправки идут через эту проверку.
function canRespond(res) {
  return !res.headersSent && !res.writableEnded && !res.destroyed;
}

function sendHtml(res, html) {
  if (!canRespond(res)) return;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(html);
}

// Рвём соединение, но только после того, как ответ ушёл клиенту: уничтоженный
// сокет отправляет RST, и тогда клиент не увидит ни 413, ни чего-либо ещё.
// Таймер — страховка на случай, если ответ так и не будет дописан.
function destroyAfterResponse(req, res) {
  let killed = false;
  const kill = () => {
    if (killed) return;
    killed = true;
    clearTimeout(timer);
    // Вызов происходит из таймера/события: брошенное здесь исключение никто не
    // поймает, поэтому проверяем и оборачиваем.
    try {
      if (!req.destroyed && typeof req.destroy === "function") req.destroy();
    } catch (err) {
      console.error("auth: не удалось оборвать соединение", err);
    }
  };
  const timer = setTimeout(kill, 1000);
  if (typeof timer.unref === "function") timer.unref();
  res.on("finish", kill);
  res.on("close", kill);
}

function sendPayloadTooLarge(req, res) {
  if (canRespond(res)) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Connection", "close");
    res.status(413).send("Слишком большой запрос.");
  }
  destroyAfterResponse(req, res);
}

// Тело запроса мы в этом случае не читаем, поэтому закрываем соединение так же,
// как на 413: иначе клиент продолжит слать байты уже никому.
function sendTooManyRequests(req, res, retryAfter) {
  if (canRespond(res)) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Connection", "close");
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).send("Слишком много попыток входа. Попробуйте позже.");
  }
  destroyAfterResponse(req, res);
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
        var target = ${target};
        var sent = false;
        function send() {
          if (sent || !window.opener) return;
          sent = true;
          window.opener.postMessage(message, target);
        }
        function receive(e) {
          if (target !== "*" && e.origin !== target) return;
          send();
          window.removeEventListener("message", receive, false);
        }
        // Штатный путь: CMS отвечает на рукопожатие — тогда отправляем токен.
        window.addEventListener("message", receive, false);
        if (window.opener) window.opener.postMessage("authorizing:github", target);
        // Запасной путь: окно того же домена, адрес известен — отправляем напрямую.
        setTimeout(send, 800);
      })();
    </script>
  </body>
</html>`;
}

module.exports = async (req, res) => {
  // Заглушки на 'error' ставим до любой работы: соединение может оборваться
  // (в том числе из-за нашего же req.destroy()), и необработанное событие
  // 'error' на потоке завершило бы процесс.
  ignoreStreamErrors(req);
  ignoreStreamErrors(res);

  try {
    const token = process.env.GITHUB_TOKEN;
    const password = process.env.ADMIN_PASSWORD;

    if (!token || !password) {
      sendHtml(
        res,
        formPage("Панель не настроена: задайте GITHUB_TOKEN и ADMIN_PASSWORD в Vercel."),
      );
      return;
    }

    const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const selfOrigin = `${proto}://${host}`;

    if (req.method === "POST") {
      // Лимитируем только попытки входа: GET просто рисует форму. Проверка идёт
      // до чтения тела — перебирающему пароль незачем давать даже это.
      const limit = rateLimit.consume(rateLimit.clientIp(req));
      if (!limit.allowed) {
        sendTooManyRequests(req, res, limit.retryAfter);
        return;
      }

      const submitted = await getSubmittedPassword(req);
      if (submitted === PAYLOAD_TOO_LARGE) {
        sendPayloadTooLarge(req, res);
        return;
      }
      if (safeEqual(submitted, password)) {
        sendHtml(res, successPage(token, selfOrigin));
      } else {
        sendHtml(res, formPage("Неверный пароль."));
      }
      return;
    }

    sendHtml(res, formPage());
  } catch (err) {
    // Сюда попадают только неожиданные сбои (например, запись в уже мёртвый
    // сокет). Ронять процесс из-за одного запроса нельзя.
    console.error("auth: ошибка обработки запроса", err);
    if (canRespond(res)) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.status(500).send("Внутренняя ошибка.");
    }
  }
};
