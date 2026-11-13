# CONTENT — совместимость Compendium с consumer-системами YTT

Проверено 12 ноября 2026. **Consumer-контракты реализованы и проверены на фикстурах.**
Live импорт и live `--apply` не выполнялись. B1–B7/C1–C15 не одобрены; реестр
`reviews` и `baseline_reviews` остаётся пустым. Существующие игровые строки и копии,
BG3, SRD 2014 и конфигурация основного runtime не менялись. Исходная библиотека
читается без изменений; параллельного каталога не создано.

## Готовность к пилоту

Сняты кодовые проблемы повторного маппинга Unified envelope, отсутствующих
consumer-гейтов, потери rarity и неполного происхождения независимых копий.
Подготовлена одна additive migration; она применялась **только в SQLite-тестах**.
Live MySQL по-прежнему имеет `compendium_copies.campaign_id NOT NULL`, без новых
`owner_user_id` и `item_definitions.content`. До активации схемы новые библиотечные
копии не готовы к live использованию. Прежние campaign-copy пути имеют fallback
для старой схемы; никаких автоматических миграций не добавлено.

Actual live diff: **1 create / 7 update / 0 skip / 7 conflict**, rejected=15.
Семь baseline-конфликтов по-прежнему ожидают адресного решения B, а не обходятся
новыми consumer-контрактами. Для будущего полного пакета остаётся предложение
1 create + 14 update с прежними ID. **Ни одна из 15 записей не стала доступной
для browse/copy/execute автоматически.**

Актуальные ID, хеши проекций v4, хеши профилей исполнения и статусы:
[CONTENT_CONSUMERS_LIVE_DIFF.json](CONTENT_CONSUMERS_LIVE_DIFF.json).
Полный отчёт before/after: `artifacts/content-consumers/live-audit.json`.

## Обнаруженные несовместимости и исправления

| Конфликт | Исправленный контракт |
| --- | --- |
| `CopyCompendiumEntry` повторно маппил item.raw_data как плоский API record | Для Unified все consumer-пути используют проверенную `normalized_data`. Полная исходная detail-запись остаётся в raw и snapshot; старые API-записи сохраняют прежний fallback-маппинг. |
| `SpellAudit` ожидал top-level поля API в envelope | Audit понимает обе формы raw, для Unified проверяет локальное review и использует нормализацию/consumer-проекцию. Pending/stale review даёт явную ошибку аудита; execute=false отражается как MANUAL. |
| Source review/gates не проверялись перед просмотром и копированием | `CompendiumContent` заново проверяет source/ruleset/версию, полный checksum и projection checksum. SQL предварительно исключает pending-записи; stale-проекции исключаются до пагинации, затем перед каждой мутацией проверяются снова под shared lock. Одного cached gates=true недостаточно. |
| Типы идентификаторов системных и личных предметов конфликтовали | Системные Entry сохраняют числовые ID, LibraryItem — UUID. Новый выбор системного предмета создаёт обычный личный LibraryItem; Equipment получает его через существующий `libraryItemId`, без подмены ID и второго каталога. |
| Bag of Holding копировался как common | Item copy использует нормализованную rarity: Uncommon сохраняется как `uncommon`. Внепространственные/контейнерные эффекты остаются справкой GM. |
| Ограничения 80/1000 и 60/800 обрезали рабочие тексты | Короткие редакторские поля сохранены; полный EN/RU источник и исходная запись сохраняются в независимом receipt. Полный справочный текст и RU показываются в карточке копии. Отсутствующая проза обычного equipment не выдумана; базовые факты показываются отдельно. |
| Копии Spell Library не имели receipt без Campaign | CompendiumCopy получает nullable campaign и nullable owner_user_id. Для новой формы создаются owner-scoped receipts как для личных шаблонов, так и для Character/NPC Ability; snapshot содержит raw+normalized, source_reference — ruleset/revision/export/checksum/gates/attribution. |
| execute=false не препятствовал существующим рецептам и item-профилям | Без разрешения исполнения spell-копия имеет MANUAL, result=nothing, без attack/save/damage/scaling/effects; item-копия не получает боевой/use/armor/ammunition профиль и слоты экипировки. Сведения источника сохраняются и явно помечены как требующие решения GM. |
| Редактирование могло незаметно превратить справочную копию в автоматическую | Существующее content-ограничение сохраняется при правке private spell/item и Character Ability; валидация и SpellCasting проверяют границу исполнения. Снятие metadata/смена coverage в запросе не одобряют эффекты. |
| Старый API sync мог заменить Unified-запись обратно на неявно исполняемую v1 | `CompendiumSync` отказывается заменять controlled Unified Entry, включая force. Пакетная транзакция откатывается; обновлять такие записи нужно через reviewed Unified manifest. Прежние legacy API-записи продолжают синхронизироваться как раньше. |

Изменения сосредоточены в одном consumer-boundary `CompendiumContent` и небольшом
`CompendiumExecution`, который хеширует **существующие** YTT-профили. Новый rules
engine, интерпретация прозы, отдельные Item/Spell-системы или generic manager не добавлены.

