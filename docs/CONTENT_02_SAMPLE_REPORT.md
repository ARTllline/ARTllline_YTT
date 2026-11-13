# CONTENT-02 — контракт, dry-run и ревью SRD 2024

Продолжение и исправление предварительных выводов: [CONTENT-03](CONTENT_03_REPORT.md).
В частности, формулировка Wish «или иной магический эффект» подтверждена официальным
SRD 5.2.1, с. 175; прежнее замечание ниже о ней ошибочно. Команды/manifest ниже
описывают исторический adapter v1; актуальные подтверждения и adapter v2 — в CONTENT-03.

Проверено 12 ноября 2026. Реализованы контракт CONTENT-02 и необходимый по текущей
задаче dry-run адаптера из CONTENT-03. Записывающего импортёра в этом этапе нет.
Compendium, его прежний API-импорт, библиотеки и игровой runtime не изменены.

## Повторяемый запуск

Исходник: `B:\BG3-Assets-Work\Output\Unified-DnD-Library`.
Выборка: `resources/data/content/srd-2024-pilot.manifest.json` — **15 записей**:
7 equipment, 1 magic item, 7 spells. У каждой явно закреплены source ID, kind,
Compendium type/key и SHA-256. `reviews: []`: **ни одна запись не одобрена**.
Схема: `resources/data/content/unified-manifest.schema.json`;
фактическая проверка — `UnifiedPackage` и `UnifiedSrdAdapter`.

```powershell
# Чтение существующего Compendium и diff; MySQL Open Server должен быть запущен.
php artisan compendium:unified-dry-run B:/BG3-Assets-Work/Output/Unified-DnD-Library --manifest=resources/data/content/srd-2024-pilot.manifest.json --report=artifacts/content-02/catalog-dry-run.json

# Проверка экспорта без обращения к БД.
php artisan compendium:unified-dry-run B:/BG3-Assets-Work/Output/Unified-DnD-Library --manifest=resources/data/content/srd-2024-pilot.manifest.json --offline --report=artifacts/content-02/pilot-dry-run.json
```

Каталог для `--report` должен существовать; файл должен быть новым. Повторный запуск
без `--report` всегда допустим; для нового отчёта выбрать новое имя. Это защищает
исходник и прошлое ревью от перезаписи. Выборки по умолчанию и режима массового импорта
нет; ограничение — 1–20 записей. Подтверждение review не включает запись в БД.

## Результат проверки исходника

- Все 15 записей проходят структурную проверку, соответствие index/detail/source,
  checksum, допустимость ссылок и строгую проверку чисел/единиц/dice.
- 15 выбранных PNG прочитаны: совпадают SHA-256, MIME, формат и декодирование;
  размеры укладываются в ограничения `StoreImage` (16 MiB, 8192 px, 32 MP).
  Ни одна картинка не скопирована и не зарегистрирована; presentation — neutral fallback,
  rights status — not reviewed. BG3 artwork не получает разрешения из лицензии SRD.
- Команда `--offline` успешно дала `created=0, updated=0, unchanged=0, rejected=15`:
  **rejected здесь означает отсутствие локального одобрения**, а не 15 структурных ошибок.
  `validation_passed=true`, `review_ready=false`, `not_compared=15`, DB writes=0.
  Полный JSON: `artifacts/content-02/pilot-dry-run.json` (генерируемый, не tracked).
- Live MySQL на `127.0.0.1:3306` не запущена: соединение отклонено и вне sandbox.
  Поэтому реальные Compendium ID и live diff **не установлены**; offline не объявляет
  записи новыми и не подставляет вымышленные ID. Сравнение с существующими ID,
  переклассификация и unchanged проверены на SQLite `:memory:`.

Сохранён commit `dff09cc6f6764734d20fdba65a07a041613697ca`, export `0.9.0-audit.1`,
ruleset `dnd-2024`, adapter v1. Заявление источника о SRD 5.2/5.2.1 и свидетельство
`rules_audit.official_revision=5.2.1` хранятся отдельно. Они не превращены в утверждение
о точном соответствии 5.2.1. Новая независимая сверка с официальным PDF не проводилась.

## Ревью выборки

Таблица фиксирует наблюдения по конкретным checksum manifest, а не разрешения на импорт.
Числа ниже сверены между локальной подробной записью и проекцией YTT. Официальные
page/table evidence сохранены, но не объявлены полной семантической проверкой.
У всех 15 записей upstream approved=false, automation_allowed=false,
full_semantic_review=false, localization.human_verified=false.

