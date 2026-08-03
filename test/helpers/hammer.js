// Вспомогательный процесс для теста: долбит лимитер и печатает результат в JSON.
// Запускается несколько раз параллельно — так проверяется, что счётчик общий.
//
// Аргументы: <ключ> <число попыток>
// Настройки лимитера приходят через переменные окружения (см. lib/rate-limit.js).

"use strict";

const rateLimit = require("../../lib/rate-limit.js");

const key = process.argv[2];
const attempts = Number(process.argv[3]);

let allowed = 0;
let blocked = 0;

for (let i = 0; i < attempts; i += 1) {
  if (rateLimit.consume(key).allowed) allowed += 1;
  else blocked += 1;
}

process.stdout.write(JSON.stringify({ pid: process.pid, allowed, blocked }));