## Browse, copy и execute — отдельные решения

Локальное одобрение содержимого по-прежнему привязано к полному checksum записи,
двум языкам и проекции. Для автоматизации добавлено отдельное явное разрешение
`execute=true` с **точным `execution_checksum` существующего профиля YTT**.
В fingerprint входят ruleset/revision существующего рецепта, type/key и фактически
поддерживаемый профиль/coverage. Изменение рецепта или несовпадение fingerprint
не разрешает новым копиям автоматическое исполнение.

Команда подтверждения теперь требует одновременно `--execute`, `--copy` и
`--execution-checksum` для такого отдельного решения. По умолчанию execute=false.
Она отклоняет неподдерживаемые MANUAL профили. **Ни одна команда подтверждения
для настоящего пилота не запускалась.** Положительные approvals в тестах относятся
к другому synthetic package без реальных исходных checksum/иконок/evidence и
существуют только в SQLite `:memory:`/случайной fixture-директории.

| Выбор | Результат |
| --- | --- |
| Нет browse или checksum/projection изменён | Запись не выдаётся в каталоге и не копируется. |
| Browse разрешён, copy нет | Справочная карточка доступна, копирование отключено и на сервере, и в UI. |
| Copy разрешён, execute нет | Независимая справочная копия с полным происхождением; автоматические профили не создаются. GM может явно включить существующее ручное разрешение заклинания. |
| Copy + отдельный корректный execute-профиль | Копируется только уже существующий ограниченный профиль YTT; все оставшиеся условия отмечены как GM-required. |
| Запись уже скопирована, каталог потом изменился | Рабочие поля и provenance копии остаются прежними. Runtime не перечитывает изменяемый Entry для восстановления её механик. |

Сохранённая копия — редактируемый снимок пользователя, а checksum в её происхождении
обозначает исходную версию. Изменение копии не является одобрением или обновлением
системного Entry. Прежние записи/копии без нового content-блока работают по прежнему
контракту; задача не переписывает и не отключает их задним числом.

## Покрытие первых 15 записей

Доступно **10 ограниченных профилей**, требующих отдельного execution-разрешения:

- Longsword: существующие атака, типизированный урон и Versatile; mastery остаётся
  сведением/решением GM, нового автоматического Sap не добавлено.
- Chain Mail, Leather Armor, Shield equipment: существующие AC/Dex/shield bonus и
  слоты. Training и не реализованные условия не симулируются новым импортом.
- Arrows: существующая идентичность/расход боеприпасов. Цена/вес пачки и 20 стрел
  остаются сведениями источника, количество выдачи задаётся явно.
- Potion of Healing: существующая Bonus Action/use Ability 2d4+2, расход экземпляра.
- Cure Wounds, Healing Word: существующие лечение, modifier, слоты и scaling 2024.
- Fireball: существующий PARTIAL профиль 8d6 fire, Dex/half, 2D область, scaling;
  пожары, cover/объём и остальные ограничения — GM.
- Shield spell: существующий PARTIAL +5 AC и длительность; полноценный перехват
  reaction и иммунитет Magic Missile импортом не изобретены.

**Всегда GM/manual в этом этапе:** Acid, Bag of Holding, Detect Magic,
Magic Missile и Wish. Wish не получает primary damage=1d10; стресс остаётся прозой.
Распределение missile-зарядов, ауры, внепространственные эффекты и другие
неподдерживаемые правила не превращены в автоматизацию наличием чисел в JSON.

Версия адаптера повышена **v3 → v4**: в проекцию добавлен execution-контракт.
Хеши всех 15 проекций изменились. Все 15 source checksum, шесть исправлений
CONTENT-03 и их content checksum сохранены. Новое одобрение требуется по v4;
старые предложения/хеши v3 из CONTENT-04 не являются актуальными C-разрешениями.
Имена решений B1–B7/C1–C15 сохраняются, их соответствие записям не менялось.

## UI, Character/NPC, Equipment и Spellbook

В существующую Item Library добавлен сворачиваемый браузер Compendium с поиском,
пагинацией, инспектором и «Копировать в мою коллекцию». После копирования выдача,
стеки, экипировка и применение идут через прежние команды InventoryActions.
Числовой source ID не используется как UUID личного шаблона.

Spell Library/Spellbook получают server-checked copyable и проекцию с фактическим
FULL/PARTIAL/MANUAL. Запрет копирования применяется также к drag/quick-add и
«копировать/изменить». В карточках показываются пометки GM и источник снимка.

Character/NPC используют прежние разграничения: независимый NPC доступен в своём
существующем библиотечном пути, назначенный кампании NPC — через campaign Compendium/
Equipment/abilities. Широкие новые разрешения к чужим NPC/библиотекам не добавлялись.
В тестах campaign NPC реально получил и применил новую spell/item-проекцию.

