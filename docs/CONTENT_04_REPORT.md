# CONTENT-04 — baseline, совместимость и решения по пилоту

Продолжение: [совместимость consumer-контрактов](CONTENT_CONSUMERS_REPORT.md).
Ниже сохранён исторический результат adapter v3. Consumer-контракты и v4 реализованы
следующей задачей; B1–B7/C1–C15 этим не одобрены, live schema/import не активированы.

Проверено 12 ноября 2026. **Импорт, подтверждения и live `--apply` не запускались.**
Существующие игровые строки, `.env`, схема БД, runtime, BG3 и SRD 2014 не менялись.
Подготовлены адресная политика принятия baseline и решения по всем 15 записям.
Человеческих одобрений содержимого: **0/15**; одобрений baseline: **0/7**.

## Итог и граница готовности

Рекомендуемый будущий пакет: **1 create + 14 update** с сохранением существующих ID.
Это предложение для одобрения. До одобрения сохраняются все **14 существующих
записей (preserve)**, а Bag of Holding не создаётся.

Фактический новый live diff: **1 create / 7 update / 0 skip / 7 conflict**.
Семь конфликтов не сняты автоматически: теперь у каждого установлен точный диагноз
и есть адресное решение, требующее отдельного подтверждения baseline. Даже после
такого подтверждения отдельно требуется одобрение содержимого по новым хешам проекции.

Машиночитаемые решения, полные хеши и неподтверждённые baseline-предложения:
[CONTENT_04_LIVE_DIFF.json](CONTENT_04_LIVE_DIFF.json).
Полный live diff с before/after и сравнением consumer-проекций:
`artifacts/content-04/live-audit-final.json`.

Утверждённая последовательность из CONTENT_INTEGRATION сохранена: совместимость
версий/снимков/consumer-гейтов предшествует CONTENT-05. По текущему запросу runtime
не дорабатывался. Полный архитектурный пункт CONTENT-04 (версии копий без Campaign,
consumer gates и совместимость raw) **ещё не закрыт**. Одного разрешения baseline
недостаточно для безопасного live импорта.

## Что проверено в live БД

Аудит выполнил **46 SELECT-запросов**; запрет любого другого SQL установлен
**до выполнения** запросов. До/после совпал хеш источника, выбранных Entry,
связанных CompendiumCopy, ItemDefinition, InventoryItem, Character.abilities,
token_conditions и счётчика assets. Все 14 baseline совпали со снимком CONTENT-03.

Обнаружены 275 CompendiumCopy: **7 item + 268 spell**; 7 связанных ItemDefinition,
14 строк InventoryItem и 4 текущих способности с выбранными `source_entry_id`.
Ни содержимое пользовательских снимков, ни имена персонажей в отчёт не вынесены.
Число receipt-копий не равно числу текущих способностей: сохранённые receipts могут
относиться к удалённым/заменённым способностям.

Проверялись прямые ссылки по `compendium_entry_id` / `spell.source_entry_id`.
Произвольный скопированный текст, старые записи без ID и личные шаблоны, чей `origin`
не сохраняет ID родителя, нельзя исчерпывающе связать с пилотом. Это не мешает их
сохранности: writer вообще не изменяет такие таблицы/снимки.

## Семь baseline-конфликтов

У **каждой** из семи записей подтверждены:

- источник `srd-2024`, ожидаемые type/key/URL, `library_user_id=null`;
- правильный SHA-256 существующего raw API record;
- исходные name/slug и `normalization_version=1`;
- точное равенство всех сохранённых нормализованных полей текущему API-мапперу,
  **кроме единственного отсутствующего `ammunition`, которому сейчас соответствует null**;
- отсутствие назначения ammunition в самом исходном raw.

Это старая форма схемы, не обнаруженная правка GM. Конфликт возник из-за строгого
сравнения двух JSON-объектов с разным набором ключей. Отсутствие ammo-профиля и
`ammunition:null` дают одинаковый результат `ItemRules::fromCompendium` для этих
семи записей. Никакие другие отсутствующие/null поля не признаны эквивалентными.

