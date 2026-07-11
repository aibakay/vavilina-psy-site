// OAuth-callback для панели редактирования (Sveltia/Decap CMS).
// GitHub перенаправляет сюда с ?code=...&state=...; меняем код на токен
// и возвращаем его в окно панели через postMessage (протокол Netlify/Decap).
//
// Требуются переменные окружения в Vercel:
//   GITHUB_CLIENT_ID
//   GITHUB_CLIENT_SECRET
// Необязательно:
//   ALLOWED_DOMAINS — список доменов через запятую, которым разрешено получать токен
//                     (по умолчанию — только сам сайт).

function parseCookies(header) {
  const out = {};
  (header || "").split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx > -1) {
      out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    }
  });
  return out;
}

// Страница, которая передаёт результат в окно, открывшее popup.
function renderResult(status, content, allowedOrigin) {
  const payload = JSON.stringify(`authorization:github:${status}:${JSON.stringify(content)}`);
  const target = JSON.stringify(allowedOrigin || "*");
  return `<!doctype html>
<html lang="ru">
  <head><meta charset="utf-8" /><title>Авторизация…</title></head>
  <body>
    <p>Завершаем авторизацию…</p>
    <script>
      (function () {
        var message = ${payload};
        var allowed = ${target};
        function send(origin) {
          window.opener && window.opener.postMessage(message, origin);
        }
        function receive(e) {
          if (allowed !== "*" && e.origin !== allowed) return;
          send(allowed === "*" ? e.origin : allowed);
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
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const selfOrigin = `${proto}://${host}`;

  // Кому разрешено получить токен: сам сайт + список из ALLOWED_DOMAINS.
  const allowedList = [selfOrigin].concat(
    (process.env.ALLOWED_DOMAINS || "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => (d.startsWith("http") ? d : `https://${d}`)),
  );
  const primaryOrigin = allowedList[0];

  const sendHtml = (html) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(html);
  };

  if (!clientId || !clientSecret) {
    sendHtml(renderResult("error", "Не заданы GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET.", primaryOrigin));
    return;
  }

  const url = new URL(req.url, selfOrigin);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = parseCookies(req.headers.cookie);

  if (!code) {
    sendHtml(renderResult("error", "GitHub не вернул код авторизации.", primaryOrigin));
    return;
  }
  if (!state || state !== cookies.cms_oauth_state) {
    sendHtml(renderResult("error", "Проверка state не пройдена. Повторите вход.", primaryOrigin));
    return;
  }

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });
    const data = await tokenRes.json();

    if (data.error || !data.access_token) {
      sendHtml(renderResult("error", data.error_description || data.error || "Не удалось получить токен.", primaryOrigin));
      return;
    }

    // Сбрасываем cookie со state.
    res.setHeader("Set-Cookie", "cms_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    sendHtml(
      renderResult("success", { token: data.access_token, provider: "github" }, primaryOrigin),
    );
  } catch (err) {
    sendHtml(renderResult("error", "Ошибка обмена кода на токен: " + err.message, primaryOrigin));
  }
};
