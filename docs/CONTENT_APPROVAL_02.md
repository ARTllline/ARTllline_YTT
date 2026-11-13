# CONTENT-APPROVAL-02 Решения владельца и план CONTENT-05

Проверено **12.11.2026, 22:02:26 +02:00**. Одобрения зафиксированы в файлах;
**импорт и миграции не выполнялись, live DB и runtime не изменены**.

Итог свежего live diff: **13 update / 0 create / 0 skip / 0 conflict / 0 rejected**.
`review_ready=true`, `transaction_writer_ready=true`, но `import_available=false`:
готовность одобрений не открывает live writer.

## Зафиксированные решения

Основание — явное решение владельца проекта в чате CONTENT-APPROVAL-02 по
[пакету CONTENT-APPROVAL-01](CONTENT_APPROVAL_01.md). Автор решения в receipts:
«Владелец проекта (решение в чате CONTENT-APPROVAL-02)»; агент только записал его.
Для каждого решения сохранены reviewer, evidence, время и точные хеши.

- **B1–B7 одобрены** только по `legacy-equipment-missing-null-ammunition-v1`,
  с отдельными `id`, `entry_id` и `baseline_digest`. Использован существующий
  контракт `manifest.baseline_reviews`; новой политики или обхода проверки нет.
- **C1–C7, C9–C14 одобрены** по EN/RU и проекции v4 со всеми условиями таблицы
  CONTENT-APPROVAL-01. Каждое C записано штатной `compendium:unified-confirm`
  в отдельный одноэлементный manifest, затем эти решения явно объединены.
- Для всех 13: **browse=true, copy=true, execute=false**. Отдельных разрешений
  исполнения и `execution_checksum` в approvals нет. Новые копии остаются
  справочными; существующие игровые экземпляры не переоформлялись.
- **C8 отложено:** Bag of Holding не создаётся. **C15 отложено:** Wish #337
  сохраняется, его RU/damage-проекция не обновляется. Их нет в выбранной пачке
  и нет среди C-подтверждений.

## Пачка пилотного импорта

Единственный кандидат CONTENT-05:
[srd-2024-approved-13.manifest.json](../resources/data/content/srd-2024-approved-13.manifest.json).
Содержит ровно **13 selection + 13 reviews + 7 baseline_reviews**.

| Решение | Запись | Entry ID | Ожидаемая операция и сохранённое условие |
| --- | --- | ---: | --- |
| B1 + C1 | Acid | 340 | update; эффект только в справке, без Ability из прозы |
| B2 + C2 | Arrows | 345 | update; 1 gp / 1 lb за пачку 20, колчан отдельно; inventory quantity не пересчитывать |
| B3 + C3 | Chain Mail | 374 | update; AC 16 как base, без новых training/Speed-правил |
| B4 + C4 | Leather Armor | 430 | update; AC 11+Dex, без потолка Dex и выдуманной прозы |
| B5 + C5 | Longsword | 436 | update; прежние ID/type/key; Sap только справка |
| B6 + C6 | Potion of Healing | 467 | update; RU «напоить», без автоматического расхода/лечения новых копий |
| B7 + C7 | Shield equipment | 486 | update; бонус AC +2, отдельно от spell Shield |
| C9 | Cure Wounds | 73 | update; формула 2024: 2d8+modifier, усиление +2d8/круг |
| C10 | Detect Magic | 82 | update; GM/manual, без автоматической ауры |
| C11 | Fireball | 126 | update; полный EN/RU с +1d6/круг, без повтора усиления и обещания полной симуляции |
| C12 | Healing Word | 161 | update; полный EN/RU с +2d4/круг, без повтора усиления |
| C13 | Magic Missile | 199 | update; +1 заряд/круг в EN/RU, распределение зарядов вручную |
| C14 | Shield spell | 275 | update; полный справочный текст, условия реакции и Magic Missile разрешает GM |

Все 13 обновлений сохраняют существующие Entry ID. Политика B не является
ещё семью обновлениями. Нет create/delete, выдачи предметов/способностей,
изменения сохранённых snapshots или регистрации artwork.

[Исходный manifest из 15 записей](../resources/data/content/srd-2024-pilot.manifest.json)
сохранён побайтно, его `reviews=[]` и `baseline_reviews=[]` не менялись.
Промежуточный
[baseline-reviewed.manifest.json](../resources/data/content/approvals/content-approval-02/baseline-reviewed.manifest.json)
содержит только семь B и исходные 15 selection: это этап фиксации baseline,
**не кандидат импорта**. Одноэлементные C-receipts лежат рядом с ним, от
[C01](../resources/data/content/approvals/content-approval-02/C01.manifest.json)
до [C14](../resources/data/content/approvals/content-approval-02/C14.manifest.json),
без C08/C15. Точные ссылки на все 13 есть в компактном diff.

## Проверка актуальности и сохранности

