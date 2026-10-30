# Локальная разработка без контейнеров

PHP, Composer, Artisan, Node и npm запускаются напрямую. Нужны PHP 8.3+
(pdo_mysql, pdo_sqlite, GD/WebP, mbstring, XML, curl, zip, fileinfo), Composer 2,
Node 20.19+ и MySQL 8.0+. Для аудио нужен FFprobe из FFmpeg в PATH.
На текущем Windows используются PHP 8.3 и MySQL 8.0 из Open Server.
Запустите MySQL в Open Server перед запуском проекта.

Redis необязателен: локально используются `SESSION_DRIVER=file`, `CACHE_STORE=file`
и `REVERB_SCALING_ENABLED=false`. При выборе Redis нужен отдельный локальный Redis
и PHP-расширение redis; адрес — `127.0.0.1:6379`. Очередь Cue всегда остаётся в MySQL.

## Существующая установка

Дважды щёлкните **YTT-Start.bat**, затем откройте <http://localhost:8090>.
Скрипт собирает frontend, применяет обычные миграции и запускает Laravel, Reverb,
worker и scheduler скрытыми процессами Windows. **YTT-Stop.bat** останавливает
только эти процессы; MySQL, файлы и данные остаются. Повторный запуск работающего
стенда ничего не пересобирает: для применения изменений выполните stop → start.

Настройки уже перенесены в приватный `.env`; БД — `ytt_local` на `127.0.0.1:3306`.
Не перезаписывайте `.env` и не генерируйте новый APP_KEY. Учётные записи и постоянный
полигон описаны в [TEST_PLAYGROUND.md](TEST_PLAYGROUND.md).

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local.ps1 status
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local.ps1 doctor
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local.ps1 test
```

Логи/PID: `artifacts/local-runtime/`. `start -SkipBuild` использует готовую сборку.
Launcher читает HTTP/Reverb endpoints из `.env`; текущий WebSocket — порт 8085.
Он применяет `scripts/php/local.ini` только к своим процессам (лимиты загрузки
64/68 MiB и память 512 MiB), без изменения системного PHP или production.

## Новая установка и прямые команды

Из корня репозитория:

```powershell
composer install
Copy-Item .env.example .env # Только если .env ещё отсутствует!
php artisan key:generate   # Только для новой пустой установки!
php scripts/configure-reverb.php
```

Создайте отдельную БД и пользователя через локальный MySQL; пример схемы:

```sql
CREATE DATABASE ytt CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

В `.env` укажите `DB_CONNECTION=mysql`, `DB_HOST=127.0.0.1`, `DB_PORT=3306`,
`DB_DATABASE`, отдельные `DB_USERNAME`/`DB_PASSWORD` и `DB_TIMEZONE="+00:00"`.
Последнее сохраняет UTC-семантику TIMESTAMP независимо от часового пояса Windows.
`MAIL_MAILER=log`, приватные assets находятся в `storage/app/campaigns-private`.

```powershell
php artisan migrate
npm install
npm run build
```

Запускайте каждую долгоживущую команду в отдельном терминале:

```powershell
# Необязательно: локальные PHP-лимиты, унаследуются дочерним HTTP-процессом.
$env:PHP_INI_SCAN_DIR = ";$PWD/scripts/php"
php artisan serve --host=127.0.0.1 --port=8090
php artisan reverb:start
php artisan queue:work tabletop --queue=cues --sleep=0.1 --tries=3 --timeout=60
php artisan schedule:work
npm run dev -- --host 127.0.0.1
```

`reverb:start` читает `REVERB_SERVER_HOST/PORT` из `.env`; backend и browser должны
использовать согласованные `REVERB_HOST/PORT` и, если заданы, `REVERB_PUBLIC_*`.
`npm run dev` включает HMR; без него приложение использует `public/build`.
PHP-изменения доступны сразу; после изменений кода worker/Reverb перезапустите процессы.

```powershell
php artisan optimize:clear
php artisan about
php artisan migrate:status
php artisan test
npm run test
npm run build
php artisan tabletop:doctor
```

Тесты используют SQLite в памяти из `phpunit.xml`, не рабочую MySQL.
Не переопределяйте test DB переменными оболочки. Production setup остаётся
в [DEPLOYMENT.md](DEPLOYMENT.md).
