# Автономна PHP-адмінпанель — checkpoints

## M0 — Audit

База: `2dbbabe7de5bf09d72009acd35e3290a18fd7acf` (main після PR #32).
Гілка: `feature/autonomous-php-admin`. Окремий worktree; попередні зміни не перенесені й не видалені. AGENTS.md у проєкті не знайдено.

Перевірено admin/builder.js, repository.js, document.js, index.html, lib/editor-local.js, site-routes.js, site-export.js, pwa.js, themes/routes.js, shared-header.js, scripts/build.js, server.js і структуру tests.

- GrapesJS 0.23.6 уже інтегрований; зберігаються HTML + JSON проєкту з htmlHash. Є нові сторінки, зображення, попередній перегляд і копія чернетки. Видалення/перейменування/керування меню та серверні версії потребують доповнення.
- Поточний repository adapter — GitHub або loopback-only Node API. GitHub-публікація використовує workflow. Production PHP потрібен окремий adapter зі збереженням цих режимів для попередніх середовищ.
- cleanWebsite/publishHTML використовують parse5: адреси-папки, legacy redirects, ресурси, шапка з index.html, метадані, пошук і PWA. Публікація PHP має відтворювати ці результати без запуску Node.
- Звичайний dist/ZIP не є автономною адмінкою. Новий packager повинен постачати локальний GrapesJS, PHP API/генератор, захищений seed вихідних документів та інструкцію; секрет активації передається окремо від архіву.
- Контактні форми використовують /api/contact. Це Node API; на PHP-хостингу потрібна окрема реалізація або чесне повідомлення про недоступність, без удаваної успішної доставки.

Обрана основа: PHP 8.2-сумісний код; статичний public root; приватне файлове сховище; CSRF + серверні сесії + HTTPS; одноразовий високoентропійний ключ активації (лише SHA-256 у релізі); атомарні записи, глобальне блокування, revision-перевірка; обмежені резервні версії.

Перша реалізація приватного сховища — поза document root. Якщо хостинг не дозволяє безпечно створити його, активація зупиняється з поясненням; немає неявного fallback у відкритий каталог. Додаткові режими дозволені лише з фактичною перевіркою ізоляції.

Верифікація: у початковому середовищі немає PHP/Apache/Docker; встановлюється локальний тестовий runtime. Це не обмеження, яке передається власнику. Матриця 8.2–8.5 перевірятиметься в CI; без виконаних перевірок підтримка не вважається підтвердженою. Хостинг батька не перевірений і не змінюється.

## M1 — Secure PHP core

Реалізовано (API, ще без браузерного підключення GrapesJS):

- Старосинтаксичні `diagnostic.php` і `api.php`: перевірка версії до включення коду PHP 8.2. Діагностика не записує файли.
- Приватні документи й сесії — у sibling-каталозі поза document root; symlink-перевірки. Початкова підтримка: корінь окремого домену, право створити приватну папку поряд. За відсутності цих умов — безпечна відмова.
- Випадковий ключ активації: у staging тільки SHA-256, ключ ніколи не записується під web root. Повторне встановлення заблоковане.
- password_hash/password_verify, захищені серверні сесії, ротація ID, HttpOnly/Secure/SameSite=Strict, CSRF+Origin, timeout сесії, серверний rate limit.
- JSON API: session/setup/login/logout/capabilities/tree/read/save. Дозволені HTML і JSON редактора; записи системного коду й PHP-тегів заборонені. Збереження повертає `published:false`: це чернетка, а не публікація.
- SHA-256 objects, atomic pointer, контрольні суми, revision-конфлікти й nonblocking flock; валідація всього batch до запису. Квота приватного сховища — 40 МБ.
- Staging-підготовка через `scripts/prepare-php.js` тільки для розробки; це ще не релізний packager.

Змінені файли: php/public/admin/{api,diagnostic}.php; php/runtime/{Files,Auth,Kernel}.php і .htaccess; scripts/prepare-php.js; tests/php/{core.test.cjs,router.php}; package.json; .github/workflows/php-admin.yml; цей звіт.

Локально: реальний PHP 8.3.6 (Ubuntu security package), HTTP API через справжній TLS із перевіреним тестовим сертифікатом. Інтеграційний сценарій перевіряє setup, захоплення інсталяції, вхід/вихід, cookie flags/ротацію, CSRF/Origin, підроблені proxy-заголовки, path traversal, symlink, batch-валідацію, старий revision, глобальний lock, файлову квоту та приватні файли. PASS. Lint п’яти PHP-файлів — PASS.

Перевірка chmod-readonly локально NOT TESTED: процес має UID 0, що обходить звичайні mode bits. У CI цей сценарій запускається звичайним runner-користувачем. Матриця PHP 8.2/8.3/8.4/8.5 і діагностика 5.6/7.4/8.0/8.1 — PASS: https://github.com/KingInjiro/Tcg_site/actions/runs/39156734250 (checkpoint bc2f159). Apache й чисте встановлення фінального ZIP — ще NOT TESTED.

## M2 — PHP adapter та GrapesJS

Додано PHP-режим наявного конструктора: браузерне початкове налаштування з окремим ключем, вхід/вихід, серверні документи й дані GrapesJS, локальна медіатека та приватні завантаження. Новий HTML редактора готується тільки для PHP staging; старі GitHub/Node режими збережені.

Завантаження перевіряє MIME/fileinfo, getimagesize, GD-декодування, розміри та небезпечний вміст. За відсутності fileinfo/GD завантаження відхиляється; авторизація й текстове редагування не послаблюються. Початкові ресурси не перезаписуються.

Локальний Chromium через справжній TLS: setup → вхід → нова сторінка → inline-текст → PNG → збереження → reload → повторне відкриття HTML/проєкту/приватного PNG → вихід — PASS. Виявлено й виправлено відновлення приватних preview-зображень при повторному HTML-імпорті. Чинний Node builder.browser: усі 51 сторінка та решта сценаріїв — PASS.

Кнопка PHP checkpoint називається «Зберегти чернетку»; API повертає published:false. Публічний сайт не змінюється: це явно не готова PHP-публікація.

Змінені: admin/builder.js; php/public/admin/{php-repository.js,compatibility.html,compatibility.js}; php/runtime/{Kernel.php,Images.php}; scripts/prepare-php.js; tests/php/{fixture.cjs,core.test.cjs,editor.browser.cjs}; CI workflow; цей звіт.

M3–M5 ще не реалізовані. Готового релізного PHP ZIP поки немає. Наступне: повне керування сторінками/меню/версіями та PHP-генератор. HTML5-PHP готується окремо для генератора; не є готовою M4-публікацією.
