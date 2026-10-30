> Historical validation used the former container runtime. Current local commands: [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md); data migration: [LOCAL_MIGRATION.md](LOCAL_MIGRATION.md).

# Task 30 — игровой вертикальный срез

Дата: 2026-10-30. Локальный Docker `ytt-test`, Chromium, три независимых
контекста: GM user 1, Player user 2, Player user 8. Существующие campaign 5,
scene 5, game session 1 переиспользованы. Новые аккаунты/кампании/сцены/сессии
не создавались. Это локальная приёмка, без публикации и изменения host-БД.

## Постоянный сценарий

Выбрана единственная доступная карта `Flinns Townhouse [23x27] (DnDavid).jpg`:
двор для стрельбы и AoE, дом с комнатами и проходами для ближних взаимодействий.
Исходник из `B:/DnD/Reference and Resource/battlemap` скопирован без изменений
в `resources/qa/flinns-townhouse.jpg`, затем загружен через настоящий GM file
input. Приватный Asset 10 используется картой сцены; внешний reference-каталог
во время игры не нужен. Credit DnDavid сохранён в изображении.

1134×1331 px, карта размещена в (0,0), без растяжения. Сетка 49.3 px, offset 0,
5 ft/клетка, snap включён; размер токенов 49.3 px. Отклонение от 23×27 клеток
меньше 0.2 px. Стартовый fit показывает всю карту. Герои и основной сундук
подняты выше нижнего HUD; для нижних комнат доступен обычный pan/zoom.
Нарисованные на JPG стены не являются автоматическими коллайдерами или LOS.

| Участник | Подготовка |
| --- | --- |
| Керн, Character 5 / Player 2 | HP 48, STR16 DEX14 CON16, PB3; Longsword, Shortbow, Shield, Chain Mail, 20 стрел, 3 зелья. Меч/щит/доспех надеты, AC18. Perception, Investigation, Athletics, Arcana с владением. |
| Лира, Character 6 / Player 8 | HP40, CHA18, атака заклинанием +7, DC15, AC12. Ячейки I4/II3/III2/IV1; Fire Bolt, Poison Spray, Inflict Wounds, Fireball, Cure Wounds, Healing Word, Bless, Shield of Faith, Shield, Identify; 2 свитка Fire Bolt, 3 зелья, кинжал. |
| Гоблины — налётчик/лучник | Две отдельные кампанийные копии Goblin Warrior, AC15 HP10; Scimitar/Shortbow +4. |
| Скелет | Копия SRD, AC14 HP13, атаки +5; иммунитет poison/poisoned, уязвимость bludgeoning. |
| Магмин | Копия SRD, AC14 HP13, Touch +4; иммунитет fire. |
| Ивар | Нейтральный хозяин, HP8, отдельный токен. |

Атаки NPC в рецепте — проверенные базовые компоненты структурированных SRD
actions. Дополнительный условный урон гоблинов, Nimble Escape, горение и Death
Burst магмина остаются у GM; парсера произвольного текста и AI не добавлено.

Сундук Флинна: меч, Leather Armor, три зелья, 20 стрел, свиток. Складской ящик:
зелье. Налётчик: кинжал и зелье, доступны как corpse loot после 0 HP.
Реальные Props: сундук, дверь, стол со следами, складской ящик, поваленный стол.
Проверки: Perception DC12 у следов, Investigation DC13 у двери, Investigation
DC10 у припасов. DC скрыты от Players. У каждого героя подготовлена панель
действий с сохранением существующей модели 32 слотов.

## Сброс и восстановление

Текущий native runtime: PHP использует исходники напрямую; после изменения frontend собрать assets:

```powershell
npm run build
php artisan qa:townhouse
```

Первый осознанный перевод старого полигона: тот же вызов с `--install`.
Обычный reset без manifest откажет, ничего не меняя. Команда доступна только
в local/testing. Это рецепт **данного подготовленного стенда**, требует
существующих трёх участников, campaign/scene/Characters и локального SRD,
а также прежних campaign prop assets 6/7/8. Он не создаёт тестовые аккаунты.

Рецепт `app/QA/TownhouseScenario.php` использует Character/Token/Scene/Prop/
Inventory/Loot/Combat/interaction services, Compendium copies и обычные hotbar/
spellcasting validators. Private manifest `qa/townhouse-5-5.json` сохраняет
ID принадлежащих рецепту определений, NPC и Props. Карта повторно не импортируется,
если Asset и приватный файл существуют. Мечи, броня и заклинания — campaign copies,
не ссылки на изменяемые library entries.