| Запись и ID | Существующие данные | Безопасное адресное решение и последствия |
| --- | --- | --- |
| Acid #340 | items; 25 gp / 1 lb; эффект в прозе; копий/инвентаря нет | После B1+C1 — update той же строки, принять только отсутствующий nullable ключ. Не создавать Ability из прозы. |
| Arrows #345 | items/ammunition; raw quantity=20, storage=quiver; 1 gp / 1 lb за упаковку | После B2+C2 — update #345. Сохранить 1 ItemDefinition, 2 inventory-строки и receipt. Не превращать цену/вес пачки в цену/вес одной стрелы и не менять quantity экземпляров. |
| Chain Mail #374 | armor; AC 16, Str 13, stealth disadvantage, 75 gp / 55 lb | После B3+C3 — update #374. Сохранить 1 definition, 1 inventory-строку и receipt; AC остаётся base, не additive modifier. Не вводить новые training/Speed-правила импортом. |
| Leather Armor #430 | armor; AC 11+Dex, 10 gp / 10 lb | После B4+C4 — update #430. Сохранить 1 definition, 1 inventory-строку и receipt; Dex без потолка, без новых механик. |
| Longsword #436 | weapons; 1d8 slashing, Versatile 1d10, Sap; 15 gp / 3 lb | После B5+C5 — update #436 с тем же ID/type/key. Сохранить 1 definition, 2 inventory-строки и receipt; не переписывать хват, бонусы и эффекты существующих экземпляров. |
| Potion of Healing #467 | items; 50 gp / 0.5 lb; Bonus Action, 2d4+2 HP | После B6+C6 — update #467; включить предложенное RU «напоить». Сохранить 2 definitions, 7 inventory-строк и 2 receipts; не менять количество/расход в инвентаре. |
| Shield equipment #486 | armor/shield; AC bonus +2; 10 gp / 6 lb | После B7+C7 — update #486; сохранить 1 definition, 1 inventory-строку и receipt. Не объединять со spell:shield; не менять shield bonus на base AC. |

### Реализованное решение baseline

`UnifiedCatalogPlan` распознаёт только политику
`legacy-equipment-missing-null-ammunition-v1`. До человеческого решения она возвращает
`conflict / explicit_baseline_review_required` и точную разницу в `baseline_assessment`.
Это диагноз/предложение, а не одобрение.

Новый необязательный `manifest.baseline_reviews` принимает подтверждения с `id`,
`entry_id`, **полным digest существующей строки**, policy, `confirmed=true`, reviewer,
evidence и временем. Digest включает все атрибуты существующей Entry, включая
raw/normalized JSON и timestamps. Чужой ID, изменённый digest, произвольная policy,
строковый ID, неявное подтверждение и область вне выбранного equipment отклоняются.
Политика не обходит личную ownership, неоднозначность идентичности, другие null-поля,
изменённые имена/механику, добавленные поля или реальный ammo-профиль.

Подтверждение baseline снимает только технический конфликт; оно **не** открывает
browse/copy/execute. Writer заново проверяет baseline под source/row locks. После
удачного принятия строка получает обычную import receipt; повтор проверяет receipt
и даёт skip, а не пытается повторно применить старое baseline-разрешение.

В пилотном manifest оставлены `baseline_reviews: []`. Семь объектов
`baseline_review_proposal` в отчёте имеют `confirmed=false`, пустые reviewer/time и
не являются разрешениями. Отчёт нельзя передать вместо import manifest.

## Совместимость семи обновлений заклинаний

Для каждой записи сравнены сохранённая нормализация, предлагаемая нормализация и
будущая Ability через существующий чистый `SpellProjection::ability` **в памяти**.
Случайный UUID и справочные description/reference исключены только из сравнения
механики. Все новые Ability прошли `CharacterGameplay::rules()`; механические
различия результата для **всех семи — пусты**. В игру эти Ability не выдавались.

| Запись | Изменение проекции / текста | Совместимость и ограничение |
| --- | --- | --- |
| Cure Wounds #73 | Основная проекция без изменений; добавляются provenance/languages/review | Рецепт остаётся 2d8, +2d8/круг и spellcasting modifier; level/school/classes/range/components прежние. 67 receipts и одна текущая Ability сохраняются. |
| Detect Magic #82 | Основная проекция без изменений | Ritual/concentration/range/duration прежние; MANUAL, без нового эффекта ауры или LOS. Прямых копий/текущих Ability не найдено. |
| Fireball #126 | Полный EN/RU текст содержит усиление; normalized.higher_level=null убирает повтор | Рецепт сохраняет 8d6 fire, Dex/half, круг 20 ft, дистанцию 150 ft и +1d6/круг. 67 receipts и одна Ability не меняются; пожары/объём остаются ограничением текущего покрытия. |
| Healing Word #161 | Полный EN/RU текст содержит усиление; normalized.higher_level=null | Рецепт сохраняет 2d4, +2d4/круг, modifier, sight, Bonus Action и 60 ft. 67 receipts и одна Ability не меняются. |
| Magic Missile #199 | Полный EN/RU текст содержит усиление; normalized.higher_level=null | MANUAL, автоматический single-target damage/распределение зарядов не возникают. Прямых копий/текущих Ability не найдено. |
| Shield spell #275 | Основная проекция без изменений | Текущий PARTIAL рецепт по-прежнему даёт +5 AC до source_start; полная перехватывающая реакция и иммунитет Magic Missile импортом не добавляются. 67 receipts и одна Ability не меняются. |
| Wish #337 | normalized.damage: прежние структурированные 1d10 necrotic → null; corrected RU | Это исправление семантики справочника: 1d10 относится к стрессу последующих заклинаний. Текущая MANUAL Ability до/после одинакова и не имеет auto-damage рецепта. В исходном raw повреждённая классификация сохранена как evidence. Прямых копий/текущих Ability не найдено. |