| ID (без `srd:` и `:2024`) | Характеристики и источники | Что подтвердить / ограничить |
| --- | --- | --- |
| equipment:acid | 25 gp, 1 lb; в EN/RU 20 ft, Dex DC=8+Dex+PB, 2d6 acid | Замена одной атаки, выбор цели и DC находятся в прозе; автоматической Ability нет. Числа EN/RU совпадают; нужна семантическая вычитка. |
| equipment:arrows | 1 gp / 1 lb для упаковки 20; storage=quiver | Quantity/storage сохранены в raw, маппер их не проецирует. Не трактовать цену/вес упаковки как цену/вес одной стрелы. EN prose пуст, RU null — не потеря текста парсером. |
| equipment:chain-mail | AC 16, без Dex, Str 13, stealth disadvantage; 75 gp, 55 lb | Don/doff 10/5 min остаются справкой; EN prose пуст, RU null. Проверить термины и ограничения использования. |
| equipment:leather-armor | AC 11 + Dex, 10 gp, 10 lb | Don/doff 1/1 min остаются справкой; EN prose пуст, RU null. |
| equipment:longsword | 1d8 slashing / versatile 1d10, 15 gp, 3 lb, 5 ft | Sap сохранён как mastery, но автоматическое применение не обещается. EN prose пуст, RU null. |
| equipment:potion-of-healing | 50 gp, 0.5 lb; EN/RU: Bonus Action, 5 ft, 2d4+2 healing | Проверить расход и явную embedded Ability отдельно. Не создавать её из текста автоматически. |
| equipment:shield | AC bonus +2, не base AC; 10 gp, 6 lb | Проекция shield корректно отличается от брони. EN prose пуст, RU null. |
| magic_item:bag-of-holding | Uncommon; в EN 500 lb, 64 ft³, масса 5 lb, воздух 10 min, извлечение Utilize | **RU заблокировать до исправления**: «Пакет хранения», «астральный самолёт», искажённая область 10-foot-radius Sphere и ряд условий. Числа в прозе не становятся capacity/weight runtime; structured weight=null сохранён. |
| spell:cure-wounds | Круг 1, Abjuration, Touch, Action; EN/RU: 2d8+modifier, +2d8/круг | Лечение/scaling находятся в тексте, отдельного structured healing нет. YTT coverage FULL не одобряет Unified checksum. Не смешивать с 2014. |
| spell:detect-magic | Круг 1, Divination, Self, ritual, concentration до 10 min; sensing 30 ft в тексте | MANUAL: сведения/аура/препятствия требуют GM. Числа и основные условия EN/RU выглядят согласованными, нужна полная вычитка. |
| spell:fireball | Круг 3, Evocation, 150 ft, Sphere 20 ft, Dex/half, 8d6 fire; +1d6/круг | PARTIAL: воспламенение, объём и препятствия требуют GM. Area/save извлечены существующим узким маппером, evidence=description. |
| spell:healing-word | Круг 1, Abjuration, Bonus Action, 60 ft; 2d4+modifier, +2d4/круг | Как у Cure Wounds: FULL — покрытие YTT, не ревью записи. Видимость цели и scaling проверить перед разрешением исполнения. |
| spell:magic-missile | Круг 1, Evocation, 120 ft; 3 заряда по 1d4+1 force, +1 заряд/круг | MANUAL: распределение зарядов и одновременные попадания. Не изобретать single-target damage из текста. |
| spell:shield | Круг 1, Abjuration, Reaction, Self, 1 round; +5 AC до начала следующего хода | PARTIAL: trigger/ретроактивное попадание и Magic Missile требуют GM. Отличать заклинание от предмета shield. |
| spell:wish | Круг 9, Conjuration, Self; structured damage=1d10 necrotic | **RU заблокировать до исправления**: EN single spell расширено до «заклинания или иного магического эффекта»; примеры заменены и часть ограничений опущена. **1d10 — последствие стресса за уровень последующего заклинания**, не основной урон Wish. MANUAL; generic structured damage требует семантической проверки. |

Пустая проза у пяти обычных предметов отмечена отдельно и не заменена выдуманным
описанием. Переводы не исправлялись молча; замечания не меняют исходные checksum.
Для остальных 13 записей не заявляется отсутствие иных ошибок: это ограниченный
агентский обзор, не `human_verified` и не полное одобрение.

