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


## M3 — керування сторінками й версіями

Реалізовано PHP delete/rename з підтвердженням і захистом головної; оновлення внутрішніх посилань, ресурсів перенесеної сторінки та redirect aliases. Спільне верхнє меню: додавання, видалення, назва, ціль, перестановка. Незмінені GIF-пункти збережені; лише явно нові/перейменовані текстові пункти використовують додатковий opt-in CSS. Три резервні source-версії з content-addressed dedup і браузерним відновленням. Мікросекундні ID забезпечують порядок швидких послідовних збережень.

Локальні API та Chromium сценарії меню → rename → delete → restore — PASS. Перевірено збереження статейного тексту після зняття посилання й видалення пункту меню, ліміт трьох версій, збереження приватного PNG. Модуль HTML5-PHP 2.11.0 (MIT, pinned a1e7a2f88ee13635d86fc61cfbdf2306a76ddfc7) постачається локально без Composer.

## M4 — автономна PHP-публікація

Реалізовано PHP-генератор HTML, shared header, ресурсів, canonical/legacy URL, search index, site-version, worker і версійних CSS/JS. Усі 51 сторінка пройшли порівняння DOM/тексту/атрибутів/посилань із Node cleanWebsite; пошуковий індекс збігається. Обробку noscript вирівняно з scripting-enabled parse5 без зміни third-party source.

Публікація: глобальний lock, revision, перевірка owned-manifest і зовнішніх змін, staging + rollback journal, SHA-256 перевірка записів, маркер після HTML, worker останнім. Частковий збій відновлюється наступним авторизованим запитом; committed journal очищається без відкату успішної публікації. Файли відвідувачів стають readable атомарно; приватні файли залишаються 0600/0700. Порожні каталоги видалених URL прибираються. Початковий опублікований source-state й попередня опублікована версія зберігаються окремо від незбережених змін.

Браузерний повний цикл на PHP/TLS: setup → редактор → текст/PNG → публікація → справжній visitor URL → повторне відкриття → меню → rename/delete → restore → публікація → legacy redirect — PASS. Немає Node subprocess на сервері. Публічний вигляд ще потребує окремого pixel/geometry regression в M5; DOM parity його не замінює.

Локально одержано native PHP 8.2.34, 8.4.26, 8.5.11 із php-builder (SHA-256 звірені з GitHub release metadata), разом із Ubuntu PHP 8.3.6. Усі три API suite-сценарії M1/M3/M4 пройшли на кожній версії. Це поки staging, не перевірка фінального ZIP і не Apache. Apache/чистий фінальний архів/production залишаються NOT TESTED.

Змінені модулі: php/runtime/{HTML,Routes,Header,Pages,Compiler,Publisher,Files,Kernel}.php; php/vendor/html5 (ліцензія та upstream commit); php/public/admin/php-controls.js, php-repository.js; admin/builder.js; themes/cms-menu.css; scripts/prepare-php.js; tests/php/{pages.test.cjs,publication.test.cjs,editor.browser.cjs}; цей звіт.

Пошта на PHP ще не налаштована й не підтверджена. Наявний contact endpoint чесно відмовляє з повідомленням, а не повертає фальшивий успіх. M5 ще триває; готового ZIP для батька поки немає.

## M5 — release verification (триває)

Checkpoint M3–M4 af894c5 пройшов CI PHP 8.2–8.5 і стару діагностику: https://github.com/KingInjiro/Tcg_site/actions/runs/39159348206. Додано PHPMailer 7.1.1 (LGPL-2.1, pinned 1bc1716a507a65e039d4ac9d9adebbbd0d346e15), налаштування SMTP у браузері та same-origin public contact endpoint. Локальний TLS SMTP fixture підтвердив авторизацію, прийняття листа, фіксованого адресата, Reply-To, відмову при неправильному сертифікаті/RCPT, replay та header injection. Зовнішніх листів не надсилалося; SMTP власника не перевірено.

Додано validated packager із ZIP у корені сайту, SHA-256 manifest та окремим приватним ключем поза ZIP. Фінальний артефакт ще не перевірено. Тести можуть розпаковувати один готовий ZIP у чисте середовище для кожного запуску. Apache TLS matrix запускається в ізольованих CI-контейнерах без mod_rewrite/AllowOverride; Docker не є production-залежністю. Browser visitor test порівнює всі 51 сторінку на 1440/390px до/після PHP-публікації, GIF hover, SPA, offline PWA та актуалізацію build. Результати цих нових перевірок ще очікуються.

Поточні локальні результати: 40 чинних unit tests PASS; HTML validation 52 outputs: 0 errors/notices; чотири PHP API сценарії PASS на 8.3. Виправлено неправильне задання SMTP Timelimit (параметр належить SMTP instance, не PHPMailer). Обмежено кількість session-файлів 512, додано очищення прострочених сесій незалежно від hosting GC.

M5 verification checkpoint 3d59255: Apache HTTPS із rewrite/AllowOverride вимкненими — PASS на 8.2/8.3/8.4/8.5; native core matrix і diagnostics 5.6/7.4/8.0/8.1 — PASS (https://github.com/KingInjiro/Tcg_site/actions/runs/39209022298). Реальний Chromium all-51 layout/GIF/SPA/PWA test та editor full flow — PASS. Повний попередній Site checks ще триває у PR #33.

Наступні перевірені локально виправлення: Environment.php перевіряє потрібні файли й реальні права, а setup після ключа робить safe atomic write/read probes у публічних папках; подробиці доступні лише власнику. Додано відмову без GD/при заборонених захисних ini-функціях зі збереженням статичних сторінок; ZIP-аудит перевіряє hashes/sidecar/missing files. Публікація project-only змін тепер фіксує published state; незавершений staging без journal очищається перед повторною спробою. Шість PHP suite-сценаріїв на 8.3 PASS; остаточна матриця готового ZIP ще очікується.