Reset завершает текущий бой, снимает эффекты/состояния, восстанавливает позиции,
HP/ячейки/инвентарь/экипировку/Action Deck, пополняет и закрывает контейнеры,
создаёт подготовленный бой с инициативой. История завершённых боёв и прежние
медиаматериалы сохраняются. Данные вне этого сценария и Docker volumes не
удаляются. Перед первым изменением сохранён scoped rollback в игнорируемой
папке `artifacts/task30-vertical-slice`; он не является механизмом reset.
После reset перезагрузить открытые GM/Player страницы. Локальные предпочтения
камеры/окон браузера не являются серверным состоянием сценария.

GM: <http://localhost:8090/campaigns/5/scenes/5>.
Players: <http://localhost:8090/campaigns/5/play>.
Пароли остаются только в прежнем игнорируемом private accounts-файле.

## Найдено и исправлено

| Приоритет | Реальное воспроизведение | Исправление |
| --- | --- | --- |
| P1 BLOCKER | GM выбирает Compendium-derived NPC в бою: атак нет, поскольку у linked Token нет собственной копии abilities. | CombatActorControls берёт abilities из Character и передаёт characterId; standalone NPC продолжают использовать actorTokenId. Shortbow гоблина выполнен через GM UI: бросок 18, урон 3. |
| P1 HIGH FRICTION | Player перетаскивает токен дальше остатка movement: сервер отклоняет, но очередь остаётся failed и блокирует все дальнейшие действия. | После терминального 422 movement сверяет snapshot, показывает причину и освобождает очередь. Неподтверждённые сетевые ошибки сохраняют прежний retry с тем же mutation ID. Повторное UI-воспроизведение: инвентарь доступен сразу после отказа. |
| P1 BLOCKER | Кнопка Player «Встать» видна при Prone, но SceneStore молча отклоняет её общим GM-only guard. | Разрешён только stand-up для собственного movable token. Изменение HP/состояний остаётся GM-only, серверная авторизация и стоимость движения сохранены. |
| P1 BLOCKER | Перетаскивание новых weapons/consumables/scrolls из Inventory в Deck отклоняется: клиент проверяет только legacy use_ability_id. Предустановленные слоты и drag способностей работают, маскируя дефект. | Deck принимает современный серверный item.action.ability, включая временно недоступное/неэкипированное оружие, и legacy actions. Пустые и неиспользуемые предметы не принимаются. |

## Прогон и доказательства

Все обычные действия Players выполняются кликами/drag/клавиатурой в приложении.
Наблюдение сетевых ответов используется для проверки результата, не подменяет
действия игрока. Для испытания lost-response исходный UI-запрос зелья один раз
пропущен на сервер, затем его ответ оборван. Повтор сделан кнопкой приложения.

Подтверждены: проверка Perception (+5 с provenance), окна Character/Inventory,
добыча двумя клиентами, Take/Take All/drag, гонка за единственный меч (200/409,
один экземпляр), перемещение предмета в рюкзаке; смена
оружия/щита и AC18→16→18; старт боя через GM, движение 5 ft + melee attack,
критическое попадание с победой над налётчиком, corpse loot и экипировка кинжала.
Передача зелья Player A→B и drop меча B→мир→подбор A прошли через Player UI.

Fire Bolt использовал CHA+4/PB+3 против AC; промах не списал ячейку.
Bless списал I, показал concentration. В журнале реального боя CON saves
9/9/7 против DC10 завершили эффект, 10 против DC10 сохранил его. Shield of Faith
II заменил Bless. Перезапуск серверных контейнеров и перезагрузка Player
сохранили active combat, HP33, I0/II2/III2/IV1 и Shield of Faith.
Potion после lost response и UI retry вернул тот же execution ID; после reload
HP39 и уменьшенное количество, без повторного эффекта.

Prone/Poisoned дали подтверждённую помеху: Shortbow бросил 6 и 17, выбрал 6,
итого 11 против AC15; стрела потрачена и при промахе. Restrained показал movement
0; состояния сохранились после reload. «Встать» сняло Prone за 15 ft. Poisoned
с длительностью до конца хода цели исчез при переходе хода. Далёкая цель для
Longsword показала `36.4 / 5 ft · Вне дальности / сцены`, без команды атаки.

