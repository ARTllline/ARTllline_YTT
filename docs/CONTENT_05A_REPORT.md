# CONTENT-05A Активация consumer-схемы локальной YTT

Статус на **12.11.2026 22:33:11 +02:00: consumer-схема активирована** в основной
локальной `ytt_local`. Применена ровно одна разрешённая миграция. Исторические
данные и private files сохранены; Items/Spells и GM/Player проверены.
CONTENT-05 import, игровые команды и изменение механик не выполнялись.

## Разрешение и применённый шаг

Только локальная БД **ytt_local, MySQL 127.0.0.1:3306**. Только файл
`database/migrations/2026_11_12_170000_add_compendium_copy_contracts.php`.
Проверенный SHA-256:
`bad9678e9795aadd6dcef808abc34f1205906806df6937366e5bd2280cc5b77c`.

После представления SQL и проверенного восстановления владелец отдельно ответил:
**«Разрешаю применить только эту миграцию»**. Разрешение записано в 22:25:27 +02:00;
миграция завершена и проверена в **22:26:26 +02:00**, после получения ответа.
Письменный [authorization record](../artifacts/content-05a/owner-authorization.json)
ограничен этой миграцией и локальной БД.

Перед применением writers повторно приостановлены. Все 73 table fingerprints,
live private files, конфигурация и checksum recovery set повторно совпали с backup;
pending осталась только эта миграция. Применён штатный Laravel migrate с точным
`--path`, без seed/import; session `lock_wait_timeout=5`. Сервисы возобновлены
без общего launcher migrate/seed.

Результат просмотренного `--pretend` — четыре DDL-оператора:

```sql
alter table compendium_copies modify campaign_id bigint unsigned null;
alter table compendium_copies add owner_user_id bigint unsigned null;
alter table compendium_copies add constraint compendium_copies_owner_user_id_foreign
  foreign key (owner_user_id) references users (id) on delete restrict;
alter table item_definitions add content json null;
```

Проверено: `campaign_id` nullable, `owner_user_id` nullable с FK users/RESTRICT,
`item_definitions.content` nullable JSON. Существующие campaign IDs и три FK
сохранены. Новые поля у исторических строк — NULL, ownership и игровые правила
не назначены. В migrations ровно одна новая запись: **53 → 54**.
MySQL DDL не является единой транзакцией; автоматический rollback не заявляется.

## Выполненные проверки

- Хеш миграции совпал с CONTENT-FIX-01 и CONTENT-APPROVAL-02; pending только она.
  Предусловия старой схемы совпали, orphan campaign/entry/character references — 0.
- Все 73 таблицы — InnoDB; triggers, routines и events отсутствуют. Старые FK:
  campaign и character — CASCADE, entry — RESTRICT.
- `metadata_locks` недоступен текущему DB-пользователю; права не расширялись.
  `SHOW OPEN TABLES` не обнаружил занятых consumer-таблиц. Перед реальным DDL
  обязательны пауза writers и короткий lock timeout; это не обещание отсутствия
  будущего внешнего подключения.
- Целевой SQLite `:memory:` прогон CompendiumCopySchema, CompendiumConsumers,
  ItemLibrary и SpellLibrary: **27 tests / 413 assertions — PASS**.
- До отдельного разрешения выполнялся только SQL preview через `--pretend`.

## Consumer QA и сохранность после применения

**7 реальных browser-сценариев — PASS**, localhost:8090, отдельные GM и Player
контексты с существующими аккаунтами, без API mocks:

- GM и Player независимо скопировали Longsword из системной Item Library:
  HTTP 200 вместо старого schema-503, повтор той же команды вернул тот же UUID.
  UI-редактирование и полный reload сохранили изменения своей копии.
- Обе роли скопировали Cure Wounds в Spell Library, проверили idempotent replay,
  UI-редактирование и reload. Собственные ID различаются.
- Ни одна роль не видит и не может редактировать чужой Item; чужой Spell нельзя
  видеть, редактировать или копировать. Запрещённые POST вернули 404.
- Ошибок React нет. Персонажи, инвентарь, сцены и игровые механики не изменялись.

Live QA использует существующие legacy API-записи: Unified v4 ещё не импортирован.
Версионные spell receipts и execute=false проверены целевыми SQLite consumer-тестами;
живую выдачу v4 нельзя объявлять проверенной до отдельного CONTENT-05.

Удалены только созданные этой QA **2 private Items, 2 private Spells,
2 новых Item-copy receipts и 8 новых mutation receipts**, по точным ID/owner/времени
создания. Исторические пользовательские копии/receipts не удалялись; schema down
не вызывался. После очистки все **73 таблицы побайтно по fingerprints совпали
с состоянием сразу после миграции**. Сама миграция также проверена сравнением
всех исторических строк с backup, исключив только добавленные NULL-колонки и её
новую строку журнала. Все **1 268 private file hashes** совпали, orphan references
по campaign/entry/character/owner — 0.

