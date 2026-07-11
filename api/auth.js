// OAuth-старт для панели редактирования (Sveltia/Decap CMS).
// Перенаправляет администратора на страницу авторизации GitHub.
//
// Требуются переменные окружения в Vercel:
//   GITHUB_CLIENT_ID     — Client ID GitHub OAuth App
//   GITHUB_CLIENT_SECRET — Client Secret (используется в callback)

const crypto = require("crypto");

module.exports = (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;

  if (!clientId) {
    res.status(500).send("Не задана переменная окружения GITHUB_CLIENT_ID.");
    return;
  }

  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const redirectUri = `${proto}://${host}/api/callback`;

  // Случайный state для защиты от CSRF — кладём в httpOnly cookie и проверим в callback.
  const state = crypto.randomBytes(16).toString("hex");

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "repo,user");
  authorizeUrl.searchParams.set("state", state);

  res.setHeader(
    "Set-Cookie",
    `cms_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  );
  res.writeHead(302, { Location: authorizeUrl.toString() });
  res.end();
};