ID, source/type/external_key не меняются ни у одной из семи записей; связи остаются
ссылками по прежним ID. Обновление Entry не заменяет существующие Ability/Inventory
или `CompendiumCopy.snapshot`. Повторная выдача в SpellLibrary также проверяет
`source_entry_id`, а не требует нового ID каталога.

### Непреодолённые условия открытия live импорта

Равенство механических проекций **не означает совместимость всех consumer-путей**:

1. `CopyCompendiumEntry` повторно передаёт equipment.raw_data в API-маппер.
   Полный Unified envelope вместо плоского API record потеряет поля при новой выдаче.
   Для Bag of Holding дополнительно нынешний copy-путь принудительно задаёт common,
   тогда как его нормализованная rarity — Uncommon. Его автоматические container/
   extradimensional механики не поддерживаются.
2. `SpellAudit` также повторно маппит raw_data через `SrdSpellMapper`. С Unified envelope
   его ожидаемые top-level поля отсутствуют, поэтому audit-путь несовместим даже при
   валидной normalized_data. Сам `SpellLibrary` использует normalized_data и прошёл
   сравнение выше, но этого недостаточно для открытия всего контура.
3. `CopyCompendiumEntry`/`SpellLibrary` не соблюдают `content.review.gates`; рецепты
   выбираются по одному ключу. `execute=false` должен соблюдаться сервером до выдачи.
   Поле `mechanics_automated=false` не заменяет эту проверку.
4. Текущему snapshot/provenance-контракту ещё нужны предусмотренные планом явные
   ruleset/revision, проверка версии механик и библиотечные копии без Campaign.

Решение: сохранить apply закрытым и выполнить эти ограниченные consumer/contract
изменения отдельной разрешённой задачей **до CONTENT-05**. В рамках текущего запроса
не добавлены ни миграции, ни новый слой хранения, ни параллельный каталог.

Дополнительная страховка: `UnifiedImport::apply` теперь сам запрещён вне unit-test
окружения с SQLite `:memory:`. Прямой вызов сервиса не обходит закрытый CLI.
Live `--apply` в этой задаче не вызывался.

## Шесть исправлений CONTENT-03 и хеши

Все 15 `selection.checksum`, все шесть редакторских предложений и все итоговые
content checksum **совпали с CONTENT-03**. Ни текст исправлений, ни source export
commit `dff09cc6f6764734d20fdba65a07a041613697ca` не переписывались.

| Исправление | Сохранённое предложение | Что одобрить |
| --- | --- | --- |
| Bag of Holding | name_ru + полный description_ru | Название «Сумка хранения», все условия/границы пространства/прохода; C8 |
| Wish | Полный description_ru | Официальные примеры, все альтернативы и стресс; C15. Отдельно принять damage=null как исправление классификации, не как новый recipe. |
| Potion of Healing | description_ru | «Напоить», а не просто передать предмет; C6 |
| Fireball | Полные description_en/ru с усилением | +1d6/круг; C11 |
| Healing Word | Полные description_en/ru с усилением | +2d4/круг; C12 |
| Magic Missile | Полные description_en/ru с усилением | +1 заряд/круг; C13 |

При проверке найден повтор усиления: CONTENT-03 добавил абзац в полный EN текст,
а consumer дополнительно присоединяет `higher_level`. Исправлен только адаптер:
если полное исправленное EN описание оканчивается **точным исходным** абзацем
усиления, normalized.higher_level становится null. Raw.higher_level и полный EN/RU
сохраняются. Рецепты и runtime-код не менялись.

Из-за изменения проекции adapter/normalization version повышена **v2 → v3**.
Хеши проекций **всех 15** изменились (версия входит в digest); любой старый review
проекции стал бы недействительным. Отдельные content checksum не изменились.
Manifest v2 не принимается v3; reviews и baseline_reviews актуального пилота пусты.
Полные пары прежнего/нового projection checksum записаны для всех 15 в JSON-отчёте.

## Таблица решений по всем 15 записям

`C1–C15` — самостоятельные решения о содержимом, языках и конкретной проекции v3.
`B1–B7` — отдельные решения о принятии существующей строки, не о содержимом.
**Все перечисленные решения пока ожидают вашего одобрения.**

