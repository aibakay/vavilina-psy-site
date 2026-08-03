// Лимитер попыток входа, общий для нескольких процессов на одной машине.
//
// Зачем не `new Map()`: состояние в памяти живёт внутри одного процесса. В
// cluster mode (PM2, `node --cluster`) или в нескольких контейнерах на хосте
// счётчики не сходятся — перебирающий пароль просто попадает на соседнего
// воркера и получает лимит заново.
//
// Здесь счётчик лежит в файле, поэтому его видят все процессы, у которых общий
// каталог. Формат нарочно примитивный:
//
//   • один файл на пару (окно, IP): `w<номер окна>-<хэш IP>`;
//   • одна попытка — один байт, дописанный в конец файла;
//   • число попыток = размер файла в байтах.
//
// Такой формат не требует блокировок. Дозапись маленького куска в файл,
// открытый с O_APPEND (`fs.appendFileSync`), атомарна: параллельные процессы
// не затирают друг друга и не путают порядок. Считать тоже нечего — размер
// файла отдаёт stat(2). Разбора и перезаписи файла нет вовсе, а значит нет и
// гонок, ради которых пришлось бы городить lock-файлы.
//
// Границы применимости: общий каталог = общая файловая система. Несколько
// реплик на разных хостах (или serverless-инстансы) друг друга по-прежнему не
// видят — про это см. раздел «Scaling» в README.md.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const WINDOW_MS = positiveInt(process.env.AUTH_WINDOW_MS, 15 * 60 * 1000); // 15 минут
const MAX_ATTEMPTS = positiveInt(process.env.AUTH_MAX_ATTEMPTS, 10);

// Каталог со счётчиками. По умолчанию — временный каталог хоста: он есть везде,
// доступен на запись и переживает перезапуск отдельного воркера. Все процессы,
// которые должны считать вместе, обязаны видеть один и тот же путь (для
// нескольких контейнеров — общий том).
const COUNTER_DIR =
  process.env.AUTH_RATE_LIMIT_DIR || path.join(os.tmpdir(), "vavilina-auth-rate-limit");

// `memory` возвращает старое поведение (счётчик в памяти процесса) — например,
// если файловая система только для чтения и запасной путь не нужен.
const STORE_KIND = process.env.AUTH_RATE_LIMIT_STORE === "memory" ? "memory" : "file";

// Одна попытка — один байт.
const TICK = ".";

// Потолок на размер файла: выше него дописывать бессмысленно (лимит уже
// превышен), а расти файлу незачем. Заодно это защита от того, чтобы перебор с
// одного IP раздувал файл гигабайтами.
const MAX_RECORDS = MAX_ATTEMPTS + 256;

// Имя файла строим из хэша, а не из самого IP: адрес приходит из заголовков и
// в имени файла ему делать нечего (разделители пути, `..`, двоеточия IPv6).
// Побочная польза — на диске не лежат адреса посетителей в открытом виде.
function hashKey(key) {
  return crypto.createHash("sha256").update(String(key)).digest("hex").slice(0, 32);
}

function windowIndex(now) {
  return Math.floor(now / WINDOW_MS);
}

function fileSize(file) {
  try {
    return fs.statSync(file).size;
  } catch (err) {
    // ENOENT — попыток с этого IP в текущем окне ещё не было.
    if (err && err.code === "ENOENT") return 0;
    throw err;
  }
}

// --- Хранилище в файлах -----------------------------------------------------

let lastSweep = 0;

// Файлы прошлых окон никому не нужны: удаляем их не по таймеру, а по ходу дела,
// не чаще раза в окно. Таймер (setInterval) в serverless-окружении может просто
// не успеть сработать между вызовами, а этот путь отрабатывает всегда.
function sweep(now) {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  const current = windowIndex(now);
  let names;
  try {
    names = fs.readdirSync(COUNTER_DIR);
  } catch {
    return;
  }
  for (const name of names) {
    const dash = name.indexOf("-");
    if (dash < 1 || name[0] !== "w") continue;
    const index = Number(name.slice(1, dash));
    if (!Number.isFinite(index) || index >= current) continue;
    try {
      fs.unlinkSync(path.join(COUNTER_DIR, name));
    } catch {
      // Файл мог удалить параллельный процесс — это ровно то, чего мы хотели.
    }
  }
}