До фиксации решений проверены закреплённые SHA-256 исходного manifest и снимка v4
из CONTENT-APPROVAL-01. Затем существующий SELECT-аудит заново прочитал Unified
Library и live MySQL `ytt_local` на 127.0.0.1:3306. **Все 15 source checksum,
итоговых content checksum, projection checksum v4, entry ID/identity и baseline
совпали** с approval-снимком; отдельно совпали все семь B-digest.

Offline dry-run отдельной пачки валидировал источники, исправления и approvals.
Его `not_compared=13`, `review_ready=false` ожидаемы: offline не читает каталог.
Последующий штатный live dry-run подтвердил 13 update без конфликтов и отказов,
принятие семи legacy baseline и browse/copy без execute у всех записей.

Оба live-аудита запрещали любой SQL, кроме SELECT, **до выполнения запроса**:
46 SELECT в preflight и 54 SELECT в финальной проверке. Fingerprint связанных
Entry, receipts, definitions, inventory, Character.abilities, conditions и счётчика
assets совпал между preflight и итогом; сами пользовательские тексты в отчёты
проверки сохранности не выводились. Прямые связи пилота: 275 receipts,
7 definitions, 14 inventory-строк и 4 текущие Ability.

Дополнительно до/после live dry-run совпали полные fingerprints десяти таблиц:
compendium_sources, compendium_entries, compendium_copies, item_definitions,
inventory_items, characters, library_items, token_conditions, assets, migrations.
Всего в live сохранились 686 receipts, 14 definitions, 24 inventory-строки,
9 персонажей и **53 migration records**. Wish не изменён; Bag не создан.
Это проверка сохранности в ходе данной задачи; она не переутверждает
пользовательские изменения между историческими аудитами.

## Хеши и доказательства

- Выбранный manifest SHA-256:
  `f995208190268c9621f98ae498a733d7bd877dc7149a220a3f1c16f2eca5ade9`.
- Просмотренный live `plan_checksum`:
  `42a29e8da9929035d133abb335d6bc6b3beecbaa1d27390398659b29c999e4be`.
  Это хеш текущего плана, **не разрешение применить его позже без нового diff**.
- [Компактный проверенный diff и approvals](CONTENT_APPROVAL_02_LIVE_DIFF.json)
  содержит все 13 ID, полные source/content/projection checksum, B-digest,
  решения, гейты и fingerprints без содержимого пользовательских экземпляров.
- [Preflight](../artifacts/content-approval-02/preflight-live-audit.json),
  [сверка 15 наборов хешей](../artifacts/content-approval-02/pin-verification.json),
  [offline dry-run](../artifacts/content-approval-02/approved-offline-dry-run.json),
  [полный live diff](../artifacts/content-approval-02/approved-live-diff.json),
  [проверка сохранности и live-схемы](../artifacts/content-approval-02/approved-live-verification.json).
  Полные audit-артефакты локальные и игнорируются Git; компактный diff сохранён в docs.

## Оставшиеся блокеры CONTENT-05

1. **Live consumer-схема не активирована.** SELECT подтвердил прежний
   `compendium_copies.campaign_id NOT NULL`, отсутствие `owner_user_id` и
   `item_definitions.content`; migration
   `2026_11_12_170000_add_compendium_copy_contracts` не применена.
   Её SHA-256 прежний:
   `bad9678e9795aadd6dcef808abc34f1205906806df6937366e5bd2280cc5b77c`.
   Нужны отдельное разрешение и восстановимый шаг по [CONTENT-FIX-01](CONTENT_FIX_01.md).
2. **Фактический импорт не разрешён, writer закрыт.** Нужны отдельное решение
   CONTENT-05 на его включение и импорт именно выбранной пачки, свежий backup,
   затем новый live diff непосредственно перед применением. Старый plan checksum
   не переносить на изменившуюся БД/manifest. При изменении закреплённых B/C-хешей
   остановиться и получить новое одобрение затронутых записей.
3. После отдельно разрешённых активации схемы и импорта проверить сохранённые ID,
   копирование/reload, ownership и повтор без дублей; автоматизация должна остаться
   выключенной. Восстановимую QA проводить по проектному полигону.

B/C-одобрения для этой выборки **больше не блокер**. Отдельный execution-review
не требуется для справочной пачки с execute=false. В сыром dry-run список
`apply_blockers` статический и всё ещё перечисляет эти общие условия;
фактическая готовность approvals подтверждена `records.gates`,
`review_ready=true`, `transaction_writer_ready=true`. Это не меняет
`import_available=false`. Artwork не входит в пачку; используется neutral fallback.

Для последующего обновления плана без записи в БД использовать штатный dry-run
с новым путём отчёта:

```powershell
php artisan compendium:unified-dry-run B:/BG3-Assets-Work/Output/Unified-DnD-Library `
  --manifest=resources/data/content/srd-2024-approved-13.manifest.json `
  --report=artifacts/content-approval-02/live-diff-next.json --no-interaction
```

В этой задаче не вызывались apply, migrations, seed, игровые команды,
рестарты runtime или изменение execution-профилей.