| C | Запись / ID | Live action | Предложение после одобрения и устранения consumer-блокеров | Дополнительное решение |
| --- | --- | --- | --- | --- |
| C1 | Acid #340 | conflict | update; до этого preserve | B1: принять только missing ammunition:null |
| C2 | Arrows #345 | conflict | update; до этого preserve | B2; сохранить упаковку 20 и quantity экземпляров |
| C3 | Chain Mail #374 | conflict | update; до этого preserve | B3; сохранить AC/все копии |
| C4 | Leather Armor #430 | conflict | update; до этого preserve | B4; сохранить Dex/все копии |
| C5 | Longsword #436 | conflict | update; до этого preserve | B5; сохранить ID/боевой профиль/все копии |
| C6 | Potion of Healing #467 | conflict | update; до этого preserve | B6 + исправление RU; не менять расход в игре |
| C7 | Shield equipment #486 | conflict | update; до этого preserve | B7; оставить отдельным от spell:shield |
| C8 | Bag of Holding / нового ID нет | create | create только после одобрения; сейчас не создавать | Исправление RU; Uncommon/ручная механика, без чужого artwork |
| C9 | Cure Wounds #73 | update | update; до этого preserve | Подтвердить v3 EN/RU/metadata, не выдачу/исполнение |
| C10 | Detect Magic #82 | update | update; до этого preserve | MANUAL, без автоматической ауры |
| C11 | Fireball #126 | update | update; до этого preserve | EN/RU усиление, устранение повтора, PARTIAL |
| C12 | Healing Word #161 | update | update; до этого preserve | EN/RU усиление, устранение повтора |
| C13 | Magic Missile #199 | update | update; до этого preserve | EN/RU усиление, устранение повтора; MANUAL |
| C14 | Shield spell #275 | update | update; до этого preserve | PARTIAL; не обещать полного перехвата реакции |
| C15 | Wish #337 | update | update; до этого preserve | Исправление RU + явное принятие damage=null; MANUAL |

Для каждого B в JSON есть текущий `entry_id` и **полный** `baseline_digest`.
При любом изменении строки после этого аудита нужно заново построить diff и
подтвердить новый baseline. Разрешение B не распространяется на иные строки и
не даёт права игнорировать другие отличия.

Если какое-либо C/B не одобрено, безопасный выбор — preserve соответствующей
существующей записи либо исключение её из будущего import manifest; для новой
записи — не создавать. Writer не выполняет молчаливый частичный импорт выбранной
пачки. Исходный 15-record manifest не превращается в allowlist автоматически.

Отдельные решения, которые не включены в C/B:

- разрешить ограниченную доработку consumer/snapshot-контрактов, необходимую для
  совместимости, **перед** реальным импортом; сейчас runtime оставлен без изменений;
- после этих доработок и нового live diff отдельно разрешить фактический импорт
  выбранной подтверждённой пачки в CONTENT-05;
- права на изображения рассматривать отдельно; пока использовать neutral fallback.
  Одобрение текста не является одобрением картинки, выдачи в игру или исполнения.

## Воспроизведение и проверки

```powershell
# Только чтение. Output должен быть новым файлом.
php scripts/content-04-audit.php `
  --root=B:/BG3-Assets-Work/Output/Unified-DnD-Library `
  --output=artifacts/content-04/live-audit-next.json

php vendor/phpunit/phpunit/phpunit --filter 'UnifiedCompendiumBaselineTest|UnifiedCompendiumImportTest|UnifiedCompendiumDryRunTest|CompendiumTest|SpellLibraryTest|ItemLibraryTest|GlobalAssetLibraryTest'
```

Native PHP 8.3 Open Server; тесты исключительно на SQLite `:memory:` из phpunit.xml.
MySQL использовалась только для read-only аудита. Запуск выполнялся вне Windows
sandbox из-за его ограничений чтения autoload и локального TCP.

Проверки охватывают отделение B от C, отсутствие автоматического одобрения,
неподходящий ID/digest/policy/scope и реальные пользовательские правки, сохранение
ID после adoption, повтор без записей/timestamps, устаревший live plan и checksum,
атомарный rollback принятия baseline и уже созданных строк при поздней ошибке,
неизменность копий/чужих источников, устранение повтора усиления без смены механики,
закрытые CLI и прямой live writer.

Финальный общий прогон: **60 tests, 594 assertions — PASS**. Pint check — PASS.
Проверка согласованности manifest/15 решений/7 baseline-предложений/6 исправлений —
PASS. `git diff --check` — PASS; новые PHP-файлы также проверены Pint.
