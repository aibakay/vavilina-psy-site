// Идентификатор сборки для версионирования статических ассетов (cache-busting).
// Меняется на каждой сборке → обновлённые файлы игры гарантированно подхватятся
// браузером после деплоя, без ручной чистки кеша.
module.exports = () => ({
  id: Date.now().toString(36),
  // Модули мини-игры «В своём ритме» (ES-модули без сборщика).
  gameModules: [
    "config",
    "analytics",
    "storage",
    "audio",
    "sprites",
    "input",
    "player",
    "spawner",
    "collisions",
    "background",
    "hud",
    "engine",
    "main",
  ],
});
