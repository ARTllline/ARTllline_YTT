# CONTENT-03 — контролируемая подготовка SRD 2024

Продолжение: [CONTENT-04 — baseline и решения по пилоту](CONTENT_04_REPORT.md).
Этот отчёт сохраняет результаты adapter v2; актуальный adapter v3, новые хеши
проекции и отдельные baseline-подтверждения описаны в CONTENT-04.

Проверено 12 ноября 2026. **Фактический импорт не запускался.**
Проверены 15 пилотных записей; подготовлены редакторские исправления, явное
подтверждение, live DB diff и транзакционный writer. `reviews: []`: **0 одобрений**.

Последовательность CONTENT-02 → CONTENT-03 → CONTENT-04 → CONTENT-05 сохранена.
Writer подготовлен и проверен на изолированной SQLite, но `--apply` намеренно
недоступен до CONTENT-04 и отдельного разрешения на импорт. CONTENT-04/05 не объявлены
завершёнными. Runtime, UI, существующий API-import, SRD 2014 и BG3 не менялись.

## Официальный источник и границы проверки

Сверка выполнена непосредственно с [официальным SRD 5.2.1 Wizards of the Coast](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf),
ссылка проверена через [официальную страницу SRD](https://www.dndbeyond.com/srd).
PDF скачан заново; его байты совпали с ранее сохранённым PDF источника.
SHA-256: `8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87`.
Номера ниже — печатные страницы, совпадающие с номером страницы PDF, начиная с 1.
Таблицы оружия/брони и текст Bag/Wish проверены с учётом колонок и границ заголовков;
например, Delayed Blast Fireball на с. 122 не принят за Fireball на с. 131.

Сверены имена, имеющаяся EN/RU проза, структурированные характеристики,
компоненты/классы/дистанции/длительность заклинаний, усиление за ячейку и семантика
проекции. Это агентская проверка выбранного материала, не человеческое одобрение,
не сертификация всей библиотеки и не проверка игровых рецептов.
Исходные `human_verified`, `approved` и `full_semantic_review` не повышались.
Флаг `exact_rules_revision_verified` остаётся false: весь upstream не закреплён как
официальная 5.2.1 только потому, что проверен этот пилот.

## Все 15 записей: результаты сверки

| Запись | SRD 5.2.1 | Результат и оставшиеся ограничения |
| --- | --- | --- |
| Acid | 94–95 | 25 gp, 1 lb, замена одной атаки, видимая цель до 20 ft, Dex DC=8+Dex+PB, 2d6 acid: EN/RU соответствуют. Проза не превращена в автоматическую Ability. |
| Arrows | 94, 96 | 20 стрел за 1 gp, общий вес 1 lb; quiver приобретается отдельно. EN/RU описания отсутствуют и не выдуманы. Quantity/storage остаются raw; цена и вес не относятся к одной стреле. |
| Chain Mail | 92 | AC 16, Str 13, помеха Stealth, 55 lb, 75 gp, надеть/снять 10/5 min: соответствуют. Str 13 — порог снижения Speed на 10 ft, а не запрет надевания. Armor training остаётся ограничением consumer/runtime. |
| Leather Armor | 92 | AC 11+Dex, 10 lb, 10 gp, надеть/снять 1/1 min: соответствуют; отсутствующая проза сохранена. Training не реализуется импортом. |
| Longsword | 89–91 | 1d8 slashing, Versatile 1d10, Sap, 3 lb, 15 gp: соответствуют; 5 ft согласуется с обычной melee reach. Mastery остаётся справкой. |
| Potion of Healing | 95, 99 | 50 gp, 0.5 lb, Bonus Action: выпить или напоить существо до 5 ft, 2d4+2 HP. RU «дать» уточнено до «напоить»; embedded Ability/расход не создаются. |
| Shield (equipment) | 92 | +2 AC, 6 lb, 10 gp; это бонус, не base AC. Надеть/снять — Utilize, не минута; нужен training, одновременно только один щит. Недостающая проза не добавлена молча. |
| Bag of Holding | 212 | Uncommon, 500 lb / 64 ft³, собственный вес **5 lb**, Utilize для извлечения, 10 min воздуха / число дышащих. EN соответствует; RU переписан полностью, см. ниже. |
| Cure Wounds | 121 | Level 1 Abjuration; Action, Touch, V/S, Instantaneous; 2d8+spellcasting modifier, +2d8 за уровень ячейки выше 1. EN/RU соответствуют. Нет запрета на Undead/Constructs из редакции 2014. |
| Detect Magic | 123 | Level 1 Divination; Action/Ritual, Self, V/S, Concentration до 10 min. 30 ft, Magic action для ауры, школа эффекта от spell; преграды 1 ft stone/dirt/wood, 1 inch metal, thin lead. EN/RU соответствуют. |
| Fireball | 131 | Level 3 Evocation; Action, 150 ft, V/S/M (bat guano and sulfur), Instantaneous; Sphere 20 ft, Dex/half, 8d6 fire, воспламенение неносимых объектов. Усиление +1d6/круг было только в raw.higher_level: добавлено в полные EN/RU описания. |
| Healing Word | 139 | Level 1 Abjuration; Bonus Action, 60 ft, V, Instantaneous; видимая цель, 2d4+modifier. +2d4/круг было только в raw.higher_level: добавлено в EN/RU описания. |
| Magic Missile | 146 | Level 1 Evocation; Action, 120 ft, V/S, Instantaneous; три одновременно попадающих заряда по 1d4+1 force, одна/несколько видимых целей. +1 заряд/круг добавлен из raw.higher_level в EN/RU описания. |
| Shield (spell) | 161–162 | Level 1 Abjuration; Reaction при попадании attack roll или выборе целью Magic Missile; Self, V/S, 1 round; +5 AC включая triggering attack до начала следующего хода и отсутствие урона от Magic Missile. EN/RU соответствуют; trigger остаётся EN metadata. |
| Wish | 175 | Level 9 Conjuration; Action, Self, V, Instantaneous. EN соответствует официальному тексту; RU исправлен, основной structured damage проекции снят. Все эффекты остаются MANUAL. |

### Bag of Holding

`Пакет хранения` заменено на `Сумка хранения`. Исправлены геометрия внутреннего
пространства (примерно 2×2 ft и глубина 4 ft), уничтожение при перегрузке/проколе/разрыве,
неповреждённое высыпание содержимого, обязательное выворачивание обратно, воздух,
Utilize и название Астрального плана. Восстановлена полная цепочка помещения сумки
во внепространственное пространство Handy Haversack / Portable Hole / подобного
предмета: уничтожение обоих, точка прохода, затягивание существ из **сферы радиусом
10 ft**, случайное место на Астральном плане, закрытие и односторонность прохода.
Названия двух других предметов снабжены EN, поскольку их RU не является официальным
переводом. Числа не преобразованы в контейнерную capacity или runtime-механику.

### Wish и исправление прежнего отчёта

Замечание CONTENT-02 про «один spell» было ошибочным: официальный текст **допускает
single spell or other magical effect**. RU «или другой магический эффект» сохранено.
Текущий EN локального источника тоже содержит эту формулировку; старое замечание не
является доказательством другой версии источника.

В RU восстановлены реальные официальные примеры: смерть злодея переносит персонажа
в будущее, легендарный предмет/артефакт может перенести к текущему владельцу.
Удалены неофициальные примеры эпидемии/бессмертия; возвращены варианты полного
провала, частичного исполнения и непредвиденного последствия. Сохранены все семь
вариантов применения, пределы стоимости/размеров/числа существ/8 часов, требования к
замене feat, правила переброса, оговорки про богов/мультивселенную и весь стресс.

`1d10 necrotic` — урон за уровень **последующего** заклинания после стресса до Long
Rest, не базовый damage Wish. В адаптере проекция `damage=null`; исходное raw.damage
сохранено как свидетельство upstream. Сила 3, 2d4 дня, ускорение восстановления
на 2 дня за день отдыха и риск 33% сохранены в исправленной прозе. Рецепт исполнения
не создавался и не менялся.

## Где находятся исправления и подтверждения

Единственный каталог остаётся существующим Compendium. Источник Unified Library
читается без изменений. Исправления хранятся в существующем
`resources/data/content/srd-2024-pilot.manifest.json`, в `selection[].correction`.
Это шесть редакторских предложений, не отдельная библиотека.

Adapter v2 проверяет три значения:

1. `selection.checksum` — канонический SHA-256 исходной полной detail-записи;
2. `content_checksum` при исправлении — detail + явное `ytt_correction` с текстом и
   evidence; исходные `record`, raw, изображения и отношения остаются неизменными;
3. `projection_checksum` — идентичность, итоговый checksum, версия адаптера и проекция
   YTT, включая оба языка и provenance. Собственное подтверждение и зависящий только
   от состава выборки флаг доступности цели связи исключены из этого хеша.

Явное human-confirmation содержит `confirmed=true`, reviewer, evidence, время,
`languages=[en,ru]`, оба итоговых хеша, browse/copy и `execute=false`. Отсутствующее,
старое или частичное подтверждение не открывает импорт. Изменение исходника,
исправления или проекции требует нового подтверждения; адаптер v1 не принимается.
EN-only разрешения не добавлены: неподтверждённый RU не попадает в одобренный пакет.

Команда подтверждения создаёт **новый manifest только одной явно выбранной записи**,
не пишет в БД и не перезаписывает исходник. Пилотная команда подтверждения не запускалась.

```powershell
# Сначала прочитать весь текст и проекцию выбранной записи из финального diff.
$sourceRoot = 'B:/BG3-Assets-Work/Output/Unified-DnD-Library'
$pilotManifest = 'resources/data/content/srd-2024-pilot.manifest.json'
$live = Get-Content artifacts/content-03/live-diff-final.json -Raw | ConvertFrom-Json
$record = $live.records | Where-Object id -eq 'srd:spell:cure-wounds:2024'
$recordId = $record.id
$contentChecksum = $record.checksum
$projectionChecksum = $record.projection_checksum

# Выполняет человек после проверки; заменить reviewer и evidence реальными данными.
# --copy означает отдельное согласие на копирование; исполнения это не разрешает.
php artisan compendium:unified-confirm $sourceRoot --manifest=$pilotManifest `
  --id=$recordId --checksum=$contentChecksum --projection-checksum=$projectionChecksum `
  --reviewer='Имя проверяющего' --evidence='SRD 5.2.1 p121; EN/RU и проекция прочитаны' `
  --languages=en,ru --copy --confirm --output=artifacts/content-03/cure-wounds-approved.manifest.json
```

## Live MySQL diff

Восстановлен запуск существующей **MySQL 8 Open Server** с её прежним `my.ini` и
datadir. Подключение Laravel к `127.0.0.1:3306` работает. `.env`, учётные данные,
схема и игровые процессы не менялись; MySQL оставлена запущенной.

Финальный полный отчёт: `artifacts/content-03/live-diff-final.json`.
Компактный сохраняемый снимок с ID/checksum/гейтами:
[CONTENT_03_LIVE_DIFF.json](CONTENT_03_LIVE_DIFF.json).
Выполнено 25 SELECT-запросов; источник и выбранные строки вместе со счётчиками
assets/copies совпадают до и после. `database_writes=0`, `validation_passed=true`.

| DB action | Количество | Реальные записи |
| --- | ---: | --- |
| create | 1 | `items:magic-item:bag-of-holding`, нового ID ещё нет |
| update | 7 | Cure Wounds #73; Detect Magic #82; Fireball #126; Healing Word #161; Magic Missile #199; Shield spell #275; Wish #337 |
| skip | 0 | Unified adapter v2 ещё не импортировался |
| conflict | 7 | Acid #340; Arrows #345; Chain Mail #374; Leather Armor #430; Longsword #436; Potion of Healing #467; Shield equipment #486 |

У семи equipment записей старый checksum/raw/name/slug совпадают с API-импортом,
но в сохранённой нормализации отсутствует нынешнее nullable поле `ammunition`.
Это **не утверждение о пользовательском редактировании**. Старой receipt нет,
а строгое воспроизведение текущим маппером не совпадает побайтно по каноническому JSON.
Автоматически признавать этот baseline доверенным или применять force нельзя.
Нужна отдельная ограниченная политика adoption/migration baseline в CONTENT-04.
Исходные ID сохраняются в diff; конфликт не создаёт альтернативную запись.

DB action не является разрешением на импорт: **все 15 отклонены review-гейтом**.
`review_ready=false`, `transaction_writer_ready=false`, `import_available=false`.

## Транзакционный writer и команда импорта

`UnifiedImport` использует существующие CompendiumSource/Entry, блокировку источника
и выбранных существующих строк, затем заново строит и проверяет live plan внутри
SQL-транзакции. `--confirm-plan` предназначен для точного checksum просмотренного
плана; любое изменение baseline, выбора или ревью требует нового diff.

Writer принимает только полностью подтверждённую выбранную пачку с browse+copy;
неподтверждённая запись не пропускается молча, а блокирует весь пакет. Пользовательский
`library_user_id`, неоднозначность items/weapons/armor, неизвестный baseline и правки
управляемой записи дают conflict. Старый API baseline можно принять только при полном
воспроизведении всех проверяемых полей текущими мапперами.

Новые/изменённые записи получают receipt с хешем управляемых полей и slug. Receipt
позволяет обнаруживать последующие ручные правки. Повтор с новым актуальным diff
даёт только skip, без изменения Entry/source timestamps. Сохраняются существующие
ID при переклассификации. Нет delete/force, создания источников, записи assets,
копий, персонажей, инвентаря, сессий или realtime-событий. Ошибка любого save
откатывает все изменения пачки. Это rollback неудачной транзакции; восстановления
после успешно зафиксированного импорта/истории версий здесь ещё нет — CONTENT-04/05.

```powershell
# Готовая команда предварительного плана импорта; безопасна, сама не пишет.
php artisan compendium:unified-import B:/BG3-Assets-Work/Output/Unified-DnD-Library `
  --manifest=resources/data/content/srd-2024-pilot.manifest.json

# Воспроизводимый полный live diff; файл должен быть новым.
php artisan compendium:unified-dry-run B:/BG3-Assets-Work/Output/Unified-DnD-Library `
  --manifest=resources/data/content/srd-2024-pilot.manifest.json `
  --report=artifacts/content-03/live-diff-next.json

# Форма будущего применения после CONTENT-04 и отдельного разрешения.
# Сейчас --apply всегда возвращает отказ ДО обращения к БД, даже с валидными review.
php artisan compendium:unified-import B:/BG3-Assets-Work/Output/Unified-DnD-Library `
  --manifest=artifacts/content-03/cure-wounds-approved.manifest.json `
  --apply --confirm-plan='<checksum НОВОГО live diff одобренного manifest>'
```

Причина технической блокировки установлена в текущем коде: `CopyCompendiumEntry`
не проверяет `content.review.gates`, а при копировании equipment повторно маппит
`entry.raw_data` как плоский API record, тогда как Unified сохраняет полный envelope.
Spell consumer-пути также выбирают существующие рецепты по ключу. Открыть writer
сейчас означало бы пропустить CONTENT-04 и изменить поведение работающей игры.
В рамках этой задачи consumer/runtime не исправлялись и обхода блокировки нет.

## Тесты и ручные шаги

PHPUnit запускается native PHP 8.3 Open Server вне Windows sandbox: sandbox блокирует
чтение autoload и локальный TCP. Тесты используют только `phpunit.xml`, SQLite
`:memory:`; живой MySQL не используется миграционными тестами.

```powershell
php vendor/phpunit/phpunit/phpunit --filter 'UnifiedCompendiumDryRunTest|UnifiedCompendiumImportTest|CompendiumTest|SpellLibraryTest|ItemLibraryTest|GlobalAssetLibraryTest'
```

Итоговый общий прогон после всех изменений: **52 tests, 514 assertions — PASS**.
В него входят 26 целевых CONTENT-тестов, включая выделение одной записи из связанного
пакета. Финальный `pint --test` для PHP-файлов CONTENT — PASS.

Проверены create/update/skip, сохранение ID, повтор без изменений/timestamps,
неизменность чужих источников/личных записей и сохранённых campaign snapshots,
user/identity conflicts и локальная правка, pending/stale review, изменение исходного
и исправленного checksum, подменённый projection checksum, изменение БД после diff,
отсутствующее copy/языковое подтверждение, явная CLI-confirmation без перезаписи,
закрытый live apply, rollback существующего update и rollback уже вставленных новых
строк. Сохранились отрицательные проверки BG3/2014, JSON без исполнения JS,
путей/PNG/чисел/dice и read-only dry-run.

До применения необходимы:

1. Человеческая вычитка и явное одобрение **каждой выбранной записи**, обоих языков,
   исправлений и конкретных checksum; сейчас не одобрена ни одна.
2. CONTENT-04: версионные snapshots, consumer gates и совместимость raw-envelope;
   отдельное решение для семи legacy equipment baselines. Ни один conflict не снят автоматически.
3. Новый live diff только одобренной выборки, затем **отдельное разрешение на фактический
   импорт** и включение подготовленного writer в CONTENT-05. Одобрение текста не равно
   одобрению исполнения; `execute=false` сохраняется.
4. Отдельная проверка прав на изображения. В этом этапе только neutral fallback,
   картинки не копировались и не регистрировались.

This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”)
by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1
is licensed under the Creative Commons Attribution 4.0 International License,
available at https://creativecommons.org/licenses/by/4.0/legalcode.

Русские редакторские предложения и структурные преобразования YTT — изменения этого
пакета, а не официальная русская локализация Wizards of the Coast.
