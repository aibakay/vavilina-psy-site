// Тесты лимитера входа. Запуск: `npm test` (нужен Node 18+ — используется
// встроенный раннер `node --test`).

"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, describe, it } = require("node:test");

const HAMMER = path.join(__dirname, "helpers", "hammer.js");
const LIB = path.join(__dirname, "..", "lib", "rate-limit.js");

const dirs = [];

function freshDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-test-"));
  dirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

// Каждый тест берёт свой каталог и свой ключ, поэтому прогоны не мешают друг другу.
function env(extra) {
  return {
    ...process.env,
    AUTH_RATE_LIMIT_DIR: extra.dir,
    AUTH_MAX_ATTEMPTS: String(extra.max),
    // Окно заведомо длиннее теста: оно не должно смениться посреди прогона.
    AUTH_WINDOW_MS: String(extra.windowMs || 60_000),
    ...(extra.store ? { AUTH_RATE_LIMIT_STORE: extra.store } : {}),
  };
}

function hammer(key, attempts, options) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [HAMMER, key, String(attempts)],
      { env: env(options) },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`${err.message}\n${stderr}`));
          return;
        }
        resolve(JSON.parse(stdout));
      },
    );
  });
}

// Модуль читает переменные окружения один раз при загрузке, поэтому для тестов
// внутри этого процесса подменяем окружение и берём свежую копию модуля.
function loadLib(options) {
  const saved = { ...process.env };
  Object.assign(process.env, env(options));
  delete require.cache[require.resolve(LIB)];
  try {
    return require(LIB);
  } finally {
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, saved);
  }
}

describe("лимитер входа", () => {
  it("пропускает ровно AUTH_MAX_ATTEMPTS попыток в одном процессе", () => {
    const limiter = loadLib({ dir: freshDir(), max: 5 });
    const results = [];
    for (let i = 0; i < 8; i += 1) results.push(limiter.consume("1.2.3.4").allowed);
    assert.deepEqual(results, [true, true, true, true, true, false, false, false]);
  });

  it("считает разные IP независимо", () => {
    const limiter = loadLib({ dir: freshDir(), max: 2 });
    assert.equal(limiter.consume("10.0.0.1").allowed, true);
    assert.equal(limiter.consume("10.0.0.1").allowed, true);
    assert.equal(limiter.consume("10.0.0.1").allowed, false);
    // Соседний адрес не должен пострадать от чужого перебора.
    assert.equal(limiter.consume("10.0.0.2").allowed, true);
  });

  it("отдаёт Retry-After в пределах окна", () => {
    const limiter = loadLib({ dir: freshDir(), max: 1, windowMs: 60_000 });
    const { retryAfter } = limiter.consume("10.0.0.3");
    assert.ok(retryAfter >= 1 && retryAfter <= 60, `retryAfter = ${retryAfter}`);
  });

  // Главный сценарий: то, ради чего лимитер вынесен из памяти процесса.
  it("держит общий лимит на 4 процессах сразу", async () => {
    const dir = freshDir();
    const max = 10;
    const key = "203.0.113.7";

    // 4 процесса × 25 попыток = 100 попыток на один и тот же IP.
    const runs = await Promise.all(
      [0, 1, 2, 3].map(() => hammer(key, 25, { dir, max })),
    );

    const allowed = runs.reduce((sum, r) => sum + r.allowed, 0);
    const blocked = runs.reduce((sum, r) => sum + r.blocked, 0);

    assert.equal(allowed + blocked, 100, "учтены все попытки");
    assert.equal(
      allowed,
      max,
      `суммарно пропущено ${allowed} попыток вместо ${max} — счётчик не общий`,
    );
    assert.equal(new Set(runs.map((r) => r.pid)).size, 4, "процессы действительно разные");
  });

  it("в режиме memory лимит у каждого процесса свой (регресс, который мы чиним)", async () => {
    const dir = freshDir();
    const max = 10;
    const runs = await Promise.all(
      [0, 1].map(() => hammer("198.51.100.9", 25, { dir, max, store: "memory" })),
    );
    const allowed = runs.reduce((sum, r) => sum + r.allowed, 0);
    // Ровно то поведение, из-за которого лимит обходился переключением воркера.
    assert.equal(allowed, max * 2);
  });

  it("не падает и не пускает всех, если каталог недоступен", () => {
    const dir = freshDir();
    // Файл вместо каталога: mkdir по этому пути упадёт с ENOTDIR.
    const blockedPath = path.join(dir, "not-a-dir");
    fs.writeFileSync(blockedPath, "");
    const limiter = loadLib({ dir: path.join(blockedPath, "counters"), max: 3 });
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(limiter.consume("192.0.2.5").allowed);
    // Лимит продолжает работать, пусть и в пределах процесса.
    assert.deepEqual(results, [true, true, true, false, false]);
  });

  it("чистит файлы прошлых окон", () => {
    const dir = freshDir();
    const limiter = loadLib({ dir, max: 3, windowMs: 1 });
    limiter.consume("192.0.2.10");
    const stale = fs.readdirSync(dir);
    assert.ok(stale.length > 0, "файл счётчика создан");

    // Окно в 1 мс уже прошло; следующая попытка попадает в новое окно и по пути
    // подметает старые файлы.
    const waitUntil = Date.now() + 5;
    while (Date.now() < waitUntil) {
      /* ждём смены окна */
    }
    limiter.consume("192.0.2.10");

    const left = fs.readdirSync(dir);
    assert.equal(left.length, 1, `в каталоге осталось ${left.length} файлов: ${left}`);
    assert.notDeepEqual(left, stale, "остался файл текущего окна, а не старый");
  });
});

describe("clientIp", () => {
  const limiter = loadLib({ dir: freshDir(), max: 10 });

  it("предпочитает req.ip (Express с trust proxy)", () => {
    const ip = limiter.clientIp({ ip: "9.9.9.9", headers: { "x-forwarded-for": "1.1.1.1" } });
    assert.equal(ip, "9.9.9.9");
  });

  it("берёт первый адрес из X-Forwarded-For, если req.ip нет", () => {
    const ip = limiter.clientIp({ headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" } });
    assert.equal(ip, "1.1.1.1");
  });

  it("откатывается на адрес сокета", () => {
    assert.equal(limiter.clientIp({ headers: {}, socket: { remoteAddress: "3.3.3.3" } }), "3.3.3.3");
  });

  it("не падает на пустом запросе", () => {
    assert.equal(limiter.clientIp({}), "unknown");
  });
});