## Контракт идентичности и ревью

- Источник только существующий `srd-2024`; equipment/spell используют upstream index
  без смены существующих ключей (`longsword`, `fireball` и т. д.).
- Magic items получают type `items`, subtype `magic_item`, key `magic-item:<index>`:
  equipment/shield и magic-items/shield — разные сущности. Это явная политика нового
  адаптера; в существующем импорте magic-items endpoint не поддерживался.
- Raw сохраняется целой подробной записью Unified (record/group/assets/relations).
  SHA-256 — канонический JSON этой записи, без транспортного index/shard. Изменение
  переводов/изображения тоже меняет полный checksum и требует нового ревью.
- Отдельные diff-секции: projection, review, relations, visual, languages, provenance.
  При переклассификации equipment поиск охватывает items/weapons/armor, сохраняя
  существующий ID в плане. Несколько кандидатов или `library_user_id != null`
  отклоняются; иные источники/ключи не затрагиваются. Исчезновение не удаляет записи.
- Связи проверяются по полному индексу, но не импортируют цели; вне выборки
  `available_in_selection=false`. Candidate/edition связи не объединяют контент.
- Локальное ревью отдельно от upstream: запись в `reviews` содержит выбранные
  `id`, `checksum`, `reviewer`, `evidence`, булевы `browse`, `copy`, `execute`.
  Copy требует browse и совместимых ограничений имён/ключей. Execute в этом этапе
  всегда false, даже если upstream или иной реестр обещает автоматизацию.
  Несовпадение checksum снимает локальное доверие. Pilot allowlist остаётся пустым.

Первые кандидаты после полного ручного подтверждения — обычные armor/weapon,
Cure Wounds и Healing Word. Bag of Holding и Wish требуют исправления/повторной
проверки RU и нового checksum либо явной политики EN-only в следующем этапе.
Непроверенную русскую локализацию нельзя автоматически считать одобренной вместе с EN.

## Проверки и граница следующего этапа

PHPUnit из sandbox воспроизводил `Cannot open bootstrap script vendor/autoload.php`:
`file_exists=true`, чтение через `file_get_contents` успешно, но `is_readable=false`
даже для `artisan` и PHP exe. Вне sandbox тот же бинарник/конфигурация работают.
Это ограничение проверки доступа Windows sandbox, а не отсутствие autoload.
Зависимости, vendor, права файлов и phpunit.xml не менялись.

```powershell
# Запуск вне ограниченного Windows sandbox, обычным native PHP Open Server:
php vendor/phpunit/phpunit/phpunit --filter 'UnifiedCompendiumDryRunTest|CompendiumTest|SpellLibraryTest|ItemLibraryTest|GlobalAssetLibraryTest'
```

Результат: **39 tests, 457 assertions — PASS**, SQLite `:memory:` из phpunit.xml.
Проверены отсутствие DB/asset/timestamp-записей, pending/stale review, unchanged,
ID при переклассификации, пользовательский конфликт, одинаковые upstream index разных
типов, JSON без исполнения JS, duplicate keys/IDs, размеры, traversal, hashes/MIME,
сломанные ссылки, неверные числа/dice и отрицательные SRD 2014/BG3 identities.
Pint для новых PHP-файлов выполнен. Browser QA не требуется: UI/runtime не менялись.

Перед первым контролируемым импортом остаются: полный ручной выбор/одобрение
конкретных checksum и языков, live catalog diff при запущенной MySQL, затем отдельная
реализация CONTENT-04/05 (версионные snapshots/gates в consumer-путях, транзакционный
writer, блокировка источника, rollback/idempotency). Передавать Unified raw напрямую
старому `CompendiumSync::import` нельзя. Текущий dry-run не открывает путь выдачи
непроверенного контента в игру. SRD 2014/BG3 не импортированы; live DB не менялась.

Материал SRD: System Reference Document 5.2.1, Wizards of the Coast LLC,
https://www.dndbeyond.com/srd, лицензия CC BY 4.0,
https://creativecommons.org/licenses/by/4.0/legalcode. Подробное исходное attribution
сохранено в `Unified-DnD-Library/ATTRIBUTION.txt`; переводы/редакторские изменения
источника перечислены в его metadata и не объявлены официальной локализацией.