function fileStore(key, now) {
  const index = windowIndex(now);
  const file = path.join(COUNTER_DIR, `w${index}-${hashKey(key)}`);

  let count = fileSize(file);
  if (count < MAX_RECORDS) {
    // Сначала отмечаем попытку, потом считаем — так свой байт всегда попадает в
    // ответ. Если параллельный процесс успел дописать между двумя вызовами, мы
    // увидим число не меньше настоящего: на странице входа ошибаться в сторону
    // строгости безопаснее, чем в сторону лишней попытки.
    fs.appendFileSync(file, TICK);
    count = fileSize(file);
  }

  sweep(now);
  return { count, resetAt: (index + 1) * WINDOW_MS };
}

// --- Запасное хранилище в памяти -------------------------------------------
// Работает только в пределах процесса. Используется, если файловый путь
// недоступен (read-only ФС, нет прав), — вход не должен падать из-за лимитера.

const hits = new Map(); // ключ -> { count, resetAt }

function memoryStore(key, now) {
  for (const [k, rec] of hits) {
    if (now > rec.resetAt) hits.delete(k);
  }
  let rec = hits.get(key);
  if (!rec || now > rec.resetAt) {
    rec = { count: 0, resetAt: (windowIndex(now) + 1) * WINDOW_MS };
    hits.set(key, rec);
  }
  rec.count += 1;
  return { count: rec.count, resetAt: rec.resetAt };
}

// --- Выбор хранилища --------------------------------------------------------

let store = null;

function useMemory(reason, err) {
  if (store !== memoryStore) {
    console.error(
      `rate-limit: счётчик переключён в память (${reason}) — ` +
        "лимит перестал быть общим для процессов",
      err || "",
    );
  }
  store = memoryStore;
  return store;
}

function currentStore() {
  if (store) return store;
  if (STORE_KIND === "memory") {
    store = memoryStore;
    return store;
  }
  try {
    fs.mkdirSync(COUNTER_DIR, { recursive: true });
    store = fileStore;
  } catch (err) {
    return useMemory(`каталог ${COUNTER_DIR} недоступен`, err);
  }
  return store;
}

/**
 * Учитывает одну попытку и говорит, пропускать ли её.
 *
 * @param {string} key ключ лимита (обычно IP клиента)
 * @returns {{allowed: boolean, count: number, limit: number, retryAfter: number}}
 *          retryAfter — секунды до сброса окна (для заголовка Retry-After).
 */
function consume(key) {
  const now = Date.now();
  let result;
  try {
    result = currentStore()(key, now);
  } catch (err) {
    // Файл мог стать недоступен уже после старта (кончилось место, том отвалился).
    result = useMemory("сбой при записи счётчика", err)(key, now);
  }
  return {
    allowed: result.count <= MAX_ATTEMPTS,
    count: result.count,
    limit: MAX_ATTEMPTS,
    retryAfter: Math.max(1, Math.ceil((result.resetAt - now) / 1000)),
  };
}

/**
 * IP клиента. За Express с `trust proxy` адрес уже разобран в `req.ip`; на
 * Vercel такого поля нет, поэтому берём первый адрес из X-Forwarded-For —
 * его проставляет edge платформы.
 */
function clientIp(req) {
  if (req && req.ip) return req.ip;
  const forwarded = req && req.headers && req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  const socket = (req && (req.socket || req.connection)) || null;
  return (socket && socket.remoteAddress) || "unknown";
}

module.exports = {
  consume,
  clientIp,
  WINDOW_MS,
  MAX_ATTEMPTS,
  COUNTER_DIR,
};
