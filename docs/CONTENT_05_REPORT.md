# CONTENT-05 Контролируемый пилотный импорт SRD 2024

**Завершено 12.11.2026 23:02:20 +02:00.** После отдельного разрешения владельца
импортированы ровно 13 утверждённых записей. Первый запуск — **13 update**,
проверочный повтор — **13 skip**, без изменений. Одноразовое разрешение закрыто.
Live diff от 12.11.2026 22:42:10 +02:00: **13 update, 0 create, 0 conflict,
0 rejected**. Все ID, source/content/projection checksum v4 и B-baseline совпали
с CONTENT-APPROVAL-02. У всех 13 — browse=true, copy=true, **execute=false**.

## Выполненные операции

Только **ytt_local / MySQL 127.0.0.1:3306**, источник `srd-2024`.
Только [srd-2024-approved-13.manifest.json](../resources/data/content/srd-2024-approved-13.manifest.json),
SHA-256 `f995208190268c9621f98ae498a733d7bd877dc7149a220a3f1c16f2eca5ade9`.

| C | Entry ID | Запись | Операция |
| --- | ---: | --- | --- |
| C1 | 340 | Acid | update того же ID |
| C2 | 345 | Arrows | update того же ID |
| C3 | 374 | Chain Mail | update того же ID |
| C4 | 430 | Leather Armor | update того же ID |
| C5 | 436 | Longsword | update того же ID |
| C6 | 467 | Potion of Healing | update того же ID |
| C7 | 486 | Shield equipment | update того же ID |
| C9 | 73 | Cure Wounds | update того же ID |
| C10 | 82 | Detect Magic | update того же ID |
| C11 | 126 | Fireball | update того же ID |
| C12 | 161 | Healing Word | update того же ID |
| C13 | 199 | Magic Missile | update того же ID |
| C14 | 275 | Shield spell | update того же ID |

Просмотренный `plan_checksum`:
`42a29e8da9929035d133abb335d6bc6b3beecbaa1d27390398659b29c999e4be`.
Новый diff вычислен заново после активации схемы; совпадение его хеша с прежним
не является использованием старого отчёта вместо новой проверки.

Обновлены справочные поля CompendiumEntry: raw/normalized payload,
checksum, normalization version **1 → 4** и import timestamps; slug сохранён.
В normalized добавлен receipt импорта. User/library ownership и ID сохранены;
источник, assets, CompendiumCopy snapshots, ItemDefinition, InventoryItem и Character
не переписывались.
Нет create/delete, выдачи в игру или изменения execution-профилей.
C8 Bag of Holding, C15 Wish #337, BG3 и SRD 2014 вне разрешаемой выборки.
Все остальные Entry остались побайтно прежними.

Владелец отдельно ответил **«Разрешаю импорт именно этих 13 update и проверочный
повтор»**; решение записано **22:58:36 +02:00**. После этого выполнен штатный CLI
`compendium:unified-import --apply` с точным manifest/confirm-plan. Writer повторил
diff под source/row locks. Внешняя транзакция дополнительно проверила остальные
72 таблицы, невыбранные Entry, ID и итоговые v4-проекции **до commit**.
Импорт и проверочный CLI-повтор завершены в **22:59:22 +02:00**.

Повтор: **0 create / 0 update / 13 skip**; fingerprints всех 73 таблиц, включая
timestamps, не изменились. Новый post-import plan checksum:
`d8ee7ff1b5839706751659154d2b50d234261b3089dca208db0b56b3efaa2545`.

Сравнение: [до импорта](CONTENT_05_BEFORE.json),
[результат, after-хеши и доказательства](CONTENT_05_RESULT.json).
В JSON показаны старые/новые checksum, версия, полные projection/baseline digest
и сохранённые ID каждого пункта, без содержимого пользовательских экземпляров.

## Ограничение writer

Общий live import не открыт. CLI и прямой вызов writer требуют local environment,
точный MySQL target, canonical source root/manifest path и закреплённый SHA-256.
Нужен отдельный owner permit, привязанный к plan checksum и проверенному recovery
set. Допускались только эти 13 прежних ID, 13 update или явно разрешённый повтор
из 13 skip, browse/copy без execute. Mixed/create/conflict, иной manifest/target,
Wish/Bag и execute=true отклоняются. После проверочного повтора активный permit
убран; исходное решение сохранено в отдельном историческом authorization record.

До согласия файл permit отсутствовал, фактический apply не вызывался.
Итоговая проверка реального local guard подтвердила новый отказ без активного
разрешения: **live writer снова закрыт**, общего флага включения нет.
Код затрагивает только CLI/импорт и его проверки. Runtime, consumers и execution
recipes не дорабатываются. Пауза writers для согласованного backup/import временна;
основные app/Reverb процессы и постоянная конфигурация сохраняются.

Целевые SQLite `:memory:` тесты gate/import/baseline/consumers:
**38 tests / 364 assertions — PASS**; Pint изменённых PHP-файлов — PASS.
Включены rollback поздней ошибки, неизменность копий/чужих источников,
stale approval/plan, точные ID/выборка и идемпотентный повтор.

## Сохранность и browser smoke

