# CONTENT-APPROVAL-01 Пакет решений B1–B7 и C1–C15

Дата: 12 ноября 2026. **Для ручного утверждения. Принятых решений в этом пакете нет.**

Рекомендуемый первый выбор: адресно принять 7 baseline, одобрить 7 простых C,
проверить и отдельно одобрить ещё 6 C; Bag of Holding и Wish пока отложить.
У всех C предлагаемая граница одна: **browse=true, copy=true, execute=false**.
Это разрешение справочного содержимого и независимого копирования в будущем,
без автоматических атак, лечения, AC, расхода или иных игровых профилей новых копий.
Существующие игровые копии остаются прежними.

## Как читать решения

**B** — принять конкретную существующую строку как исходную для будущего обновления.
Для всех семи единственное расхождение: в старом JSON нет `ammunition`, текущий
маппер возвращает `null`. Принятие B разрешает только это отличие по политике
`legacy-equipment-missing-null-ammunition-v1`; остальные проверки сохраняются.
Оно само не обновляет строку и не одобряет её содержимое.

**C** — одобрить EN/RU, исправления и конкретную проекцию **v4**.
Для C1–C7 дополнительно нужен соответствующий B. `conflict → update` означает
будущий результат после двух одобрений, а не уже выполненное обновление.
`preserve` означает оставить существующую запись; для новой C8 — не создавать.
До явного ответа человека действуют preserve для 14 существующих записей и запрет
создания C8. Рекомендация по умолчанию не является согласием.

Метки относятся к **решению в указанных границах**, а не к готовности live импорта:

- **Безопасно утвердить — 14 пунктов:** B1–B7; C1, C3, C4, C5, C7, C9, C10.
- **Требует внимания — 6 пунктов:** C2, C6, C11, C12, C13, C14.
- **Лучше отложить — 2 пункта:** C8, C15, до полной вычитки длинного перевода.

## Единая таблица решений

В колонке «Тип» указан текущий конфликт или предполагаемая операция каталога;
в последней колонке — рекомендуемый ответ человека. Все строки пока ожидают ответа.
Риск оценён для справочного варианта с execute=false.