Сохранились 686 пользовательских/исторических receipts, 14 ItemDefinition,
24 InventoryItem и 9 Character. Временных fixtures не оставлено. Системные записи,
существующие abilities и approvals не изменены; SHA-256 approved manifest остался
`f995208190268c9621f98ae498a733d7bd877dc7149a220a3f1c16f2eca5ade9`.

При возобновлении queue worker один раз завершился из-за Windows rename-конфликта
`bootstrap/cache/services.php`; он запущен отдельно после создания bootstrap cache,
с прежними аргументами `tabletop`/MySQL. Локальный launcher в этой задаче не менялся.
Итоговая проверка: app, Reverb, queue и scheduler работают, HTTP 200, maintenance
выключен; повторная read-only сверка всех 73 таблиц после запуска queue — PASS.

## Свежий проверенный recovery set

Создан **12.11.2026 22:16:29 +02:00** при остановленных writers. Очередь остановлена
штатным restart-сигналом с ожиданием; затем остановлены записанные локальные сервисы.
После backup сервисы возобновлены без migrate/seed; обслуживание завершено.

Основной набор: `B:\DnD\YTT\artifacts\content-05a\backup\`.
Вторая защищённая копия:
`B:\DnD\YTT-Recovery\CONTENT-05A-20261112-221629\`.
Обе копии локальные на том же физическом томе; это не внешний disaster-recovery backup.
ACL ограничен текущим Windows-пользователем и SYSTEM; наборы не для Git/публикации.

В наборе: SQL **423 377 173 байта**, архив всех private originals/thumbnails,
их SHA-256 manifest, DPAPI-зашифрованная конфигурация, архив matching source
с незакоммиченными изменениями и public build, список файлов и release identity.
SHA256SUMS проверен у обеих копий; DPAPI round-trip выполнен текущим пользователем.
Зависимости восстанавливаются по lock-файлам; APP_KEY менять нельзя.

Восстановление завершено **22:20:33 +02:00** в новом отдельном MySQL на loopback
3313, БД `ytt_content_05a_20261112_201829_23c0`, с собственным datadir,
пользователем и private storage. **Все 73 table fingerprints и все 1 268 file hashes
совпали** с backup. Нет миграций, worker/scheduler или подключений к живой очереди.
Проверено отсутствие доступа восстановленного пользователя к `ytt_local` на его сервере;
отдельный сервер не содержит основной БД и не использует её credentials.

Артефакты проверки без пользовательского содержимого:
[preflight](../artifacts/content-05a/preflight.json),
[backup](../artifacts/content-05a/backup-report.json),
[restore](../artifacts/content-05a/restore-report.json),
[вторая копия](../artifacts/content-05a/secondary-backup-report.json),
[SQL preview](../artifacts/content-05a/migration-pretend.txt),
[схема и сохранность после миграции](../artifacts/content-05a/post-migration.json),
[browser QA](../artifacts/content-05a/browser-report.json),
[итог после очистки QA](../artifacts/content-05a/final-verification.json).
Сводное доказательство сохранено также в [CONTENT_05A_RESULT.json](CONTENT_05A_RESULT.json).
SQL, конфигурация, архивы и private runtime-файлы остаются закрытыми.

## Восстановление и границы отката

До появления новых versioned/library receipts и content возможен ограниченный
schema rollback, но он не разрешён этим отчётом. После копирования guard `down()`
должен сохранить ownership/provenance; не обходить его и не удалять пользовательские
копии ради отката. Предпочтителен откат приложения, совместимого с additive-схемой.

Для фактического восстановления остановить writers, сохранить проблемные DB/storage,
проверить SHA256SUMS и восстановить backup в **новые** DB/storage тем же способом,
с matching code и DPAPI-конфигурацией. Проверить строки, assets и permissions,
затем отдельно разрешить переключение приложения. Восстановление теряет записи,
созданные после backup; текущую БД поверх не восстанавливать.

Backup содержит состояние **до миграции** и прошёл восстановление до её применения.
Для расшифровки environment.dpapi нужен исходный Windows user/DPAPI-контекст;
его утрата без отдельной custody конфигурации лишает доступа к сохранённому APP_KEY.

## Готовность к CONTENT-05

Блокер активации consumer-схемы снят. B/C решения и отдельная выборка из 13
сохранены. **Live writer по-прежнему закрыт; CONTENT-05 import не разрешён
этой задачей**. Для него нужны отдельное разрешение/включение writer, свежий
согласованный recovery set и новый live diff approved manifest после изменения
схемы; plan checksum из CONTENT-APPROVAL-02 не переносить автоматически.
Все утверждённые C сохраняют execute=false. Production не затронут.