Сразу после импорта неизменны все **72 остальные таблицы** и все невыбранные
строки CompendiumEntry. Всего Entry осталось **970**. Сохранены все **686 старых
receipts, 14 ItemDefinition, 24 InventoryItem и 9 Character** со всеми их полями,
GM-копиями, инвентарём, abilities, HP/AC/resources и snapshot/provenance.
Нет изменения campaign/session/scene state, assets или других источников.

**7 реальных browser-сценариев — PASS**, localhost:8090, существующие GM/Player
в отдельных контекстах, без API mocks:

- Обе роли скопировали Longsword в Item Library; HTTP 200, повтор вернул тот же
  UUID без дубля; UI-редактирование и полный reload сохранили свою копию.
- Обе роли скопировали Cure Wounds в Spell Library; проверены replay, edit/reload
  и отдельные ID. Созданы новые owner-scoped spell receipts без Campaign.
- Чужие Items/Spells не видны; редактирование чужих записей и копирование чужого
  Spell возвращают 404 для обеих ролей.
- Новые Items имеют execute=false и не получают equipment slots/автоматического
  профиля. Новые Spells — MANUAL, execute=false, result=nothing. Ошибок React нет.

После smoke точечно убраны только созданные им **2 Items, 2 private Spells,
4 новых QA-copy receipts и 8 QA-mutation receipts**, с проверкой ID/owner/времени.
Пользовательские receipts/копии не удалялись. Все **73 таблицы совпали с post-import
baseline** после очистки; orphan campaign/entry/character/owner references — 0.
Все **1 268 private file hashes** и approved manifest совпали с исходными.

Игровые команды/эффекты не выполнялись. Старые runtime-снимки не перечитывают
справочник для замены собственных механик; они и execution-профили сохранены.
Временных QA-fixtures не оставлено. App/Reverb не перезапускались; writers после
временных пауз возобновлены теми же командами. Итог: все четыре локальных сервиса
работают, HTTP 200, maintenance выключен. Production не затронут.

## Свежий post-migration recovery set

Backup создан **12.11.2026 22:45:12 +02:00** при paused writers, после миграции;
сервисы возобновлены прежними командами. Содержит **73 таблицы / 54 migrations**,
SQL **423 381 012 байт**, все **1 268 private files**, hash manifest,
DPAPI-конфигурацию и matching code/build с текущим ограниченным writer.

- Основной защищённый набор: `B:\DnD\YTT\artifacts\content-05\backup\`.
- Вторая защищённая копия: `B:\DnD\YTT-Recovery\CONTENT-05-20261112-224512\`.
  SHA256SUMS обеих копий проверен; это две локальные копии на том же томе.
- DPAPI round-trip подтверждён; для восстановления configuration/APP_KEY нужен
  исходный Windows user/DPAPI-контекст. Зависимости — по matching lock-файлам.
- Восстановление завершено **22:47:33 +02:00** в отдельном MySQL 3314,
  БД `ytt_content_05_20261112_204544_7853`, новом datadir/private storage и
  ограниченном пользователе: **все 73 table fingerprints и 1 268 file hashes совпали**.
  Restore не запускал миграции, workers, scheduler или импорт.
  После проверки изолированный MySQL 3314 штатно остановлен; восстановленные
  данные для проверки и исходные recovery sets сохранены.

## План восстановления

При ошибке до commit транзакция откатывает всю пачку; частичный импорт не принимается.
После успешного commit автоматический обратный импорт/откат схемы не выполняется.
При необходимости восстановления остановить writers, сохранить текущее состояние
для диагностики, проверить SHA256SUMS, восстановить этот **post-migration, pre-import**
набор в новые DB/storage с matching code и APP_KEY; сверить fingerprints/assets,
проверить permissions и только затем отдельно разрешить переключение приложения.
Восстановление поверх основной БД запрещено; post-backup записи будут потеряны при
переключении на восстановленную копию. Schema migration при таком восстановлении
остаётся активной. Пользовательские copies не удаляются ради rollback.

Перед фактическим применением после ответа владельца повторно совпали БД,
private files, конфигурация, manifest и diff с просмотренным recovery set/планом.
Последующие импорты этим разрешением не покрываются.

## Доказательства подготовки

[Новый live diff](../artifacts/content-05/live-diff-before.json),
[preflight](../artifacts/content-05/preflight-report.json),
[backup](../artifacts/content-05/backup-report.json),
[restore](../artifacts/content-05/restore-report.json),
[вторая recovery-копия](../artifacts/content-05/secondary-backup-report.json).
SQL/config/private archives остаются защищёнными и не публикуются в Git.

Доказательства результата:
[отдельное разрешение](../artifacts/content-05/owner-authorization.completed.json),
[импорт и no-op repeat](../artifacts/content-05/import-result.json),
[полный after diff](../artifacts/content-05/live-diff-after.json),
[browser smoke](../artifacts/content-05/browser-report.json),
[сохранность после QA](../artifacts/content-05/final-verification.json),
[закрытый gate](../artifacts/content-05/gate-closed-verification.json).
Полные artifacts локальные; компактные before/after и итог сохранены в docs.
