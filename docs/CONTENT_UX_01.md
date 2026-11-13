# CONTENT-UX-01 — визуальный компендиум

Item Library и Spell Library используют существующие Compendium/Library API,
шаблоны GM и команды копирования. Отдельного каталога данных нет.

- Каталог предметов объединяет личные шаблоны и доступные системные записи.
  Фильтры: коллекция, категория, название; системная часть сохраняет пагинацию.
- Каталог заклинаний сохраняет поиск, круг, школу и пагинацию; добавлен фильтр
  «Все записи / Мои / Системные». Фильтрация коллекции выполняется сервером.
- Карточки показывают характеристики, полный справочный текст, происхождение,
  заявленную версию правил и фактическую поддержку механик. FULL/PARTIAL/MANUAL
  и ограничения исполнения не заменяются предположениями по описанию.
- Копирование доступно в шапке карточки, перед длинным описанием. Системная
  запись остаётся read-only; ответ существующей команды открывается как личная
  независимая копия, которую можно редактировать прежним редактором.
- Есть loading, empty/reset, retry, запрет недоступного копирования и нейтральная
  иконка для отсутствующего/недоступного изображения. На узких экранах просмотр
  получает фокус и имеет кнопку возврата в каталог.

Небольшие расширения существующих GET API: `type=items|weapons|armor` для
предметов, `origin=custom|system` для заклинаний. Источник предмета отдаётся
разрешёнными полями name/version/license/attribution. Авторизация, consumer gates,
хранение копий и игровые механики продолжают принадлежать прежним сервисам.

## Воспроизведение проверок

```powershell
php vendor/phpunit/phpunit/phpunit --filter 'CompendiumConsumersTest|SpellLibraryTest|ItemLibraryTest'
npm exec -- vitest run resources/js/compendium/ContentReference.test.tsx resources/js/compendium/Catalog.test.tsx resources/js/rpg/itemGameplay.test.tsx resources/js/gameplay/spellcasting.test.tsx
npm run test:content-ux
npm run build
```

Целевые PHP-тесты: 26; frontend unit/SSR: 22. Browser runner проверяет четыре
составных сценария: оба пути поиска/просмотра/копирования/редактирования/reload;
loading/empty/reset/fallback/retry/copy denial; клавиатуру, фокус и отсутствие
горизонтального переполнения при 1512, 900 и 390 px.

`test:content-ux` сначала запускает отдельный тест на SQLite `:memory:` и
экспортирует реальные API-проекции существующих синтетических SRD-фикстур.
Затем запускает временный Vite без Laravel plugin и headless Chrome через
существующий bundled Playwright runtime (тот же путь, что в других QA-скриптах).
Браузер использует настоящие компоненты и стили приложения; все `/api/` запросы
перехвачены и обслуживаются в памяти. Независимость сохранённых копий от изменений
каталога и права владельца дополнительно проверяются настоящими Laravel-командами
в SQLite. Browser-мутации сами по себе не являются проверкой live-сервера.

Отчёт и скриншоты: `artifacts/content-ux/`, в том числе `browser-report.json`,
`items-desktop.png`, `spells-desktop.png`, варианты `*-tablet.png` и `*-mobile.png`.
Все контексты и временный Vite закрываются по завершении; `public/hot` не создаётся.

При первоначальном fixture-прогоне основной `http://localhost:8090` был недоступен.
CONTENT-05, live migration/import и одобрение реальных записей не выполнялись.
Извлечённые BG3-иконки не добавлялись; используются существующие builtin-иконки
YTT, доступные через Asset Library изображения либо fallback.

## Повторная проверка в нативном приложении

По отдельному запросу пользователя запущены Open Server PHP 8.3 / MySQL,
Laravel `localhost:8090`, Reverb `8085`, worker и scheduler. Поскольку штатный
launcher выполняет `migrate --seed`, использована его временная игнорируемая
копия с исключённым шагом миграций и готовой production-сборкой. Штатный launcher
не изменён. Все четыре службы оставлены работающими.

Настоящий Chrome, без API mocks, существующие QA-аккаунты GM и обоих игроков,
отдельные browser contexts:

- Предметы: поиск Longsword, категория, источник, RPG-карточка, пустой запрос
  и сброс фильтров — PASS.
- Заклинания: поиск Fireball, круг/школа, PARTIAL-карточка — PASS.
- Существующая legacy spell-команда: создание личной копии, переименование,
  reload и неизменность системного Fireball — PASS.
- Оба игрока просматривают системный каталог, личную QA-копию GM не получают.
- На 390 px проверены карточка, фокус, возврат к поиску и отсутствие переполнения.
  React runtime errors: 0.

**Подтверждённый live-блокер:** копирование системного предмета возвращает 503
«Копирование из Compendium пока недоступно». В live-схеме нет
`compendium_copies.owner_user_id` и `item_definitions.content`. Ошибка откатывает
транзакцию; LibraryItem не сохраняется. Активация consumer-схемы не выполнялась.
Таким образом, полный item-copy сценарий на текущей live-схеме не пройден.

Временные spell-копии и только их command receipts удалены. До/после совпали
count + SHA-256 содержимого девяти таблиц: migrations, compendium_sources,
compendium_entries, compendium_copies, library_items, item_definitions,
inventory_items, characters, scenes. Миграций по-прежнему 53; каталог — 970 записей.
Фикстуры кампании/Scene 7 не менялись; сцена 5 не использовалась.

Реальные скриншоты и отчёты: `artifacts/content-ux-live/` —
`items-desktop.png`, `spells-desktop.png`, `spells-mobile.png`,
`spell-independent-copy.png`, `item-copy-schema-blocked.png`,
`player-spells.png`, `live-browser-report.json`, `restoration-report.json`.