Fireball IV: 9d6 = 31, три цели; успешный save → 15, провал → 31, fire immunity
магмина → 0. Свиток Fire Bolt попал: 18+5=23, собственный SRD scroll modifier,
урон fire по магмину 0; свиток списан. Проверка высокого круга не требовалась
для этого разрешённого заговорного свитка. Cure Wounds II восстановил 10 HP
повреждённому Керну. Healing Word перетащен из Spellbook в свободный слот Deck.

Подготовка GM через UI: импорт файла карты, поиск Mage Hand в Compendium,
кампанийная копия для Лиры, редактирование/просмотр правил и магии, подтверждение
одной ожидающей ручной части, наполнение сундука существующим предметом, удаление
только сценического токена магмина и повторное размещение того же Character,
добавление в бой и установка инициативы. Персонаж не дублировался. Полный
первоначальный набор создан рецептом через normal services; пустую новую кампанию
ради этого аудита не создавали согласно постоянному fixture-контракту.

## Multiplayer, reconnect и секреты

Проверены реальные окна и HUD обоих Players и GM; HP/состояния/ход/позиции
согласованы в пределах прав. NPC HP, инвентарь другого игрока и его слоты не
объявляются публичными данными. Reload с потраченным Action и 5 ft движения
восстановил именно эти расходы, а не новый ход. Reload с тремя состояниями
вернул Poisoned/Prone/Restrained. Отдельно проверен серверный rebuild с эффектом
концентрации и уменьшенными spell slots. Потерянный ответ consumable не создал
второго execution, лечения или списания.

GM временно скрыл магмина; после настоящего Player reload его нет ни в сцене,
ни в DTO. Player snapshots содержат только собственного Character, не содержат
GM notes, private NPC abilities/combat profile или secret DC/result configuration.
Доступная проверка содержит лишь id/icon/label/check enabled/label/stat_key.
Закрытые контейнеры в исходных snapshots имеют summary без состава. Скрытый
NPC снова показан через GM UI; правила авторизации не ослаблялись.

## Производительность

Измерение на локальном Windows Docker Desktop, headless Chrome 156,
1600×1100, reduced motion, три отдельных контекста. Нативный JPG, 7 токенов,
5 Props, реальный бой, dice, AoE и RPG окна. `performance.json` содержит
наблюдения Performance API, не внутреннее состояние renderer.

- После бросков/закрытия окон по одному canvas в каждом клиенте. Явного
  накопления render loops и realtime storm не замечено.
- Последние 2000 rAF-интервалов: median ≈8.3 ms, p95 ≈8.4 ms во всех трёх
  контекстах. Это headless scheduling, не аппаратный FPS-тест реальных устройств.
- JS heap в точке замера: GM 23.9 MiB, Players по 21.6 MiB; 1–2 long tasks
  за жизнь последних страниц, максимум 55–71 ms. Reload обнуляет это наблюдение;
  многочасовое отсутствие утечки этим не доказано.
- 22 доступных Resource Timing samples для игровых API-путей: median 755 ms,
  p95 1279 ms, max 1435 ms. В выборке есть чтения контейнеров и команды; это
  end-to-end browser timing, не чистое время SQL и не отдельный POST-only SLA.
  Околосекундный отклик заметен в цепочках действий GM. Сравнения с предыдущей
  картой на идентичной нагрузке нет; регрессию не объявляем и микрооптимизацию
  без профиля не добавляем.

## P0 BLOCKERS

В проверенных сценариях оставшихся P0 не обнаружено. Четыре найденных P1
исправлены, покрыты focused regression tests и перепроверены в браузере.

## P1 NEXT — нагрузка GM и подготовка

| Проблема | Влияние за столом | Следующая работа |
| --- | --- | --- |
| Наполнение NPC и спецэффектов требует чтения SRD, проверки базовых атак и отдельного редактирования способностей. Copy monster даёт статистику, а не готовую автоматизацию всех traits/actions. | Рецепт делает этот конкретный набор готовым, но не устраняет трудоёмкость подготовки нового encounter. | GM Session/Authoring UX: явная проверенная подготовка NPC без internal IDs, с честной границей автоматизации. |
| Ручные spell resolutions находятся в «Добавить → Персонажи → Настроить → Сотворение», очередь содержит историю разных encounters. | Во время боя GM переключает несколько экранов; старые pending мешают отличать актуальное решение. | Та же задача: контекстная очередь текущей сцены/боя и быстрый переход к источнику. |
| Передачу хода делает GM; Player не имеет отдельного безопасного запроса «закончил ход». | GM следит за завершением каждого игрока и регулярно нажимает Next. | Та же задача: ясный handoff и безопасные быстрые действия текущего участника. |

