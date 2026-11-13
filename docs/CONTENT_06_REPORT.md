# CONTENT-06 Партия SRD 2024 для группового ревью

**Подготовлено 160 записей: 60 equipment, 40 magic items, 60 spells.**
Итог: **91 кандидат после автопроверок / 33 для ручного ревью / 36 отклонены**.
Человеческих одобрений новых записей **0**. Все предложения — execute=false.
Live import, apply, migrations, изменения runtime/профилей и источников не выполнялись.

Основной пакет: [интерактивное approval-ревью](CONTENT_06_APPROVAL.html).
В нём поиск EN/RU/ID, фильтры статуса/группы, полные тексты, точные raw/curated
различия, before/after нормализации, source/content/projection checksum и B-digest.
Это самостоятельный read-only отчёт, не библиотека и не способ применить изменения.

## Выборка и степень проверки

В экспорте 812 записей SRD 2024. Из этой партии исключены 13 установленных в
CONTENT-05 и отложенные Bag of Holding/Wish: осталось **797** — 189 equipment,
276 magic items, 332 spells. Для всех 797 проверены индекс/detail и наличие имён,
EN/RU текста, official-reference evidence; глубокий adapter/consumer/live-diff
контроль выполнен для выбранных **160**, не для всего остатка.

Equipment выбирается по категориям, magic items — по редкостям/вариантам;
spells покрывают **все 8 школ и круги 0–9**. Отбор детерминирован; повторная
подготовка дала идентичный bundle, включая manifests, quality и exact diff.
Установленные записи исключаются только при валидном import receipt и совпадающем
source checksum; изменённая запись не становится невидимой для анализа.

Источник закреплён commit `dff09cc6f6764734d20fdba65a07a041613697ca`, export
`0.9.0-audit.1`, adapter v4. Редакция/идентичность 2024 проверены; **точная ревизия
5.2.1 всего upstream не подтверждена**. Существующие `human_verified`,
`full_semantic_review` и upstream approvals не повышались.

Кандидат означает прохождение машинных проверок, **не правильность перевода или
правил**. Проверяются типы/диапазоны чисел, dice, units, обязательные поля, source
identity/version/URL, checksum, дубликаты, RU-имя/кириллица, наличие обоих текстов,
числовые токены EN/RU и structural validation справочного Item/Ability.
Числовая эвристика не понимает словесные числа, перевод единиц и контекст;
совпадение токенов не доказывает полноту текста. Диагностическая reference-проекция
строится только в памяти без разрешений browse/copy и без семантического одобрения.
Для offline режима runtime-catalog validation явно остаётся не выполненной.

Пустые EN/RU описания обычного equipment сохранены пустыми, текст не выдуман.
Картинки не копировались/не регистрировались; neutral fallback сохранён.
BG3/2014 отсутствуют в selection; upstream relations остаются свидетельствами,
не основанием объединять сущности или переносить их механику.

## Что показал live dry-run

Фактическое сравнение: **36 create / 57 update / 57 conflict / 10 invalid**.
Из 57 конфликтов **51** — знакомый технический legacy baseline с отсутствующим
`ammunition` вместо null; **6** — иные защищённые baselines, их не обходим.
У 10 невалидных источников сравнение с каталогом не завершалось.
Сырой счётчик существующего dry-run показывает **67 conflict**, включая эти
10 validation-failed строк; это не 67 доказанных DB-конфликтов.

В manifests `reviews=[]`, `baseline_reviews=[]`; поэтому review-гейтом отклонены
все **160**, независимо от 91 успешного машинного кандидата. **Ни один B/C не принят.**
Полные планы сохранены рядом с manifests; proposed action не является разрешением.

Контракт importer не расширялся: **8 manifests по 20 записей**, а не один
160-record manifest. Используются прежние UnifiedPackage, adapter, dry-run,
Compendium/Entry identity и copy contracts. Параллельного каталога нет.

## Группы для ручного решения

Для первых четырёх групп предлагается вычитать EN/RU, имена, характеристики и
проекции, затем явно одобрить выбранные группы целиком либо отложить. Для G1/G2
нужно отдельное B-согласие на перечисленные пары entry_id/digest.

