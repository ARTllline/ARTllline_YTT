# CONTENT-07B — массовый импорт завершён

**Импортированы все 552 явно одобренные записи: 234 create + 318 update.**
**Повтор: 0 create / 0 update / 552 skip. Writer закрыт.**
В Compendium **970 → 1204 Entry**. Все выбранные browse/copy, **execute=false**.
245 спорных записей исключены из импорта; существующие невыбранные Entry сохранены.
Production, runtime/execution recipes и постоянная конфигурация не изменялись. Миграции не выполнялись.

## Разрешения и точный набор

Владелец отдельно подтвердил **«Одобряю G1–G4 и все 147 B»**, затем после fresh diff,
backup/restore и показа counts отдельно ответил **«Разрешаю этот импорт и проверочный повтор»**.
Никаких решений вместо владельца не записано. Upstream human_verified/full_semantic_review не повышались.

| Группа | Объём | Фактическое действие |
| --- | ---: | --- |
| G1 equipment с EN/RU | 61 | update |
| G2 structured equipment | 86 | update |
| G3 magic items | 234 | create |
| G4 spells | 171 | update |

28 approved manifests <=20 содержат 552 C и 147 точных B policy/entry_id/digest.
Bundle: `6f897a7ea61026a658e2cef4a278e08d683e6e368fb1cea292acf5fbda63fb1a`.
Import-scope SHA-256: `424126caa9573a2ae896e7d39fca35fbefc1d18e340e2dce8d59e6b29eece5b6`.

[Явное C/B-решение](../artifacts/content-07b/content-decision.json) ·
[approved group receipt](../artifacts/content-07b/approved/group-confirmation.json) ·
[fresh live diff — итог](../artifacts/content-07b/preflight-report.json) ·
[точный scope/pins](../artifacts/content-07b/import-scope.json) ·
[отдельное apply-разрешение, уже закрытое](../artifacts/content-07b/owner-authorization.completed.json).

CONTENT-07_APPROVAL.html сохранён как исходный read-only proposal snapshot с approvals=0;
новые человеческие receipts находятся в approved manifests. Новый semantic/architecture аудит не проводился.
Для массового confirm убран повторный разбор export на каждого члена: single/group CLI используют
общий receipt contract после тех же fresh source/projection/baseline checks.

## Сохранность и атомарность

Все 28 chunks выполнены штатным `compendium:unified-import --apply` внутри **одной внешней транзакции**.
До commit проверены точные 552 projection/checksum, сохранение **318 существующих ID**,
неизменность всех невыбранных Entry и **72 остальных таблиц** относительно актуального pre-import baseline.
После commit каждый no-op chunk проверен по фактическим ID и managed import receipts;
**все 73 таблицы совпали до/после повтора**, включая timestamps.

Побайтно сохранены **686 compendium_copies, 14 ItemDefinition, 24 InventoryItem, 9 Character**,
все прежние библиотечные экземпляры, campaign/session/scene state и все **1268 private file hashes**.
Новые игровые экземпляры не выдавались, игровые команды не выполнялись.
App/Reverb продолжили работу теми же процессами; queue/scheduler после временных пауз запущены прежними командами.
Хеш `.env` совпал с backup; миграций по-прежнему **54**, их строки не изменены.

[Фактический import и все 552 ID](../artifacts/content-07b/import-result.json) ·
[no-op repeat](../artifacts/content-07b/repeat-result.json) ·
[итог после QA cleanup](../artifacts/content-07b/final-verification.json) ·
[компактный машиночитаемый итог](CONTENT_07B_RESULT.json).

## Реальный browser smoke

**8 проверок — PASS**, localhost:8090, существующие GM/Player в отдельных Chrome contexts,
без API mocks. Very Rare/PDF Thunderous Greatclub, variable-rarity Weapon, Light Crossbow,
Plate Armor и исправленный Guidance отображаются и копируются через существующие библиотеки.
Проверены source category filters, Very Rare/varies labels, Touch/VS components, независимые owner-scoped
копии, idempotent replay, edit/reload и запрет чужого list/edit/copy. Новые Items без слотов/механик,
Spells — MANUAL, result=nothing, execute=false. React errors — 0.