Это ограничения текущего workflow, не скрытые автоматические разрешения правил.
Обычные Player-потоки инвентаря, атак, магии и добычи в прогоне не требовали
ручного редактирования БД или действий GM от имени игрока.

## P2 POLISH

- Журнал боя использует технические event keys и JSON details; для нескольких
  saves/concentration трудно быстро прочесть итог. Нужны человеческие summary
  с именами целей, итогом save и применённым уроном.
- Большое число spell icons выглядит одинаково; справочные причины автоматизации
  на английском, а остальная оболочка русская. Результат показывает общий dice
  damage рядом с фактически применённым уроном по целям: полезно яснее назвать
  общий бросок базовым уроном.
- Панель GM повторяет бюджет участника двумя рядами. Крупный Player HUD требует
  pan для нижних комнат; в рецепте ключевые стартовые объекты вынесены выше HUD.
- Игровые API-цепочки стоит профилировать вместе с UX, особенно последовательные
  refresh после изменения экипировки/заклинаний. Сейчас все проверки прошли,
  но локальный median ~0.76 s не является целью отзывчивости.

## DEFERRED SYSTEMS

Автоматическое разрешение всех monster traits/условного урона, Death Burst и
возгорания, полная экономика действий классов, rest engine, сложные реакции,
summoning/teleportation, dynamic lighting/LOS/collision. Они не добавлялись ради
этого QA. Проверка ограничена Chromium desktop; Safari/Firefox/физические
телефоны, WAN/TLS и многочасовой человеческий сеанс не заявлены.

## Регрессии и проверки

- `CombatActorControls.test.tsx`: linked NPC получает Character abilities при
  пустом token abilities.
- `ScenePersistence.test.ts`: rules-rejected move откатывается и освобождает
  очередь; последующая команда имеет новый UUID. Existing ambiguous retry test
  сохраняет исходный UUID.
- `Combat.test.ts`: Player stand-up разрешён для своего movable token; чужой
  stand-up, HP и condition removal не отправляются. Stand при speed0 возвращает
  объяснение и не блокирует очередь.
- `TownhouseScenarioTest.php`: первый reset требует explicit install и не меняет
  сцену; production запрещён даже с install.
- `actionDeck.test.ts`: modern item action без legacy ID можно привязать даже
  до экипировки; quantity0 и предметы без действия отклоняются, legacy сохранён.
- Полный Docker helper: **236 PHP tests / 3646 assertions**. После последнего
  исправления отдельно повторены весь frontend suite — **194 tests / 42 files**
  — и два PHP guard tests сценария.
  TypeScript/Vite build, ESLint, Pint и `git diff --check`
  прошли. `tabletop:doctor`: все проверки OK.

## Финальная повторная петля и оставленное состояние

После четвёртого исправления выполнен новый reset и полностью повторён основной
цикл через UI: два Players → Perception → общий сундук → старт GM combat →
движение/меч → Fire Bolt → лук/стрела → Fireball со saves и предупреждением
о союзнике → Bless → Prone/«Встать» → potion → победа/corpse loot → надетый
кинжал → transfer → drag современного кинжала на Deck → drop → подбор другим
Player → Cure Wounds с сохранённым Bless → продолжение боя с Poisoned → reload
обоих Players и GM. Это повторный проход после всех изменений, а не только
отдельные component tests.

Перед последним reset: Керн HP32, (221.85,813.45), Action spent, movement5/30,
Poisoned; Лира HP40, I2/4, III1/2 и Bless. Свежие snapshots всех трёх браузеров
сопоставлены с настоящими HUD/окнами: HP и позиции согласованы, приватность
сохранена. Современный кинжал действительно получил серверную Deck binding,
после drop и reload недоступная привязка превратилась в пустой слот 11;
остальные индексы, в том числе Fire Bolt в слоте 1, не сдвинулись.

