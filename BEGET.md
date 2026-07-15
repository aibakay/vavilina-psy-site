# Перенос сайта на Beget (VPS)

Инструкция по переезду сайта Полины Вавилиной с Vercel на VPS Beget.
Сайт = статика (11ty) + маленький Node-сервер для входа в админ-панель.

---

## Что покупать

| Позиция | Что выбрать | Цена (ориентир) |
|---|---|---|
| **VPS** | Младший тариф: 1 CPU, 1 ГБ RAM, 15 ГБ SSD | ~210–330 ₽/мес |
| ОС при заказе | **Ubuntu 24.04** (или 22.04) | входит в тариф |
| Панель управления | **Не нужна** (работаем по SSH) | экономия ~150–300 ₽/мес |
| Локация | **Россия** (быстрее для местной аудитории) | входит в тариф |
| Домен | Уже есть — `vavilinaapollinaria-psy.ru` на reg.ru | — |

> Больше ресурсов брать не нужно: статичный сайт почти не грузит сервер,
> Node-процесс ест десятки МБ памяти. Это в разы дешевле Vercel Pro (~1800 ₽/мес).

---

## Последовательность действий

### Этап 1. Заказать VPS
1. Зарегистрируйтесь / войдите на https://beget.com
2. Раздел **VPS** → закажите младший тариф, ОС **Ubuntu 24.04**, без панели.
3. После создания придёт письмо с **IP-адресом**, логином `root` и паролем.

### Этап 2. Подготовить токен и пароль для админки
Понадобятся две секретные строки (те же, что были на Vercel):

- **`GITHUB_TOKEN`** — fine-grained Personal Access Token GitHub.
  Создать: https://github.com/settings/tokens?type=beta →
  доступ только к репозиторию `aibakay/vavilina-psy-site`,
  права **Contents: Read and write**. (Подробно — в `ADMIN.md`, Шаг 1.)
- **`ADMIN_PASSWORD`** — пароль для входа клиента в панель (придумать любой).

Сохраните обе строки — вставим их на сервере.

### Этап 3. Зайти на сервер и установить Docker
Подключитесь по SSH (в терминале Mac/Windows или через веб-консоль Beget):

```bash
ssh root@ВАШ_IP
```

Установите Docker:

```bash
apt update && apt install -y docker.io git
systemctl enable --now docker
```

### Этап 4. Забрать код и собрать образ
```bash
git clone https://github.com/aibakay/vavilina-psy-site.git
cd vavilina-psy-site
git checkout main          # или нужную ветку, если правки ещё не в main
docker build -t vavilina-site .
```
Сборка займёт 1–2 минуты (ставит зависимости и собирает сайт).

### Этап 5. Запустить сайт
```bash
docker run -d \
  --name vavilina-site \
  --restart unless-stopped \
  -p 80:3000 \
  -e GITHUB_TOKEN="ваш_github_токен" \
  -e ADMIN_PASSWORD="ваш_пароль_админки" \
  vavilina-site
```
Проверьте: откройте в браузере `http://ВАШ_IP` — должен открыться сайт.
Админка: `http://ВАШ_IP/admin/`.

### Этап 6. Подключить домен
В панели reg.ru (регистратор домена) поменяйте **A-записи**:

| Тип | Имя | Значение |
|---|---|---|
| A | `@` | `ВАШ_IP` |
| A | `www` | `ВАШ_IP` |

Если домен сейчас на NS-серверах Taplink (`ns1.taplink.cc`) — сначала
верните NS reg.ru (обычно `ns1.reg.ru`, `ns2.reg.ru`), затем правьте A-записи.
Обновление DNS занимает от 30 минут до нескольких часов.

### Этап 7. Включить HTTPS (сертификат Let's Encrypt)
Чтобы сайт работал по `https://`, поставим бесплатный сертификат через
Caddy (сам получает и продлевает сертификат). На сервере:

```bash
# остановим контейнер, чтобы Caddy занял 80/443 порты
docker stop vavilina-site && docker rm vavilina-site

# запустим сайт только на внутреннем порту
docker run -d --name vavilina-site --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e GITHUB_TOKEN="ваш_github_токен" \
  -e ADMIN_PASSWORD="ваш_пароль_админки" \
  vavilina-site

# установим Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

Настройте Caddy — отредактируйте `/etc/caddy/Caddyfile`, замените содержимое на:

```
vavilinaapollinaria-psy.ru, www.vavilinaapollinaria-psy.ru {
    reverse_proxy 127.0.0.1:3000
}
```

Перезапустите:
```bash
systemctl restart caddy
```
Caddy сам получит HTTPS-сертификат (нужно, чтобы домен уже указывал на IP — этап 6).

---

## Обновление сайта в будущем

Правки контента клиент делает через админку — они коммитятся в GitHub,
**но на VPS сами не применяются** (в отличие от Vercel). Чтобы подтянуть
изменения, на сервере выполните:

```bash
cd vavilina-psy-site
git pull
docker build -t vavilina-site .
docker restart vavilina-site        # либо stop+rm+run, если меняли порты
```

> Это ручной шаг. Если нужно **автообновление** после правок в админке —
> можно настроить GitHub webhook + скрипт пересборки. Скажите, добавлю.

---

## Безопасность

Часть защиты встроена прямо в приложение (`server.js`), поэтому дополнительной
настройки на сервере не требует:

- **Ограничение попыток входа** в админку (`POST /api/auth`) — не более 10
  попыток с одного IP за 15 минут, затем `429`. Защищает пароль от перебора.
- **Security-заголовки** на всех ответах: `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`,
  `Permissions-Policy` и `Content-Security-Policy` (CSP — для публичного сайта,
  на `/admin/` не ставится, чтобы не сломать панель).
- Контейнер работает **не от root** (`USER node` в `Dockerfile`).

**Скрипт админки запинен по версии + SRI.** В `admin/index.html` подключается
конкретная версия `@sveltia/cms@X.Y.Z` с `integrity`-хэшем. Чтобы обновить CMS
на новую версию:

```bash
# 1) узнать новую версию
curl -s https://registry.npmjs.org/@sveltia/cms/latest | grep -o '"version":"[^"]*"'
# 2) посчитать SRI для файла этой версии
curl -sL https://unpkg.com/@sveltia/cms@НОВАЯ_ВЕРСИЯ/dist/sveltia-cms.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
# 3) вписать новую версию и хэш в admin/index.html (src + integrity), закоммитить
```

> Если после обновления версии не пересчитать `integrity` — браузер откажется
> грузить скрипт и панель не откроется. Это защита от подмены файла на CDN.

---

## Отличия от Vercel (важно понимать)

| | Vercel | Beget VPS |
|---|---|---|
| Пересборка после правок в админке | автоматически | вручную (`git pull` + rebuild) |
| HTTPS | автоматически | ставим Caddy (этап 7) |
| Стоимость домена | Pro-план ~1800 ₽/мес | ~210–330 ₽/мес |
| Обслуживание сервера | не нужно | ваше (обновления ОС и т.п.) |

---

## Чек-лист

- [ ] Заказан VPS Beget (Ubuntu, без панели), получен IP
- [ ] Создан `GITHUB_TOKEN`, придуман `ADMIN_PASSWORD`
- [ ] Установлен Docker, склонирован репозиторий, собран образ
- [ ] Контейнер запущен, сайт открывается по IP
- [ ] A-записи домена указывают на IP (NS возвращены на reg.ru)
- [ ] Настроен Caddy, сайт работает по `https://`
- [ ] Проверен вход в админку по паролю