| Группа | Объём | Предложение | Дополнительное решение |
| --- | ---: | --- | --- |
| [G1 equipment без прозы](CONTENT_06_APPROVAL.html#validated_candidate--equipment--structured-only) | 37 | После вычитки имён/фактов — C browse/copy, execute=false | 37 отдельных точных B, объединённых одним явным решением |
| [G2 equipment с EN/RU](CONTENT_06_APPROVAL.html#validated_candidate--equipment--bilingual-prose) | 8 | После вычитки полного текста/фактов — C, execute=false | 8 B по той же ограниченной policy |
| [G3 magic items](CONTENT_06_APPROVAL.html#validated_candidate--magic_item--bilingual-prose) | 15 | После вычитки условий/редкости — C, execute=false | create только после отдельного import-разрешения |
| [G4 spells](CONTENT_06_APPROVAL.html#validated_candidate--spell--bilingual-prose) | 31 | После вычитки EN/RU, усиления/ограничений — C, execute=false | Только справочные MANUAL-копии |
| Ручное ревью | 33 | По умолчанию отложить; отдельная вычитка/исправление | Групповая команда их не утверждает |
| Отклонённые | 36 | По умолчанию исключить до исправления | Новая подготовка/хеши после исправления |

Если человек одобрит все G1–G4 вместе с 45 B, будущий кандидат выбора —
**91 запись: 76 update + 15 create**. Это предложение, не готовый approved manifest.
Оставшиеся 6 B относятся к manual-review equipment; всего B-предложений 51.

Основные причины отказа: **20** magic items потеряли бы редкость при копировании
(consumer превращает неподдержанную rarity, включая Very Rare/варианты, в common);
**6** ranged weapons имеют непризнанный baseline, к которому policy missing-null
не применима; **10** source records не прошли adapter (3 URL, 4 source.commit,
3 components). Runtime, source и значения rarity не исправлялись автоматически.
Числа/материалы/raw-vs-curated и полный текст спорных случаев показаны в Inspector.


<details>
<summary>Все 33 записи для ручного ревью</summary>

| Запись / ID | Причина | По умолчанию |
| --- | --- | --- |
| Diplomat's Pack · `srd:equipment:diplomat-pack:2024` | Характеристика raw/curated: weight | Отложить до адресной вычитки/исправления |
| Trident · `srd:equipment:trident:2024` | Характеристика raw/curated: damage | Отложить до адресной вычитки/исправления |
| Blanket · `srd:equipment:blanket:2024` | Характеристика raw/curated: cost | Отложить до адресной вычитки/исправления |
| Spear · `srd:equipment:spear:2024` | Характеристика raw/curated: cost; Характеристика raw/curated: weight | Отложить до адресной вычитки/исправления |
| Climber's Kit · `srd:equipment:climbers-kit:2024` | Характеристика raw/curated: weight | Отложить до адресной вычитки/исправления |
| Chain Shirt · `srd:equipment:chain-shirt:2024` | Характеристика raw/curated: weight | Отложить до адресной вычитки/исправления |
| Mace of Terror · `srd:magic_item:mace-of-terror:2024` | Числа/повторы EN/RU различаются | Отложить до адресной вычитки/исправления |
| Dancing Lights · `srd:spell:dancing-lights:2024` | Числа/повторы EN/RU различаются | Отложить до адресной вычитки/исправления |
| Glyph of Warding · `srd:spell:glyph-of-warding:2024` | Усиление не явно в обоих текстах | Отложить до адресной вычитки/исправления |
| Guards and Wards · `srd:spell:guards-and-wards:2024` | Числа/повторы EN/RU различаются | Отложить до адресной вычитки/исправления |
| Symbol · `srd:spell:symbol:2024` | Нужно проверить смысл structured damage | Отложить до адресной вычитки/исправления |
| Prismatic Wall · `srd:spell:prismatic-wall:2024` | Редакторский текст отличается от raw; Нужно проверить смысл structured damage | Отложить до адресной вычитки/исправления |
| Ensnaring Strike · `srd:spell:ensnaring-strike:2024` | Нужно проверить смысл structured damage; Усиление не явно в обоих текстах | Отложить до адресной вычитки/исправления |
| Confusion · `srd:spell:confusion:2024` | Редакторский текст отличается от raw; Усиление не явно в обоих текстах | Отложить до адресной вычитки/исправления |
| Incendiary Cloud · `srd:spell:incendiary-cloud:2024` | Нужно проверить смысл structured damage | Отложить до адресной вычитки/исправления |
| Foresight · `srd:spell:foresight:2024` | Числа/повторы EN/RU различаются | Отложить до адресной вычитки/исправления |
| Animal Friendship · `srd:spell:animal-friendship:2024` | Усиление не явно в обоих текстах | Отложить до адресной вычитки/исправления |
| Scorching Ray · `srd:spell:scorching-ray:2024` | Нужно проверить смысл structured damage; Усиление не явно в обоих текстах | Отложить до адресной вычитки/исправления |
| Blight · `srd:spell:blight:2024` | Усиление не явно в обоих текстах | Отложить до адресной вычитки/исправления |
| Divine Word · `srd:spell:divine-word:2024` | Числа/повторы EN/RU различаются; Редакторский текст отличается от raw | Отложить до адресной вычитки/исправления |
| Weird · `srd:spell:weird:2024` | Нужно проверить смысл structured damage | Отложить до адресной вычитки/исправления |
| Black Tentacles · `srd:spell:black-tentacles:2024` | Числа/повторы EN/RU различаются; Нужно проверить смысл structured damage | Отложить до адресной вычитки/исправления |
| Mass Suggestion · `srd:spell:mass-suggestion:2024` | Усиление не явно в обоих текстах | Отложить до адресной вычитки/исправления |
| Delayed Blast Fireball · `srd:spell:delayed-blast-fireball:2024` | Усиление не явно в обоих текстах | Отложить до адресной вычитки/исправления |
| Web · `srd:spell:web:2024` | Нужно проверить смысл structured damage | Отложить до адресной вычитки/исправления |
| Dominate Beast · `srd:spell:dominate-beast:2024` | Усиление не явно в обоих текстах | Отложить до адресной вычитки/исправления |
| Arcane Hand · `srd:spell:arcane-hand:2024` | Нужно проверить смысл structured damage; Усиление не явно в обоих текстах | Отложить до адресной вычитки/исправления |
| Control Weather · `srd:spell:control-weather:2024` | Редакторский текст отличается от raw | Отложить до адресной вычитки/исправления |
| Storm of Vengeance · `srd:spell:storm-of-vengeance:2024` | Нужно проверить смысл structured damage | Отложить до адресной вычитки/исправления |
| Hold Person · `srd:spell:hold-person:2024` | Усиление не явно в обоих текстах | Отложить до адресной вычитки/исправления |
| Wind Wall · `srd:spell:wind-wall:2024` | Нужно проверить смысл structured damage | Отложить до адресной вычитки/исправления |
| Raise Dead · `srd:spell:raise-dead:2024` | Числа/повторы EN/RU различаются; Характеристика raw/curated: material | Отложить до адресной вычитки/исправления |
| Magnificent Mansion · `srd:spell:magnificent-mansion:2024` | Числа/повторы EN/RU различаются | Отложить до адресной вычитки/исправления |

</details>

## Короткая форма решения

```text
CONTENT-06 / партия 01
Bundle: 58122f1386851a5d79f33c15e7f99d0b93ddc71846880477d031bded6d8c073b
Проверяющий / время / основание: __________
После вычитки EN/RU, имён, фактов и проекций v4 одобряю группы: __________
Разрешения выбранных C: browse=true, copy=true, execute=false.
Отдельно принимаю точные B entry_id/digest выбранных G1/G2
по legacy-equipment-missing-null-ammunition-v1: ДА / НЕТ.
Manual-review и rejected: отложить, если явно не согласован отдельный разбор.
Фактический импорт этим решением не разрешаю.
```

Новый `compendium:unified-confirm-group` записывает **явное** решение по точной
группе/checksum, заново проверяет source/projection/baseline и вызывает прежний
`compendium:unified-confirm` для каждого члена. Результат — отдельная выборка с
реальными human receipts в chunks <=20. Нельзя молча убрать disputed/rejected
из исходных manifests и считать остаток одобренным. При изменении хотя бы одного
member/manifest/checksum/baseline решение группы не записывается.

Команда для человека **только после вычитки и явного решения**, пример G1:

```powershell
php artisan compendium:unified-confirm-group B:/BG3-Assets-Work/Output/Unified-DnD-Library `
  --review=resources/data/content/srd-2024-batch-01/review.json `
  --bundle-checksum=58122f1386851a5d79f33c15e7f99d0b93ddc71846880477d031bded6d8c073b `
  --group=validated_candidate--equipment--structured-only `
  --reviewer='<Имя проверяющего>' --evidence='<Основание вычитки EN/RU и проекции>' `
  --languages=en,ru --copy --confirm --accept-legacy-baselines `
  --output=artifacts/content-06/g1-approved
```

На реальном пакете эта команда **не запускалась**. `--execute` у неё отсутствует.
Положительные групповые confirmations проверялись только на synthetic fixtures
SQLite `:memory:`; они не являются одобрением SRD партии.

## Следующий контролируемый импорт

1. Вручную выбрать/одобрить группы C и отдельно их B; manual/rejected разобрать
   адресно. При исправлении текста/характеристик нужен новый pinned пакет и ревью.
2. Получить явную новую selection из approvals, сохранить 8 исходных manifests.
   Для G1–G4 получается 6 отдельных approved manifests <=20, не один bulk JSON.
3. Новый live diff каждой выбранной части; ни stale checksum, ни нераспознанный
   baseline не переносить. Pending/unselected не пропускать молча.
4. Подготовить свежий восстановимый backup и точный ограниченный import permit
   для новой selection/планов. **CONTENT-05 gate разрешает только старый пилот из
   13 и сейчас закрыт; для новой партии не подходит.** В этой задаче он не расширен.
5. Показать операции и recovery plan, запросить отдельное разрешение владельца
   перед apply. После разрешённого импорта проверить ID/copies/inventory,
   повтор=skip и browser GM/Player; execute=false сохраняется.

Для новой подготовительной партии можно менять явные квоты в диапазоне 100–200:

```powershell
php artisan compendium:unified-prepare-batch B:/BG3-Assets-Work/Output/Unified-DnD-Library `
  --equipment=60 --magic-items=40 --spells=60 --output=artifacts/content-06/next-batch
```

Вывод должен быть новым каталогом; источники и прежние решения не перезаписываются.
Создать standalone review-отчёт можно `python scripts/content-batch-report.py
<review.json> <новый.html>`. Это только renderer существующего bundle.

## Проверки и доказательства

- Расширенный pipeline/parser/import/baseline/consumer/pilot-gate прогон:
  **62 tests / 523 assertions — PASS**.
- После добавления точных source evidence — целевой финальный прогон:
  **12 tests / 69 assertions — PASS**. Наборы пересекаются, их не складываем.
- Покрыты длинные JSON-тексты/escaped duplicate keys, отсутствие approvals,
  chunks <=20, выборка без дублей, stale bundle/source/B, отдельное B-согласие,
  запрет группового одобрения manual/rejected и отсутствие SQL в offline режиме.
- Полные fingerprints всех **73 live tables** до/после совпали. Записей в DB — 0;
  private copies/inventory/characters, imported pilot и runtime не изменены.
- Read-only HTML проверен в настоящем Chrome: фильтры 91/33/36, 160 строк,
  групповой Inspector EN/RU/diff, поиск и mobile; приложение/DB не открывались.
- Исходный source export не редактировался. Для длинных SRD-текстов исправлен
  только duplicate-key lexer существующего UnifiedJson, без ослабления guards
  и без смены adapter/projection v4.

[Машиночитаемый итог и все 160 решений](CONTENT_06_RESULT.json),
[исходный review bundle](../resources/data/content/srd-2024-batch-01/review.json),
[проверка БД](../artifacts/content-06/database-verification.json),
[воспроизводимость](../artifacts/content-06/reproducibility.json),
[проверка HTML](../artifacts/content-06/report-check.json).