После успешного прохода рецепт запущен ещё раз: оставлена чистая постоянная
подготовка для следующей игры, а не потраченный бой и не прежний маяк.
Campaign/scene/session и аккаунты сохранены; новые campaigns/scenes/users не
созданы. Инвентари, HP, ячейки, NPC, позиции и закрытая добыча восстановлены.
Сохранены история законченных combat и старые медиа/handout/Cue.
Read-only проверка после reset: 3 users, 1 campaign, 1 scene, 1 game session,
6 Characters, 7 токенов, 5 Props; один preparing combat с 6 участниками,
0 состояний/активных spell effects. HP48/40, AC18/12, три зелья каждому,
20 стрел Керну, два свитка Лире, полные I4/II3/III2/IV1. Все три контейнера
закрыты и наполнены. Приватный JPG совпал с проектным исходником по SHA-256.

Результат: **локальный Chromium vertical slice проходит**. GM может провести
этот небольшой encounter, а Players выполняют обычные действия в Player View.
Следующая единая задача: **GM Session UX** — контекст текущего участника,
читаемый итог боя и доступная из боя очередь ручных разрешений, с сокращением
повторных переходов в подготовку. Новый rules subsystem для этого не нужен.

## Снимки и артефакты

Локальные доказательства находятся в игнорируемой папке
`artifacts/task30-vertical-slice/`. Она не содержит добавленных паролей. Scoped
rollback-файл остаётся приватным; его не следует публиковать.

| Состояние на новой карте | Снимок |
| --- | --- |
| Чистый обзор GM после последнего reset | [clean-ready-gm.png](../artifacts/task30-vertical-slice/clean-ready-gm.png) |
| Исследование / проверка | [final-exploration.png](../artifacts/task30-vertical-slice/final-exploration.png) |
| Общий сундук | [loot-shared.png](../artifacts/task30-vertical-slice/loot-shared.png) |
| Ближняя атака | [final-martial.png](../artifacts/task30-vertical-slice/final-martial.png) |
| Стрельба / дальность | [final-ranged.png](../artifacts/task30-vertical-slice/final-ranged.png), [range-rejection.png](../artifacts/task30-vertical-slice/range-rejection.png) |
| Spell attack | [final-spell-attack.png](../artifacts/task30-vertical-slice/final-spell-attack.png) |
| AoE preview / итог | [aoe-template.png](../artifacts/task30-vertical-slice/aoe-template.png), [aoe-results.png](../artifacts/task30-vertical-slice/aoe-results.png) |
| Концентрация / замена | [concentration-hud.png](../artifacts/task30-vertical-slice/concentration-hud.png), [concentration-replacement.png](../artifacts/task30-vertical-slice/concentration-replacement.png) |
| Три состояния | [conditions.png](../artifacts/task30-vertical-slice/conditions.png) |
| Свиток | [scroll-cast.png](../artifacts/task30-vertical-slice/scroll-cast.png) |
| Труп / новое снаряжение | [final-corpse.png](../artifacts/task30-vertical-slice/final-corpse.png), [final-new-equipment.png](../artifacts/task30-vertical-slice/final-new-equipment.png) |
| GM combat / Players после reconnect | [final-sync-gm.png](../artifacts/task30-vertical-slice/final-sync-gm.png), [final-reconnect-a.png](../artifacts/task30-vertical-slice/final-reconnect-a.png), [final-reconnect-b.png](../artifacts/task30-vertical-slice/final-reconnect-b.png) |
| Ручная часть / подготовка сундука | [gm-manual-resolution.png](../artifacts/task30-vertical-slice/gm-manual-resolution.png), [gm-chest-authoring.png](../artifacts/task30-vertical-slice/gm-chest-authoring.png) |

[browser-report.json](../artifacts/task30-vertical-slice/browser-report.json) —
шаги финального прохода, состояние перед reset и JS errors;
[performance.json](../artifacts/task30-vertical-slice/performance.json) — измерения.
[clean-state.json](../artifacts/task30-vertical-slice/clean-state.json) — несекретная
проверка оставленной подготовки.
`repeat-core.cjs` — UI-only replay в уже авторизованных независимых контекстах;
не заменяет постоянный recipe и не содержит учётных данных.

## Task 31 — GM Combat Console

Продолжение того же сценария: [архитектура, приёмка и границы GM-пульта](GM_COMBAT_CONSOLE.md).
`qa:townhouse` теперь также закрывает старые pending manual resolutions данного
сценария как `dismissed_by_qa_reset`, сохраняя execution receipts и историю.