| ID / сущность | Тип | Текущее состояние по сохранённому аудиту | Предлагаемый вариант | Риск | Простое объяснение | Метка | Решение по умолчанию |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [B1](#c1) · Acid #340 | conflict | Старый API baseline; `ammunition` отсутствует; копий нет | Принять только эквивалентность отсутствия ключа и null для #340 | Низкий; разрешение привязано к digest | Это форма старого JSON, не обнаруженная правка GM | Безопасно утвердить | Принять B1; содержимое отдельно C1 |
| [B2](#c2) · Arrows #345 | conflict | То же отличие; есть 1 ItemDefinition, 2 inventory-строки и receipt | Принять baseline #345, не менять количество и упаковку | Низкий для B; семантика пачки проверяется в C2 | Техническое принятие не превращает пачку в одну стрелу | Безопасно утвердить | Принять B2; содержимое отдельно C2 |
| [B3](#c3) · Chain Mail #374 | conflict | То же отличие; AC 16; есть definition, inventory-строка и receipt | Принять baseline #374 с тем же ID и связями | Низкий; нельзя заменять AC на прибавку | Исправляется доверие к исходной строке, не правила брони | Безопасно утвердить | Принять B3; содержимое отдельно C3 |
| [B4](#c4) · Leather Armor #430 | conflict | То же отличие; AC 11+Dex; есть definition, inventory-строка и receipt | Принять baseline #430, сохранить связи | Низкий; Dex остаётся без потолка | Нет основания создавать второй кожаный доспех | Безопасно утвердить | Принять B4; содержимое отдельно C4 |
| [B5](#c5) · Longsword #436 | conflict | То же отличие; 1d8 / Versatile 1d10; есть definition, 2 inventory-строки и receipt | Принять baseline #436 без смены ID/type/key | Низкий; существующие экземпляры не переписывать | Хват, бонусы и эффекты оружия персонажей сохраняются | Безопасно утвердить | Принять B5; содержимое отдельно C5 |
| [B6](#c6) · Potion of Healing #467 | conflict | То же отличие; 2 definitions, 7 inventory-строк, 2 receipts | Принять baseline #467, сохранить все экземпляры | Низкий для B; перевод отдельно C6 | Принятие baseline не расходует и не выдаёт зелья | Безопасно утвердить | Принять B6; содержимое отдельно C6 |
| [B7](#c7) · Shield equipment #486 | conflict | То же отличие; бонус AC +2; есть definition, inventory-строка и receipt | Принять baseline #486 как предмет, отдельно от spell #275 | Низкий; важна раздельная идентичность | Два Shield — разные сущности, объединять их нельзя | Безопасно утвердить | Принять B7; содержимое отдельно C7 |
| [C1](#c1) · Acid #340 | conflict → update | B1 и C1 pending; эффект остаётся прозой | EN/RU: 25 gp, 1 lb; замена атаки, видимая цель до 20 ft, Dex DC 8+Dex+PB, 2d6 acid | Низкий; GM разрешает эффект вручную | Числа в описании не создают автоматическую Ability | Безопасно утвердить | Одобрить update после B1; execute=false |
| [C2](#c2) · Arrows #345 | conflict → update | B2 и C2 pending; исходная пачка 20, raw storage=quiver; прозы EN/RU нет | Сохранить 1 gp / 1 lb **за 20 стрел**; колчан отдельно; отсутствующую прозу не выдумывать | Средний: легко принять цену и вес пачки за одну стрелу | Количество выдачи задаётся явно; inventory quantity не пересчитывается | Требует внимания | Одобрить update после проверки пачки и B2; execute=false |
| [C3](#c3) · Chain Mail #374 | conflict → update | B3 и C3 pending; AC 16, Str 13, помеха Stealth, 75 gp / 55 lb | Сохранить характеристики и имеющийся текст; не добавлять новую прозу и training/Speed-автоматику | Низкий в справке; Str 13 — условие Speed, не запрет надеть | Импорт не реализует правила владения тяжёлой бронёй | Безопасно утвердить | Одобрить update после B3; execute=false |
| [C4](#c4) · Leather Armor #430 | conflict → update | B4 и C4 pending; AC 11+Dex, 10 gp / 10 lb; прозы нет | Сохранить AC и Dex без потолка, отсутствие прозы и все копии | Низкий; ограничение Dex здесь было бы ошибкой | Обычные характеристики достаточны, описание не сочиняем | Безопасно утвердить | Одобрить update после B4; execute=false |
| [C5](#c5) · Longsword #436 | conflict → update | B5 и C5 pending; 1d8 slashing, Versatile 1d10, Sap, 15 gp / 3 lb | Сохранить значения; Sap оставить сведением для GM | Низкий в справке; mastery не автоматизирована | Одобрение оружия не включает Sap и не меняет боевые экземпляры | Безопасно утвердить | Одобрить update после B5; execute=false |
| [C6](#c6) · Potion of Healing #467 | conflict → update | B6 и C6 pending; RU-предложение заменяет «дать» на «напоить» | Bonus Action: выпить или **напоить** существо до 5 ft; 2d4+2 HP; 50 gp / 0.5 lb | Средний: передать предмет и напоить — разные действия | Одобряется точный текст действия, не авторасход зелья | Требует внимания | Одобрить update с правкой RU после B6; execute=false |
| [C7](#c7) · Shield equipment #486 | conflict → update | B7 и C7 pending; +2 AC, 10 gp / 6 lb; недостающая проза не дополнена | Сохранить бонус +2 и отдельный equipment ID; без выдуманного полного описания | Низкий в справке; не путать с base AC или заклинанием | Training, один щит и Utilize остаются условиями правил для GM | Безопасно утвердить | Одобрить update после B7; execute=false |
| [C8](#c8) · Bag of Holding · ID ещё нет | create / пока preserve | Новая запись; предложены новое RU-имя и полный RU-текст | Кандидат: «Сумка хранения», Uncommon; 500 lb / 64 ft³; собственный вес **5 lb в тексте**; механика вручную | Высокий: длинный перевод, воздух, уничтожение и астральный проход | Нужно прочитать весь RU, включая сферу 10 ft и односторонний проход; структурный weight остаётся null | Лучше отложить | Пока не создавать; вернуться после полной вычитки EN/RU |
| [C9](#c9) · Cure Wounds #73 | update | C9 pending; основная проекция прежняя; 67 receipts, 1 текущая Ability | Подтвердить EN/RU 2024: 2d8+modifier, +2d8 за круг выше 1; без запрета Undead/Constructs из 2014 | Низкий; важно сохранить редакцию 2024 | Существующее лечение персонажа не заменяется новой записью | Безопасно утвердить | Одобрить update; execute=false |
| [C10](#c10) · Detect Magic #82 | update | C10 pending; прямых копий и текущих Ability не найдено | EN/RU: ritual, concentration до 10 min, 30 ft, условия ауры/преград; всегда GM/manual | Низкий при ручном использовании | Ни аура, ни видимость сквозь стены не появятся автоматически | Безопасно утвердить | Одобрить update; execute=false |
| [C11](#c11) · Fireball #126 | update | C11 pending; усиление раньше было только в raw.higher_level; 67 receipts, 1 Ability | Полный EN/RU с **+1d6/круг**; normalized.higher_level=null устраняет повтор; 8d6 fire, Dex/half, 150 ft, сфера 20 ft | Средний: повтор усиления и ожидание полной симуляции | Потенциальный профиль лишь PARTIAL: пожары и объём остаются GM | Требует внимания | Одобрить update после проверки EN/RU усиления; execute=false |
| [C12](#c12) · Healing Word #161 | update | C12 pending; усиление раньше только в raw.higher_level; 67 receipts, 1 Ability | Полный EN/RU: 2d4+modifier, **+2d4/круг**, Bonus Action, видимая цель до 60 ft; повтор убрать | Средний: нельзя перенести формулу 2014 или повторить усиление | Одобряется текст 2024; старые Ability остаются прежними | Требует внимания | Одобрить update после проверки формулы; execute=false |
| [C13](#c13) · Magic Missile #199 | update | C13 pending; усиление раньше только в raw.higher_level; прямых копий нет | Полный EN/RU: 3 заряда по 1d4+1 force, **+1 заряд/круг**, 120 ft; без повтора усиления | Средний: распределение зарядов не поддержано | Заклинание остаётся GM/manual, цифры не включают single-target auto-damage | Требует внимания | Одобрить update после проверки зарядов; execute=false |
| [C14](#c14) · Shield spell #275 | update | C14 pending; основная проекция прежняя; 67 receipts, 1 Ability | Сохранить полный EN/RU: reaction, +5 AC включая triggering attack, до начала следующего хода, защита от Magic Missile | Средний: полный текст шире существующего PARTIAL-профиля | Автоперехвата реакции и иммунитета Magic Missile одобрение не добавляет | Требует внимания | Одобрить update с явным ручным разрешением условий; execute=false |
| [C15](#c15) · Wish #337 | update / пока preserve | C15 pending; upstream ошибочно классифицирует стресс как основной damage; длинная RU-правка | Кандидат: полный исправленный RU; **normalized.damage=null**, raw.damage сохранить как evidence; всегда GM/manual | Высокий: смысл желаний, примеры, ограничения и стресс | 1d10 necrotic относится к последующим заклинаниям после стресса, не к основной атаке Wish | Лучше отложить | Пока preserve; затем отдельно одобрить полный RU и damage=null |

## Короткая форма для ручного ответа

Можно скопировать блок и оставить только решения, которые действительно приняты.
Чекбоксы пусты намеренно. Отсутствие ID в ответе означает «отложить», не согласие.
Для шести пунктов внимания сначала проверить выделенные условия таблицы и тексты ниже.

```text
CONTENT-APPROVAL-01, проекция v4, снимок e3bbb61db08689ab73b7345e253e52f6112d509cf0b05a72296c56ba105960a8
Проверяющий: __________  Дата/время с часовым поясом: __________

[ ] B1–B7: принимаю только legacy-equipment-missing-null-ammunition-v1
    для указанных семи entry_id и baseline_digest этого снимка.
    Содержимое этим не одобряю.

[ ] C1,C3,C4,C5,C7,C9,C10: EN/RU и проекции v4 прочитаны;
    одобряю содержимое, browse=true, copy=true, execute=false.

[ ] C2,C6,C11,C12,C13,C14: EN/RU и проекции v4 прочитаны;
    упаковка стрел, «напоить», усиление и ручные ограничения проверены;
    одобряю содержимое, browse=true, copy=true, execute=false.

[ ] C8: отложить; не создавать Bag of Holding до полной вычитки.
[ ] C15: отложить; сохранить Wish до полной вычитки RU и решения damage=null.

Исключения или иной выбор по отдельным ID: __________
Основание проверки / замечания по выбранным ID: __________

Этот ответ фиксирует только B/C. Миграцию, импорт, runtime, изображения
и автоматическое исполнение им не разрешаю.
```

Если принять все рекомендации выше, будущая выбранная пачка составит **13 update,
0 create**; Wish сохранится, Bag of Holding не создаётся. Если после отдельной
вычитки одобрить также C8 и C15, кандидат полной пачки — **1 create + 14 update**.
B1–B7 не считаются семью дополнительными изменениями: это условия C1–C7.
При исключении любого B исключить и соответствующее обновление C из будущей пачки.
Writer требует полностью одобренную выбранную пачку; исходный manifest из 15
записей нельзя использовать как неявно сокращённый список.

## Версия и границы одобрения

Состояние взято из сохранённого аудита **12.11.2026 16:28:57 +02:00**, а не из нового
подключения к live DB. В нём: **1 create / 7 update / 7 conflict**, все 15 отклонены
review-гейтами. В текущем пилотном manifest: `reviews=[]`, `baseline_reviews=[]`.
В этой задаче команды подтверждения не запускались, manifest не изменён.

Основание для точной привязки ответа:

- [Снимок v4 с полными digest и checksum](CONTENT_CONSUMERS_LIVE_DIFF.json).
  SHA-256 файла: `e3bbb61db08689ab73b7345e253e52f6112d509cf0b05a72296c56ba105960a8`.
- [Пилотный manifest с шестью исправлениями](../resources/data/content/srd-2024-pilot.manifest.json).
  SHA-256 файла: `403de783b1e34234502f6bbc4790f7ae4764cf5990acda53014cd7279836525f`.
- Source `srd-2024`, ruleset `dnd-2024`, adapter **4**; export commit
  `dff09cc6f6764734d20fdba65a07a041613697ca`, library `0.9.0-audit.1`.

B привязан к `id + entry_id + baseline_digest + policy`, C — к
`id + checksum + projection_checksum + languages=[en,ru]` и указанным правам.
Все эти значения приведены ниже. Хеши проекций v2/v3 использовать нельзя.
Изменение baseline, текста, проекции или файлов снимка требует повторной сверки
затронутых решений; автоматического переноса согласия на новую версию нет.

Сверка выбранного пилота с SRD 5.2.1 описана в CONTENT-03; она не превращает весь
upstream в проверенную официальную редакцию: `exact_rules_revision_verified=false`
сохраняется. RU остаётся редакторским переводом, не официальной локализацией.

## Что остаётся отдельным решением

[CONTENT-FIX-01](CONTENT_FIX_01.md) подтвердил миграцию и копирование на изолированной
MySQL/приложении 8092; по его итоговому отчёту основной live 8090 остался на прежней
схеме. Активация `2026_11_12_170000_add_compendium_copy_contracts.php` требует отдельного
согласованного шага с новым восстановимым backup. Этот пакет её не разрешает.

[CONTENT-UX-02](CONTENT_UX_02.md) улучшает каталог, Inspector и русские подписи;
его визуальная QA не является одобрением текстов, baseline или импорта.
Кодовые consumer-блокеры из старого CONTENT-04 исправлены в
[CONTENT_CONSUMERS_REPORT](CONTENT_CONSUMERS_REPORT.md); переносить их в пакет
как всё ещё нерешённые ошибки кода не нужно. Активация live-схемы остаётся отдельной.

После ручных B/C нужны новый diff выбранного подтверждённого manifest и отдельное
разрешение CONTENT-05 на импорт/включение writer. CLI apply и прямой live writer
сейчас закрыты кодом. Для автоматизации потребуется отдельное решение по точному
execution-профилю; в этом пакете execute=false у всех 15. Acid, Bag of Holding,
Detect Magic, Magic Missile и Wish на этом этапе всегда GM/manual.
Права на artwork также отдельно; остаётся neutral fallback.

Основные отчёты: [CONTENT-03](CONTENT_03_REPORT.md),
[CONTENT-04](CONTENT_04_REPORT.md),
[consumer-контракты и v4](CONTENT_CONSUMERS_REPORT.md).

## Тексты и проекции для вычитки

Ниже — раскрываемые карточки всех C из сохранённого полного
[аудита v4](../artifacts/content-consumers/live-audit.json).
Полные EN/RU приведены без редакторского сокращения; отсутствие описания отмечено
явно. JSON показывает структурированные поля предлагаемой нормализации без
служебного блока `content` и уже показанного описания; его полная форма и provenance доступны в исходном аудите.
Профиль исполнения упомянут только как возможность отдельного будущего решения.
Числа в тексте не означают наличия соответствующего структурированного поля.

<a id="c1"></a>
<details>
<summary>C1 · Acid #340</summary>

Запись: `srd:equipment:acid:2024`. Операция в сохранённом diff: `conflict`; право исполнения в предлагаемом решении: **execute=false**.
B1: entry_id `340`, policy `legacy-equipment-missing-null-ammunition-v1`, baseline_digest `61b589d662b57002ac14d917e7070d3b3c61951d827eab9b5eb4a6daf2fabe80`.

Content checksum: `f5864f407cadbed32049992f8e4e22cab472192e18578209e75f6671876351cf`.

Projection checksum v4: `4a9d05f0dbd25e76ace8206439efd4d51a6153cad5402553083f8a94a11ad60b`.

**EN · Acid**

When you take the Attack action, you can replace one of your attacks with throwing a vial of Acid. Target one creature or object you can see within 20 feet of yourself. The target must succeed on a Dexterity saving throw (DC 8 plus your Dexterity modifier and Proficiency Bonus) or take 2d6 Acid damage.

**RU · Кислота**

Совершая действие «Атака», вы можете заменить одну из своих атак броском склянки Кислоты. Выберите целью одно существо или предмет, которое вы видите в пределах 20 футов от себя. Цель должна преуспеть в спасброске Ловкости (Сл 8 + ваш модификатор Ловкости и Бонус мастерства) или получить 2d6 урона Кислотой.

**Структурированные поля v4** (описание показано выше; служебный `content` — в исходном аудите):

```json
{
  "schema_version": 1,
  "key": "acid",
  "name": "Acid",
  "category": "adventuring_item",
  "equipment_categories": [
    "adventuring_gear"
  ],
  "damage": null,
  "ammunition": null,
  "two_handed_damage": null,
  "weapon_properties": [],
  "weapon_mastery": null,
  "range": null,
  "throw_range": null,
  "armor": null,
  "cost": {
    "quantity": 25,
    "unit": "gp"
  },
  "weight": {
    "value": 1,
    "unit": "lb"
  }
}
```

Execution-профиль не поддержан: **всегда GM/manual** на этом этапе.

</details>

<a id="c2"></a>
<details>
<summary>C2 · Arrows #345</summary>

Запись: `srd:equipment:arrows:2024`. Операция в сохранённом diff: `conflict`; право исполнения в предлагаемом решении: **execute=false**.
B2: entry_id `345`, policy `legacy-equipment-missing-null-ammunition-v1`, baseline_digest `c3a9091eaa0a9eb8d4346b805ee02ca798d969a6c6bab96a9580449245b7e2d8`.

Content checksum: `13f1c3bd2b19d072847d47a35c48be5559f7d5c57ac8a3faf451d9b42a714e13`.

Projection checksum v4: `170af7df21d7e9583bdaef623395d6f4d4b5836c8345cdc2e4c79076f8b5b019`.

**EN · Arrows**

_Описание отсутствует в источнике; текст не добавлен._

**RU · Стрелы**

_Описание отсутствует в источнике; текст не добавлен._

**Структурированные поля v4** (описание показано выше; служебный `content` — в исходном аудите):

```json
{
  "schema_version": 1,
  "key": "arrows",
  "name": "Arrows",
  "category": "adventuring_item",
  "equipment_categories": [
    "ammunition"
  ],
  "damage": null,
  "ammunition": null,
  "two_handed_damage": null,
  "weapon_properties": [],
  "weapon_mastery": null,
  "range": null,
  "throw_range": null,
  "armor": null,
  "cost": {
    "quantity": 1,
    "unit": "gp"
  },
  "weight": {
    "value": 1,
    "unit": "lb"
  }
}
```

Существующий ограниченный execution-профиль есть, но **не одобряется** этим решением.

</details>

<a id="c3"></a>
<details>
<summary>C3 · Chain Mail #374</summary>

Запись: `srd:equipment:chain-mail:2024`. Операция в сохранённом diff: `conflict`; право исполнения в предлагаемом решении: **execute=false**.
B3: entry_id `374`, policy `legacy-equipment-missing-null-ammunition-v1`, baseline_digest `9ab016ef867fe46282eafec7b0cbb21a013453b7713584993f1fbf54d4afef29`.

Content checksum: `6bb1e158068a10e42e3107ed55bb66bf39d7c692a75554184b7c30dbcd818b44`.

Projection checksum v4: `64410f43023cfedb14e2ea34ae4aa7dc9b3520f8ae2a9a0c55a267e36bf71260`.

**EN · Chain Mail**

_Описание отсутствует в источнике; текст не добавлен._

**RU · Кольчужный доспех**

_Описание отсутствует в источнике; текст не добавлен._

**Структурированные поля v4** (описание показано выше; служебный `content` — в исходном аудите):

```json
{
  "schema_version": 1,
  "key": "chain_mail",
  "name": "Chain Mail",
  "category": "armor",
  "equipment_categories": [
    "armor",
    "heavy_armor"
  ],
  "damage": null,
  "ammunition": null,
  "two_handed_damage": null,
  "weapon_properties": [],
  "weapon_mastery": null,
  "range": null,
  "throw_range": null,
  "armor": {
    "category": "heavy_armor",
    "ac_semantics": "base",
    "base_ac": 16,
    "ac_bonus": null,
    "add_dex": false,
    "max_dex_bonus": 0,
    "strength_minimum": 13,
    "stealth_disadvantage": true
  },
  "cost": {
    "quantity": 75,
    "unit": "gp"
  },
  "weight": {
    "value": 55,
    "unit": "lb"
  }
}
```

Существующий ограниченный execution-профиль есть, но **не одобряется** этим решением.

</details>

<a id="c4"></a>
<details>
<summary>C4 · Leather Armor #430</summary>

Запись: `srd:equipment:leather-armor:2024`. Операция в сохранённом diff: `conflict`; право исполнения в предлагаемом решении: **execute=false**.
B4: entry_id `430`, policy `legacy-equipment-missing-null-ammunition-v1`, baseline_digest `dcc3aeba8f72970522d7a01aa953286d6c4ca909940721bb5d355e2b2bca3d85`.

Content checksum: `10c5fb4514a6ead647601691b0832c91d884b726ecd39a8767c722fcbcd7b313`.

Projection checksum v4: `c3376d93c11ecde3f8378b41139cf3c8f5e89e0e6ac7ae75a787486459d49613`.

**EN · Leather Armor**

_Описание отсутствует в источнике; текст не добавлен._

**RU · Кожаный доспех**

_Описание отсутствует в источнике; текст не добавлен._

**Структурированные поля v4** (описание показано выше; служебный `content` — в исходном аудите):

```json
{
  "schema_version": 1,
  "key": "leather_armor",
  "name": "Leather Armor",
  "category": "armor",
  "equipment_categories": [
    "armor",
    "light_armor"
  ],
  "damage": null,
  "ammunition": null,
  "two_handed_damage": null,
  "weapon_properties": [],
  "weapon_mastery": null,
  "range": null,
  "throw_range": null,
  "armor": {
    "category": "light_armor",
    "ac_semantics": "base",
    "base_ac": 11,
    "ac_bonus": null,
    "add_dex": true,
    "max_dex_bonus": null,
    "strength_minimum": 0,
    "stealth_disadvantage": false
  },
  "cost": {
    "quantity": 10,
    "unit": "gp"
  },
  "weight": {
    "value": 10,
    "unit": "lb"
  }
}
```

Существующий ограниченный execution-профиль есть, но **не одобряется** этим решением.

</details>

<a id="c5"></a>
<details>
<summary>C5 · Longsword #436</summary>

Запись: `srd:equipment:longsword:2024`. Операция в сохранённом diff: `conflict`; право исполнения в предлагаемом решении: **execute=false**.
B5: entry_id `436`, policy `legacy-equipment-missing-null-ammunition-v1`, baseline_digest `b629882ef28edd4bc52045ee6acd7f6deada21fd0b44445773b10b629b9ad9bf`.

Content checksum: `db88a0878bb279d08635493d8f62b2747237674a648b1f2f663f268070e6e440`.

Projection checksum v4: `b31ae6cfbece1298c8b0006c58fc3ba0bf115ca3aa7959080fb798750df24fbe`.

**EN · Longsword**

_Описание отсутствует в источнике; текст не добавлен._

**RU · Длинный меч**

_Описание отсутствует в источнике; текст не добавлен._

**Структурированные поля v4** (описание показано выше; служебный `content` — в исходном аудите):

```json
{
  "schema_version": 1,
  "key": "longsword",
  "name": "Longsword",
  "category": "weapon",
  "equipment_categories": [
    "martial_melee_weapons",
    "martial_weapons",
    "melee_weapons",
    "weapons"
  ],
  "damage": {
    "expression": "1d8",
    "damage_type": "slashing"
  },
  "ammunition": null,
  "two_handed_damage": {
    "damage_dice": "1d10",
    "damage_type": {
      "index": "slashing",
      "name": "Slashing",
      "url": "/api/2024/damage-types/slashing"
    }
  },
  "weapon_properties": [
    "versatile"
  ],
  "weapon_mastery": "sap",
  "range": {
    "normal": 5,
    "long": null,
    "unit": "ft"
  },
  "throw_range": null,
  "armor": null,
  "cost": {
    "quantity": 15,
    "unit": "gp"
  },
  "weight": {
    "value": 3,
    "unit": "lb"
  }
}
```

Существующий ограниченный execution-профиль есть, но **не одобряется** этим решением.

</details>

<a id="c6"></a>
<details>
<summary>C6 · Potion of Healing #467</summary>

Запись: `srd:equipment:potion-of-healing:2024`. Операция в сохранённом diff: `conflict`; право исполнения в предлагаемом решении: **execute=false**.
B6: entry_id `467`, policy `legacy-equipment-missing-null-ammunition-v1`, baseline_digest `5322310b5da605e25d4d863fb383d439d211bcc153210a0d7f1728415863d4d8`.

Content checksum: `496c81e1c47fded10cc863a7290bd8ec93023986400ed675a938d1b757bfe3f7`.

Projection checksum v4: `316dbe107739feccc292f13224f6a60b5fab265bc6e2f6d3190eef5938ac0c09`.

**EN · Potion of Healing**

This potion is a magic item. As a Bonus Action, you can drink it or administer it to another creature within 5 feet of yourself. The creature that drinks the magical red fluid in this vial regains 2d4 + 2 Hit Points.

**RU · Зелье лечения**

Это зелье — магический предмет. Бонусным действием вы можете выпить его или напоить им другое существо в пределах 5 футов от себя. Существо, выпившее магическую красную жидкость из этой склянки, восстанавливает 2d4 + 2 хита.

**Структурированные поля v4** (описание показано выше; служебный `content` — в исходном аудите):

```json
{
  "schema_version": 1,
  "key": "potion_of_healing",
  "name": "Potion of Healing",
  "category": "adventuring_item",
  "equipment_categories": [
    "adventuring_gear"
  ],
  "damage": null,
  "ammunition": null,
  "two_handed_damage": null,
  "weapon_properties": [],
  "weapon_mastery": null,
  "range": null,
  "throw_range": null,
  "armor": null,
  "cost": {
    "quantity": 50,
    "unit": "gp"
  },
  "weight": {
    "value": 0.5,
    "unit": "lb"
  }
}
```

Существующий ограниченный execution-профиль есть, но **не одобряется** этим решением.

</details>

<a id="c7"></a>
<details>
<summary>C7 · Shield #486</summary>

Запись: `srd:equipment:shield:2024`. Операция в сохранённом diff: `conflict`; право исполнения в предлагаемом решении: **execute=false**.
B7: entry_id `486`, policy `legacy-equipment-missing-null-ammunition-v1`, baseline_digest `35c25b0ab9d99301784023c17058009a2f624d7539065a43fbe8b1c4adfbcbbf`.

Content checksum: `d05f779c0fc504a1cae3b6506acacf784e702981a174f463b92050b960ee2c51`.

Projection checksum v4: `aa6de60c2b28659cf3810e12f09e0f2ed8eac3dbebd713ea8192bab44117e9a1`.

**EN · Shield**

_Описание отсутствует в источнике; текст не добавлен._

**RU · Щит**

_Описание отсутствует в источнике; текст не добавлен._

**Структурированные поля v4** (описание показано выше; служебный `content` — в исходном аудите):

```json
{
  "schema_version": 1,
  "key": "shield",
  "name": "Shield",
  "category": "armor",
  "equipment_categories": [
    "armor",
    "shields"
  ],
  "damage": null,
  "ammunition": null,
  "two_handed_damage": null,
  "weapon_properties": [],
  "weapon_mastery": null,
  "range": null,
  "throw_range": null,
  "armor": {
    "category": "shield",
    "ac_semantics": "bonus",
    "base_ac": null,
    "ac_bonus": 2,
    "add_dex": false,
    "max_dex_bonus": null,
    "strength_minimum": 0,
    "stealth_disadvantage": false
  },
  "cost": {
    "quantity": 10,
    "unit": "gp"
  },
  "weight": {
    "value": 6,
    "unit": "lb"
  }
}
```

Существующий ограниченный execution-профиль есть, но **не одобряется** этим решением.

</details>

<a id="c8"></a>
<details>
<summary>C8 · Bag of Holding · нового ID нет</summary>

Запись: `srd:magic_item:bag-of-holding:2024`. Операция в сохранённом diff: `create`; право исполнения в предлагаемом решении: **execute=false**.

Content checksum: `b125cf57e16c46d32cec204dda2b2bb1ae578f289005458956c893fa01f65a8f`.

Projection checksum v4: `e1bb5266f125b0183a1c5927183705d8faede8491cdf02dbdbf22689ddb6ea2f`.

**EN · Bag of Holding**

Wondrous Item

This bag has an interior space considerably larger than its outside dimensions-roughly 2 feet square and 4 feet deep on the inside. The bag can hold up to 500 pounds, not exceeding a volume of 64 cubic feet. The bag weighs 5 pounds, regardless of its contents. Retrieving an item from the bag requires a Utilize action.

If the bag is overloaded, pierced, or torn, it is destroyed, and its contents are scattered in the Astral Plane. If the bag is turned inside out, its contents spill forth unharmed, but the bag must be put right before it can be used again. The bag holds enough air for 10 minutes of breathing, divided by the number of breathing creatures inside.

Placing a Bag of Holding inside an extradimensional space created by a Handy Haversack, Portable Hole, or similar item instantly destroys both items and opens a gate to the Astral Plane. The gate originates where the one item was placed inside the other. Any creature within a 10-foot-radius Sphere centered on the gate is sucked through it to a random location on the Astral Plane. The gate then closes. The gate is one-way and can't be reopened.

**RU · Сумка хранения**

Чудесный предмет, необычный.

Внутреннее пространство этой сумки значительно больше её внешних размеров: внутри оно составляет примерно 2 фута на 2 фута и 4 фута в глубину. Сумка вмещает до 500 фунтов при объёме не более 64 кубических футов. Независимо от содержимого сумка весит 5 фунтов. Чтобы достать из неё предмет, требуется действие «Использование» (Utilize).

Если сумку перегрузить, проколоть или разорвать, она уничтожается, а её содержимое рассеивается на Астральном плане. Если вывернуть сумку наизнанку, содержимое высыпается без повреждений, но для дальнейшего использования сумку нужно вывернуть обратно. Воздуха внутри хватает на 10 минут дыхания; это время делится на число находящихся внутри дышащих существ.

Если поместить Сумку хранения во внепространственное пространство, созданное Удобным рюкзаком (Handy Haversack), Переносной дырой (Portable Hole) или подобным предметом, оба предмета немедленно уничтожаются и открывается проход на Астральный план. Он возникает там, где один предмет поместили внутрь другого. Каждое существо в сфере радиусом 10 футов с центром на проходе затягивается через него в случайное место на Астральном плане. Затем проход закрывается. Он односторонний и не может быть открыт повторно.

**Структурированные поля v4** (описание показано выше; служебный `content` — в исходном аудите):

```json
{
  "schema_version": 1,
  "key": "bag_of_holding",
  "name": "Bag of Holding",
  "category": "adventuring_item",
  "equipment_categories": [
    "wondrous_items"
  ],
  "damage": null,
  "ammunition": null,
  "two_handed_damage": null,
  "weapon_properties": [],
  "weapon_mastery": null,
  "range": null,
  "throw_range": null,
  "armor": null,
  "cost": null,
  "weight": null,
  "subtype": "magic_item",
  "rarity": "Uncommon"
}
```

Execution-профиль не поддержан: **всегда GM/manual** на этом этапе.

</details>

<a id="c9"></a>
<details>
<summary>C9 · Cure Wounds #73</summary>

Запись: `srd:spell:cure-wounds:2024`. Операция в сохранённом diff: `update`; право исполнения в предлагаемом решении: **execute=false**.

Content checksum: `b5abdb0be7e0fa31a1db9ab639154a5c81fce55878c7cdcea9f426300c7eab7d`.

Projection checksum v4: `88f66b5581408d40fc45d3c465451aabef4a162a279909e0fdca9d5a28975708`.

**EN · Cure Wounds**

A creature you touch regains a number of Hit Points equal to 2d8 plus your spellcasting ability modifier. Using a Higher-Level Spell Slot. The healing increases by 2d8 for each spell slot level above 1.

**RU · Лечение ран**

Существо, которого вы касаетесь, восстанавливает количество Хитов, равное 2d8 плюс модификатор вашей магической характеристики. **Использование ячейки заклинания более высокого уровня.** Лечение увеличивается на 2d8 за каждый уровень ячейки заклинания выше 1.

**Структурированные поля v4** (описание показано выше; служебный `content` — в исходном аудите):

```json
{
  "schema_version": 1,
  "key": "cure_wounds",
  "name": "Cure Wounds",
  "spell_level": 1,
  "school": "abjuration",
  "range": {
    "text": "Touch",
    "distance": null,
    "unit": "ft",
    "kind": "touch"
  },
  "area": null,
  "casting_time": "Action",
  "duration": "Instantaneous",
  "concentration": false,
  "ritual": false,
  "components": [
    "V",
    "S"
  ],
  "material": null,
  "classes": [
    "bard",
    "cleric",
    "druid",
    "paladin",
    "ranger"
  ],
  "saving_throw": null,
  "attack_type": null,
  "damage": {
    "expression": null,
    "damage_type": null,
    "at_slot_level": [],
    "at_character_level": []
  },
  "higher_level": null,
  "mechanics_automated": false
}
```

Существующий ограниченный execution-профиль есть, но **не одобряется** этим решением.

</details>

<a id="c10"></a>
<details>
<summary>C10 · Detect Magic #82</summary>

Запись: `srd:spell:detect-magic:2024`. Операция в сохранённом diff: `update`; право исполнения в предлагаемом решении: **execute=false**.

Content checksum: `1a8deb39006aca1759cb8acd962e97bd5b2d6a6b0cde41d41fde1c75f11ccab7`.

Projection checksum v4: `bb99401f100c419766f65d3aa48d64c15f271bdcf660c5b8fa12a5fda8141d58`.

**EN · Detect Magic**

For the duration, you sense the presence of magical effects within 30 feet of yourself. If you sense such effects, you can take the Magic action to see a faint aura around any visible creature or object in the area that bears the magic, and if an effect was created by a spell, you learn the spell's school of magic.
  The spell is blocked by 1 foot of stone, dirt, or wood; 1 inch of metal; or a thin sheet of lead.

**RU · Обнаружение магии**

В течение длительности вы ощущаете присутствие магических эффектов в пределах 30 футов от вас. Если вы ощущаете такие эффекты, вы можете действием Магия увидеть слабую ауру вокруг любого видимого существа или объекта в области, несущего магию, а если эффект создан заклинанием, вы узнаёте школу магии этого заклинания.
  Заклинание блокируется 1 футом камня, земли или дерева; 1 дюймом металла; или тонким свинцовым листом.

**Структурированные поля v4** (описание показано выше; служебный `content` — в исходном аудите):

```json
{
  "schema_version": 1,
  "key": "detect_magic",
  "name": "Detect Magic",
  "spell_level": 1,
  "school": "divination",
  "range": {
    "text": "Self",
    "distance": null,
    "unit": "ft",
    "kind": "self"
  },
  "area": null,
  "casting_time": "Action",
  "duration": "up to 10 minutes",
  "concentration": true,
  "ritual": true,
  "components": [
    "V",
    "S"
  ],
  "material": null,
  "classes": [
    "bard",
    "cleric",
    "druid",
    "paladin",
    "ranger",
    "sorcerer",
    "warlock",
    "wizard"
  ],
  "saving_throw": null,
  "attack_type": null,
  "damage": {
    "expression": null,
    "damage_type": null,
    "at_slot_level": [],
    "at_character_level": []
  },
  "higher_level": null,
  "mechanics_automated": false
}
```

Execution-профиль не поддержан: **всегда GM/manual** на этом этапе.

</details>

<a id="c11"></a>
<details>
<summary>C11 · Fireball #126</summary>

Запись: `srd:spell:fireball:2024`. Операция в сохранённом diff: `update`; право исполнения в предлагаемом решении: **execute=false**.

Content checksum: `56f3bef53a577baad6076e0939271950643b4a293afd633e01e16a6e32957322`.

Projection checksum v4: `448b6ae3fda8adfe3a4158ae0eaf638e3b66ccfbb6a7495d20cbcc45f287a0a6`.

**EN · Fireball**

A bright streak flashes from you to a point you choose within range and then blossoms with a low roar into a fiery explosion. Each creature in a 20-foot-radius Sphere centered on that point makes a Dexterity saving throw, taking 8d6 Fire damage on a failed save or half as much damage on a successful one.
  Flammable objects in the area that aren't being worn or carried start burning.

Using a Higher-Level Spell Slot. The damage increases by 1d6 for each spell slot level above 3.

**RU · Огненный шар**

Яркая вспышка проносится от вас к выбранной вами точке в пределах дистанции, а затем с низким гулом расцветает огненным взрывом. Каждое существо в Сфере радиусом 20 футов с центром в этой точке совершает спасбросок Ловкости, получая 8d6 урона Огнём при провале или половину этого урона при успехе.
  Легковоспламеняющиеся объекты в области, которые никто не носит и не несёт, начинают гореть.

При использовании ячейки более высокого уровня урон увеличивается на 1d6 за каждый уровень ячейки выше 3-го.

**Структурированные поля v4** (описание показано выше; служебный `content` — в исходном аудите):

```json
{
  "schema_version": 1,
  "key": "fireball",
  "name": "Fireball",
  "spell_level": 3,
  "school": "evocation",
  "range": {
    "text": "150 feet",
    "distance": 150,
    "unit": "ft",
    "kind": "distance"
  },
  "area": {
    "shape": "sphere",
    "size": 20,
    "unit": "ft",
    "evidence": "description"
  },
  "casting_time": "Action",
  "duration": "Instantaneous",
  "concentration": false,
  "ritual": false,
  "components": [
    "V",
    "S",
    "M"
  ],
  "material": "a ball of bat guano and sulfur",
  "classes": [
    "sorcerer",
    "wizard"
  ],
  "saving_throw": {
    "ability": "dex",
    "on_success": "half",
    "evidence": "description"
  },
  "attack_type": null,
  "damage": {
    "expression": "8d6",
    "damage_type": "fire",
    "at_slot_level": {
      "3": "8d6"
    },
    "at_character_level": []
  },
  "higher_level": null,
  "mechanics_automated": false
}
```

Существующий ограниченный execution-профиль есть, но **не одобряется** этим решением.

</details>

<a id="c12"></a>
<details>
<summary>C12 · Healing Word #161</summary>

Запись: `srd:spell:healing-word:2024`. Операция в сохранённом diff: `update`; право исполнения в предлагаемом решении: **execute=false**.

Content checksum: `1864f0efb5131ca7647a60948c68261c2a87e71d02c547b94d1c5784057fbe47`.

Projection checksum v4: `c64590cc2eaa00dafdee67dd43589ea5cf756017298c1453f49c4180705dab10`.

**EN · Healing Word**

A creature of your choice that you can see within range regains Hit Points equal to 2d4 plus your spellcasting ability modifier.

Using a Higher-Level Spell Slot. The healing increases by 2d4 for each spell slot level above 1.

**RU · Лечащее слово**

Существо по вашему выбору, которое вы видите в пределах дистанции, восстанавливает Хиты в количестве, равном 2d4 плюс модификатор вашей магической характеристики.

При использовании ячейки более высокого уровня лечение увеличивается на 2d4 за каждый уровень ячейки выше 1-го.

**Структурированные поля v4** (описание показано выше; служебный `content` — в исходном аудите):

```json
{
  "schema_version": 1,
  "key": "healing_word",
  "name": "Healing Word",
  "spell_level": 1,
  "school": "abjuration",
  "range": {
    "text": "60 feet",
    "distance": 60,
    "unit": "ft",
    "kind": "distance"
  },
  "area": null,
  "casting_time": "Bonus Action",
  "duration": "Instantaneous",
  "concentration": false,
  "ritual": false,
  "components": [
    "V"
  ],
  "material": null,
  "classes": [
    "bard",
    "cleric",
    "druid"
  ],
  "saving_throw": null,
  "attack_type": null,
  "damage": {
    "expression": null,
    "damage_type": null,
    "at_slot_level": [],
    "at_character_level": []
  },
  "higher_level": null,
  "mechanics_automated": false
}
```

Существующий ограниченный execution-профиль есть, но **не одобряется** этим решением.

</details>

<a id="c13"></a>
<details>
<summary>C13 · Magic Missile #199</summary>

Запись: `srd:spell:magic-missile:2024`. Операция в сохранённом diff: `update`; право исполнения в предлагаемом решении: **execute=false**.

Content checksum: `d216203216a7559e5ecd2b2630ef40f8b0791138bf8c4fba422e5f8a3bc03c6a`.

Projection checksum v4: `87071af7c6ab94edf294a06d30a64eead4ad839611796758786501c1247e4ca2`.

**EN · Magic Missile**

You create three glowing darts of magical force. Each dart strikes a creature of your choice that you can see within range. A dart deals 1d4 + 1 Force damage to its target. The darts all strike simultaneously, and you can direct them to hit one creature or several.

Using a Higher-Level Spell Slot. The spell creates one more dart for each spell slot level above 1.

**RU · Волшебная стрела**

Вы создаёте три светящихся заряда магической силы. Каждый заряд поражает существо по вашему выбору, которое вы видите в пределах дистанции. Заряд наносит своей цели 1d4 + 1 урона Силовой энергией. Все заряды поражают одновременно, и вы можете направить их в одно существо или в несколько.

При использовании ячейки более высокого уровня заклинание создаёт ещё один заряд за каждый уровень ячейки выше 1-го.

**Структурированные поля v4** (описание показано выше; служебный `content` — в исходном аудите):

```json
{
  "schema_version": 1,
  "key": "magic_missile",
  "name": "Magic Missile",
  "spell_level": 1,
  "school": "evocation",
  "range": {
    "text": "120 feet",
    "distance": 120,
    "unit": "ft",
    "kind": "distance"
  },
  "area": null,
  "casting_time": "Action",
  "duration": "Instantaneous",
  "concentration": false,
  "ritual": false,
  "components": [
    "V",
    "S"
  ],
  "material": null,
  "classes": [
    "sorcerer",
    "wizard"
  ],
  "saving_throw": null,
  "attack_type": null,
  "damage": {
    "expression": null,
    "damage_type": null,
    "at_slot_level": [],
    "at_character_level": []
  },
  "higher_level": null,
  "mechanics_automated": false
}
```

Execution-профиль не поддержан: **всегда GM/manual** на этом этапе.

</details>

<a id="c14"></a>
<details>
<summary>C14 · Shield #275</summary>

Запись: `srd:spell:shield:2024`. Операция в сохранённом diff: `update`; право исполнения в предлагаемом решении: **execute=false**.

Content checksum: `7b71ae6fd2a2a83f258a7423ee278c594c6d0c1fe304751f0602f03e35ea63f9`.

Projection checksum v4: `571bc396f26cc5ab42166f97ad5f4a9c476688bf4c7ad72bf60213dc558af35a`.

**EN · Shield**

An imperceptible barrier of magical force protects you. Until the start of your next turn, you have a +5 bonus to AC, including against the triggering attack, and you take no damage from Magic Missile.

**RU · Щит**

Незримый барьер из магической силы защищает вас. До начала вашего следующего хода вы получаете бонус +5 к КЗ, в том числе против спровоцировавшей атаки, и вы не получаете урона от Волшебной стрелы.

**Структурированные поля v4** (описание показано выше; служебный `content` — в исходном аудите):

```json
{
  "schema_version": 1,
  "key": "shield",
  "name": "Shield",
  "spell_level": 1,
  "school": "abjuration",
  "range": {
    "text": "Self",
    "distance": null,
    "unit": "ft",
    "kind": "self"
  },
  "area": null,
  "casting_time": "Reaction, which you take when you are hit by an attack roll or targeted by the Magic Missile spell",
  "duration": "1 round",
  "concentration": false,
  "ritual": false,
  "components": [
    "V",
    "S"
  ],
  "material": null,
  "classes": [
    "sorcerer",
    "wizard"
  ],
  "saving_throw": null,
  "attack_type": null,
  "damage": {
    "expression": null,
    "damage_type": null,
    "at_slot_level": [],
    "at_character_level": []
  },
  "higher_level": null,
  "mechanics_automated": false
}
```

Существующий ограниченный execution-профиль есть, но **не одобряется** этим решением.

</details>

<a id="c15"></a>
<details>
<summary>C15 · Wish #337</summary>

Запись: `srd:spell:wish:2024`. Операция в сохранённом diff: `update`; право исполнения в предлагаемом решении: **execute=false**.

Content checksum: `cb26b66e86054106e3aeb94ea4f01098270a749c93a5b0ea9b4a99ae3a7c306e`.

Projection checksum v4: `9a26962e1ef4d995f26f971d39012c04cd0811b7ccc39acc04c08f1b73c6d275`.

**EN · Wish**

Wish is the mightiest spell a mortal can cast. By simply speaking aloud, you can alter reality itself.
  The basic use of this spell is to duplicate any other spell of level 8 or lower. If you use it this way, you don't need to meet any requirements to cast that spell, including costly components. The spell simply takes effect.
  Alternatively, you can create one of the following effects of your choice: Object Creation. You create one object of up to 25,000 GP in value that isn't a magic item. The object can be no more than 300 feet in any dimension, and it appears in an unoccupied space that you can see on the ground. Instant Health. You allow yourself and up to twenty creatures that you can see to regain all Hit Points, and you end all effects on them listed in the Greater Restoration spell. Resistance. You grant up to ten creatures that you can see Resistance to one damage type that you choose. This Resistance is permanent. Spell Immunity. You grant up to ten creatures you can see immunity to a single spell or other magical effect for 8 hours. Sudden Learning. You replace one of your feats with another feat for which you are eligible. You lose all the benefits of the old feat and gain the benefits of the new one. You can't replace a feat that is a prerequisite for any of your other feats or features. Roll Redo. You undo a single recent event by forcing a reroll of any die roll made within the last round (including your last turn). Reality reshapes itself to accommodate the new result. For example, a Wish spell could undo an ally's failed saving throw or a foe's Critical Hit. You can force the reroll to be made with Advantage or Disadvantage, and you choose whether to use the reroll or the original roll. Reshape Reality. You may wish for something not included in any of the other effects. To do so, state your wish to the GM as precisely as possible. The GM has great latitude in ruling what occurs in such an instance; the greater the wish, the greater the likelihood that something goes wrong. This spell might simply fail, the effect you desire might be achieved only in part, or you might suffer an unforeseen consequence as a result of how you worded the wish. For example, wishing that a villain were dead might propel you forward in time to a period when that villain is no longer alive, effectively removing you from the game. Similarly, wishing for a Legendary magic item or an Artifact might instantly transport you to the presence of the item's current owner. If your wish is granted and its effects have consequences for a whole community, region, or world, you are likely to attract powerful foes. If your wish would affect a god, the god's divine servants might instantly intervene to prevent it or to encourage you to craft the wish in a particular way. If your wish would undo the multiverse itself, your wish fails. The stress of casting Wish to produce any effect other than duplicating another spell weakens you. After enduring that stress, each time you cast a spell until you finish a Long Rest, you take 1d10 Necrotic damage per level of that spell. This damage can't be reduced or prevented in any way. In addition, your Strength score becomes 3 for 2d4 days. For each of those days that you spend resting and doing nothing more than light activity, your remaining recovery time decreases by 2 days. Finally, there is a 33 percent chance that you are unable to cast Wish ever again if you suffer this stress.

**RU · Желание**

Желание — могущественнейшее заклинание, которое способен сотворить смертный. Просто произнеся слова вслух, вы можете изменить саму реальность.

Основное применение этого заклинания — воспроизвести любое другое заклинание 8-го уровня или ниже. При таком применении вам не требуется выполнять никакие требования для сотворения воспроизводимого заклинания, включая дорогостоящие компоненты. Заклинание просто вступает в действие.

Вместо этого вы можете создать один из следующих эффектов по своему выбору.

Создание предмета. Вы создаёте один немагический предмет стоимостью до 25 000 зм. Ни один его размер не может превышать 300 футов. Он появляется на земле в незанятом пространстве, которое вы видите.

Мгновенное исцеление. Вы и до двадцати существ, которых вы видите, восстанавливаете все хиты. Вы также прекращаете действующие на них эффекты, перечисленные в заклинании «Высшее восстановление» (Greater Restoration).

Сопротивление. До десяти существ, которых вы видите, получают постоянное сопротивление одному выбранному вами типу урона.

Иммунитет к заклинанию. До десяти существ, которых вы видите, получают иммунитет к одному заклинанию или другому магическому эффекту на 8 часов.

Мгновенное обучение. Вы заменяете одну из своих черт другой, требованиям которой соответствуете. Вы теряете все преимущества прежней черты и получаете преимущества новой. Нельзя заменить черту, которая служит требованием для любой другой вашей черты или особенности.

Переброс. Вы отменяете одно недавнее событие, заставляя перебросить любой бросок кости, сделанный за последний раунд, включая ваш последний ход. Реальность меняется в соответствии с новым результатом. Например, Желание может отменить проваленный спасбросок союзника или критическое попадание врага. Вы можете назначить переброс с преимуществом или помехой и выбираете, использовать новый или первоначальный результат.

Изменение реальности. Вы можете пожелать нечто, не входящее в перечисленные эффекты. Изложите желание Мастеру как можно точнее. Мастер вправе свободно решать, что произойдёт; чем масштабнее желание, тем выше вероятность, что что-то пойдёт не так. Заклинание может просто не сработать, желаемый эффект может осуществиться лишь частично, либо формулировка желания может привести к непредвиденным последствиям. Например, пожелав смерти злодея, вы можете оказаться в будущем, когда он уже умер, тем самым фактически выбыв из игры. Пожелав легендарный магический предмет или артефакт, вы можете мгновенно перенестись к его нынешнему владельцу. Если исполненное желание влияет на целое сообщество, регион или мир, оно, вероятно, привлечёт могущественных врагов. Если желание затрагивает бога, его божественные слуги могут немедленно вмешаться, чтобы помешать ему или побудить вас изменить формулировку. Попытка отменить саму мультивселенную проваливается.

Сотворение Желания для любого эффекта, кроме воспроизведения другого заклинания, вызывает стресс, который ослабляет вас. После такого стресса всякий раз, когда вы сотворяете заклинание до окончания продолжительного отдыха, вы получаете 1d10 некротического урона за каждый уровень этого заклинания. Этот урон невозможно уменьшить или предотвратить никаким способом. Кроме того, ваша Сила становится равна 3 на 2d4 дня. За каждый из этих дней, который вы проводите отдыхая и занимаясь лишь лёгкой деятельностью, оставшееся время восстановления сокращается на 2 дня. Наконец, пережив такой стресс, вы с вероятностью 33 процента навсегда теряете способность сотворять Желание.

**Структурированные поля v4** (описание показано выше; служебный `content` — в исходном аудите):

```json
{
  "schema_version": 1,
  "key": "wish",
  "name": "Wish",
  "spell_level": 9,
  "school": "conjuration",
  "range": {
    "text": "Self",
    "distance": null,
    "unit": "ft",
    "kind": "self"
  },
  "area": null,
  "casting_time": "Action",
  "duration": "Instantaneous",
  "concentration": false,
  "ritual": false,
  "components": [
    "V"
  ],
  "material": null,
  "classes": [
    "sorcerer",
    "wizard"
  ],
  "saving_throw": null,
  "attack_type": null,
  "damage": null,
  "higher_level": null,
  "mechanics_automated": false
}
```

Execution-профиль не поддержан: **всегда GM/manual** на этом этапе.

</details>

This work includes material from the System Reference Document 5.2.1 (SRD 5.2.1) by Wizards of the Coast LLC, available at [the official SRD page](https://www.dndbeyond.com/srd). The SRD 5.2.1 is licensed under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/legalcode).