После smoke удалены только его **5 Library Items, 2 private Spells, 7 copy receipts и 11 mutation receipts**
по точным ID/owner/source/time. Все **73 таблицы совпали с post-import baseline**, orphan references — 0.
Временных QA-копий и fixture-изменений не оставлено.
[Browser evidence](../artifacts/content-07b/browser-report.json).

## Recovery и закрытый writer

Primary recovery set: `B:\DnD\YTT\artifacts\content-07b\backup\`.
Вторая защищённая копия: `B:\DnD\YTT-Recovery\CONTENT-07B-20261113-014350\`.
Это две локальные копии на одном томе; SHA256SUMS обеих проверен.
Сохранены SQL, private files, DPAPI-конфигурация с проверенным round-trip, matching dirty code/build,
lock-файлы и точная approved selection. Содержимое SQL/config/private archives не публикуется в Git.

Restore в новый MySQL **3315**, отдельные DB/datadir/private storage и restricted user:
**все 73 таблицы и 1268 файлов совпали**, main writes=0, migrations=false.
После проверки изолированный сервер остановлен; временные restore credentials удалены.
Его процессы не вышли после штатного shutdown и двух ожиданий; остановлены только два созданных clone-PID
после успешной сверки. Main MySQL3306 не затронут.

При восстановлении: проверить SHA256SUMS, использовать новые DB/storage и matching code/dependencies,
расшифровать environment.dpapi в исходном Windows-user/DPAPI-контексте, сверить fingerprints/files,
затем отдельно разрешить переключение. Не восстанавливать поверх основной БД.
Restore helper запускать через **PowerShell 7 (`pwsh`)**; PowerShell5 трактует штатный initialize stderr как ошибку.

Допуск writer ограничен exact local target/source, 28 manifest SHA, планами, ID/content/projection pins,
verified recovery hashes и execute=false. Активный permit закрыт в finally; старый CONTENT-05 permit не активировался.
Реальный native guard снова отказал без active permit. Общего live-import switch нет.
[Backup](../artifacts/content-07b/backup-report.json) ·
[restore](../artifacts/content-07b/restore-report.json) ·
[вторая копия](../artifacts/content-07b/secondary-backup-report.json) ·
[закрытый writer](../artifacts/content-07b/gate-closed-after.json).

## Операционные замечания

Первая попытка целиком откатилась **до commit**: моя проверка использовала порядок ключей JSON object,
который MySQL меняет при хранении. Проверка исправлена на существующий canonical digest pattern;
строгие значения permissions сохранены. Каталог и игровые данные после rollback совпали с backup.
Исправленный только operational verifier сохранён отдельным recovery supplement, исходный backup неизменен.

При возобновлении прежнего scheduler штатный daily `tabletop:prune-receipts` удалил **9116**
завершённых `scene_mutation_receipts` старше 7 дней. Сверка безопасного разбора только этой таблицы SQL dump
воспроизвела исходный backup SHA, доказала побайтную неизменность каждого уцелевшего receipt и точное
совпадение удалённого множества с retention policy. Все остальные **72 таблицы совпали с backup**.
Это фоновое обслуживание вне импортной транзакции; 686 compendium_copies сохранены побайтно.
Для импорта использован точный актуальный baseline всех 73 таблиц; blanket-ignore technical table не вводился.
Состав, source/projection pins и import-scope не менялись; повторное согласие не выдумывалось и не запрашивалось.
[Retention proof](../artifacts/content-07b/maintenance-drift-verification.json) ·
[операционный supplement](../artifacts/content-07b/recovery-supplement/correction.json).

Focused code checks: **27 tests / 171 assertions PASS**, отдельно **12 tests / 70 assertions PASS**
(наборы пересекаются), SQLite :memory: only; Pint — PASS. Native MySQL assertions, atomic rollback,
реальный import/repeat и browser smoke проверены фактически. Нет оставшегося blocker для этого набора;
245 спорных записей требуют отдельного будущего решения.