Аддитивная migration `2026_11_12_170000_add_compendium_copy_contracts` не переносит
существующие записи и не меняет их payload. Down отказывается удалять provenance
версионных копий/receipts ради возврата старого NOT NULL/удаления новых колонок.
Обхода этого ограничения или destructive live rollback не добавлено.

## Проверки и доказательства

Все PHP-проверки выполнены native PHP Open Server на **SQLite `:memory:`**.
Миграции/фикстуры не направлялись в live MySQL.

- Расширенный прогон Compendium/импорт/Library/Character/NPC/Equipment/Spellcasting/
  Item gameplay/Combat: **161 tests, 2585 assertions — PASS**.
- После финальных защит схемы, shared-lock, формы provenance, API refresh/force
  и explicit execution-confirmation: повторный целевой прогон
  **28 tests, 369 assertions — PASS**. Это повторная проверка пересекающегося набора,
  а не дополнительные 28 уникальных сценариев.
- React SSR: **4 tests — PASS**, включая настоящие ItemCard/SpellDetails, Uncommon,
  RU/полный текст, MANUAL/GM labels и экранирование HTML.
- TypeScript + Vite build — PASS; ESLint изменённых UI-файлов — PASS; Pint — PASS.
  Vite сообщает предупреждения о `/assets/player/frames/divider.png` и размере
  одного bundle; отдельной доработки этих ресурсов задача не выполняла.
- Проверены все 15 envelope-форм; pending/stale review; receipt в приватной
  библиотеке без Campaign; идемпотентная выдача/копирование; неизменность снимков
  при изменении каталога; отдельные PC/NPC definitions; надевание/снятие Chain Mail;
  реальное лечение Cure Wounds/зельем, расход ячейки и одного экземпляра, retry без
  второго расхода; атака Longsword и typed damage; запрет автоматизации Wish;
  устаревший execution checksum; запрет снятия execute-границы редактированием;
  отказ опасного schema rollback. Существующие import rollback/idempotency и
  permission/secret-filtering регрессии также прошли.

Форма нового provenance в Ability ограничена разрешёнными полями, типами, размерами
текста и списками. Произвольный вложенный JSON не становится React-описанием или
командой движка. Поздний API refresh/force также проверен на отказ от стирания
checksum reviews и provenance.

Read-only MySQL audit выполнил **46 SELECT-запросов**, before/after fingerprint
выбранных записей и связанных игровых снимков совпал со снимком CONTENT-04:
275 CompendiumCopy, 7 ItemDefinition, 14 InventoryItem и 4 текущие Ability не изменены.
Отдельная SELECT-проверка подтвердила отсутствие live migration и отказ всех
трёх consumer-прав у 15 неподтверждённых предложений, построенных в памяти без
создания Entry. `database_writes=0`.

Полный интерактивный browser smoke изолированного fixture-сервера **не подтверждён**:
браузерный инструмент не получил локальный порт 8099 за 30/45 секунд, хотя native
HTTP-проверка вернула 200. Код страницы не был загружен этим инструментом.
Никаких live QA-команд/мутаций не выполнялось; синтетические browser contexts
закрыты, отдельный Vite без Laravel plugin остановлен, public/hot не создавался.
Поэтому ручная визуальная оценка не объявляется пройденной; доступные доказательства
отображения — SSR реальных карточек, API-тесты и успешная production-сборка.

Воспроизведение автоматических проверок:

```powershell
php vendor/phpunit/phpunit/phpunit --filter 'CompendiumConsumersTest|UnifiedCompendiumBaselineTest|UnifiedCompendiumImportTest|UnifiedCompendiumDryRunTest|CompendiumTest|SpellLibraryTest|ItemLibraryTest|SpellcastingTest|ItemsLootGameplayTest|PlayerInventoryTest|CharacterLibraryTest|NPCLibraryTest|CharacterGameplayTest|CombatGameplayTest'
npm exec -- vitest run resources/js/compendium/ContentReference.test.tsx
npm run build
```

## Что ещё блокирует реальный импорт

1. **Активация consumer-схемы** обычной migration при согласованном развёртывании.
   На live БД задача её не выполняла. При этом нельзя обходить защиту сохранённых
   копий при rollback. Отдельный восстановимый UI smoke полезен перед активацией.
2. **B1–B7** — адресное принятие семи legacy baseline с теми же ID/digest из live
   diff; **C1–C15** — человеческое одобрение содержимого, языков и проекции v4.
   Сейчас всех этих одобрений ноль. Непринятые существующие записи сохраняются.
3. **Только если нужна автоматизация:** отдельный execution-профиль для каждого
   выбранного поддерживаемого record. C-разрешение не включает его автоматически.
   Для справочного импорта/копирования допустимо execute=false; MANUAL-пятёрка
   не получает автоматизацию вообще.
4. **CONTENT-05:** новый live diff подтверждённого manifest, отдельное разрешение
   на фактический импорт и явное включение writer. CLI `--apply` и прямой live
   writer остаются закрытыми. Их включение не подменено исправлением consumers.
5. Изображения не зарегистрированы и не копировались. Пока используется fallback;
   лицензирование чужого artwork остаётся отдельным решением.
