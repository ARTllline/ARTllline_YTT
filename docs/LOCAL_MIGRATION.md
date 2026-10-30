# Перенос локального стенда — 2026-10-30

Разработка теперь использует обычные процессы Windows и локальную MySQL.
Production-конфигурация и её systemd/Nginx-файлы не изменены.

## Сохранение данных

- Источник: прежний Compose-проект `ytt-test`, MySQL 8.4, Redis 7.4,
  app/Reverb/Cue worker/scheduler. MySQL и Redis не имели опубликованных портов.
- До остановки сервисов сохранён и проверен SQL с таблицами и строками аккаунтов.
  Затем приостановлены записи и снят согласованный финальный SQL/архив storage/app.
- Назначение: **MySQL 8.0.30 Open Server**, `127.0.0.1:3306`, отдельная БД
  **ytt_local** с отдельным пользователем и правами только на эту БД.
  Физический datadir: `C:/OSPanel/userdata/MySQL-8.0-Win10/`.
  Прежняя host-БД `ytt` не перезаписана.
- После импорта совпали UTC-нормализованные SHA-256 содержимого **всех 58 таблиц**,
  **3 аккаунта** с исходными хешами паролей, одна кампания, одна сцена,
  **19 приватных файлов**. Отсутствующих ресурсов нет. APP_KEY сохранён.
  Все **20 файлов storage/app**, включая QA manifest, проверены после копирования;
  прежний host storage сохранён
  отдельным архивом перед копированием.
- SQL, архивы, manifests, checksum-файл и DPAPI-копии исходных `.env` находятся
  в игнорируемом `artifacts/local-migration-20261030/` с ограниченными Windows ACL.
  DPAPI требует того же пользователя Windows/компьютера. Не публиковать эти файлы.

## Конфигурация и очистка

В `.env` изменены DB endpoint/name/user, добавлен `DB_TIMEZONE="+00:00"`,
Redis hostname заменён на loopback, cache/session возвращены на прежние `file`.
Reverb работает на loopback:8085; сохранены ключи и лимиты сообщений 262144.
FFprobe берётся из PATH, mail использует log. URL остался `http://localhost:8090`.
Старые браузерные сессии Redis не переносились: выполните вход прежним паролем.
Данные Redis были кешем/сессиями, не очередью или campaign state.

Удалены локальные Dockerfile, compose.yaml, .dockerignore, .env.docker.example,
deploy/docker, scripts/docker.ps1, docs/DOCKER.md и старый YTT-Merged-Start.bat.
Приватный .env.docker удалён после DPAPI-резервирования. Копия прежней конфигурации
сохранена только в игнорируемом migration archive для возможного отката.
YTT-Start/Stop.bat запускают scripts/local.ps1. AGENTS, README и текущие инструкции
переведены на прямые команды. Исторические отчёты сохраняют фактические упоминания
прежней среды с указателем на актуальный запуск; production/CI зависимости от неё нет.

Остановленные контейнеры и тома `ytt-test_mysql`, `ytt-test_storage`,
`ytt-test_redis` **сохранены для отката**, не используются приложением и не
удалялись. Исторические скрипты/backup evidence под ignored artifacts не входят
в обычный development flow и не должны запускаться автоматически.
Запрет `.env.docker` в .gitignore сохранён как защита от случайного добавления
старых credentials; самого файла в рабочем корне больше нет.

## Проверка без контейнеров

- composer install, npm install, optimize:clear, about, migrate/status — успешно;
  все 29 миграций уже применены, destructive migration/seed не выполнялись.
- PHP: **251 тест / 3763 assertions**; frontend: **202 теста / 43 файла**.
- Production frontend build/typecheck — успешно (существующее предупреждение
  Vite о chunk >500 kB).
- Прямой `npm run dev`: Vite client, Laravel hot integration и выдача TSX проверены;
  временный HMR-процесс остановлен, public/hot удалён. Native stop → start и
  повторный start проверены, все четыре процесса работают.
- Chromium: три прежних аккаунта, canvas/assets, auth после reload, GM filtering,
  запись/чтение/восстановление позиции, фактический WebSocket event, временный upload,
  download/delete и скачивание всех 10 существующих assets. Ошибок JavaScript нет.
- Реальное задание обработано локальным tabletop worker; cache write/read и
  scheduler heartbeat проверены. Тестовая позиция восстановлена, upload удалён.
- Doctor не находит ошибок; Redis ожидаемо необязателен. Установленный FFprobe
  отвечает, но nightly-строка версии даёт предупреждение в существующем detector.
  Лимиты upload для launcher задаёт scripts/php/local.ini.

Логи и browser-report.json сохранены в той же приватной папке artifacts.
Команды запуска: [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md).
