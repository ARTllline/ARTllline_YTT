# Task 14 — Visual Identity, Motion & Interaction Polish

Проверено 29 октября 2026 в локальном YTT. Изменения касаются presentation/input слоя; API, модели, SceneStore, persistence, realtime, Combat commands, Cue execution и Session data не изменены. Новых зависимостей нет.

## Visual Problems Identified

Baseline Task 13: карта занимала около 83% масштаба в desktop viewport из-за лишних вертикальных отступов; одинаковые щиты не помогали различать участников; панели имели близкий визуальный вес; текущий момент Session конкурировал со списком; Cue выглядел как набор полей. Не хватало отклика на удержание, выбор, drop и смену хода.

Три фактических прохода с просмотром снимков и взаимодействием:

1. `artifacts/task14-pass1-*.png`: graphite surfaces, новое кадрирование, токены, NOW/Combat spotlight, первый radial. Проверены открытия панелей и меню. Найдены технические подписи Cue и неверный danger accent у «Привязки».
2. `artifacts/task14-pass2-*.png` и `task14-pass2-interactions.json`: фильтры библиотеки свёрнуты, audio уплотнено, subtitles переведены, добавлены exit transitions и drop feedback. Проверены сохранение команд, native drag/reorder, touch и reduced motion. Обнаружены пересечение нижних действий на 1440 и сдвиг карты при long press.
3. `artifacts/task14-pass3-*.png` и `task14-pass3-interactions.json`: исправлены обе коллизии, long press сохраняет предыдущий выбор до освобождения pointer capture. Итоговая матрица — 14 снимков; дополнительно регионы, четыре края, realtime, zoom и тяжёлая сцена.

## Art Direction

Графитовый director console: карта — главная поверхность, инструменты — отдельные компактные слои. Rail узнаётся по активной вертикальной метке, собственному акценту режима и сдержанному свечению. У карты есть тёмная периферия и мягкая глубина без декоративного фэнтези chrome. Fit оставляет 16 px с каждой стороны и сохраняет карту целиком; на 1920 QA-сцена отображается при 94% вместо 83%.

## Motion System

Централизованные CSS tokens в `resources/css/identity.css`: instant 80 ms, fast 140 ms, normal 220 ms, cinematic 420 ms; два easing профиля. `motionDuration` читает те же значения для Pixi и Web Animations. Вход панелей, выбор инструмента, смена NOW и Combat используют opacity/transform. Выход панели — краткая inert/aria-hidden визуальная копия, которая удаляется после завершения; рабочая геометрия меняется сразу. Название сцены появляется на короткое время после загрузки.

Reduced motion отключает CSS/WAAPI движения и token pulse; существующая camera/director обработка сохранена. Постоянной декоративной пульсации нет.

## Interaction / Tactility

Hover/press состояния, ясная метка активного инструмента, cursor feedback, кольцо выбора и небольшое подтверждение окончания drag. Перетаскиваемый asset становится полупрозрачным; native drag image и marker показывают место отпускания. Подтверждение размещения появляется после успешной записи. Ошибки используют существующую очередь и её Retry, а radial дополнительно показывает причину ошибки.

Проверены реальные pointer drag, server persistence, Reverb update у Player и Undo. Wheel zoom сохраняет world point под курсором; pan не получил инерции.

## Radial Menu

GM: правая кнопка, удержание touch 520 ms, Shift+F10 / ContextMenu для выбранного token/prop/region. Геометрия ограничивается viewport; Escape, Tab и внешний click закрывают меню, стрелки/Home/End перемещают фокус. Drag дальше 8 px отменяет ожидание удержания.

Token: свойства, в бой, скрыть/показать, закрепить/освободить, состояния, копировать, триггеры. Prop: свойства, видимость, закрепление, на передний план, копирование, триггеры. Region: свойства, включение, триггеры. Удаления в круге нет. «Триггеры» открывает существующее редактирование взаимодействий. Player сохраняет простой существующий интерфейс взаимодействия.

Действия используют SceneStore commands и SaveQueue. Prepare Combat дожидается серверного ответа; уже добавленный участник не добавляется повторно. Ошибка prepare не продолжает add/navigation. Открытие меню не меняет выбор; long press не сдвигает viewport.

## Typography

Сохранён системный Segoe UI stack. Выраженная иерархия: текущий момент и имя хода 24–25 px, обычные заголовки 16–20 px, controls 12–13 px, спокойные metadata. Важные имена переносятся, компактные элементы имеют tooltip или доступ к полным свойствам.

## Color / Surfaces

Mint — готовность и выбор; amber — ход и бой; violet — Session/Cue/GM-only; blue — подготовка, библиотека и нейтральные токены; red — опасные операции. Поверхности разделены фоном, отступом и мягкой тенью; рамки оставлены там, где они показывают состояние или границу ввода.

## Token System

Портрет сохраняет круговую маску, поворот и тонкое кольцо. Без изображения — индивидуальная монограмма с неброской геометрией вместо одинакового щита. Owned — mint, стандартный unowned — blue, hidden GM — violet с меткой GM; пользовательский нестандартный цвет сохраняется. HP тонкий, критический уровень выделен; состояния не занимают основную площадь.

Подписи скрываются при дальнем обзоре, но сохраняются у выбранного/hover/current/dragged token. Их масштаб компенсируется относительно камеры. Текущий ход имеет короткий amber pulse, затем статичное кольцо. Всё происходит в существующем Pixi ticker без React animation loop и без пересоздания Graphics на каждом кадре. Монограммы также используются в Combat и Inspector.

## Session Mode

NOW выделен отдельной violet карточкой, NEXT показан непосредственно под навигацией, список получил иконки и акценты типов. Смена текущего пункта имеет короткий вход. Переход по плану по-прежнему меняет только фокус; активация сцены и показ материала остаются отдельными явными действиями.

## Combat

Вверху — имя текущего участника и HP, строка участника выделена янтарным акцентом. Live dock показывает `Раунд N · Имя`. Смена хода обновляет spotlight, dock и кольцо токена. Серверные проверки раунда, порядок, HP, conditions и другие Combat semantics сохранены.

## Asset Library

Изображения крупнее, имеют hover lift; расширенные collection/tag/sort фильтры свёрнуты. Audio представлены компактными строками с отдельной preview кнопкой и tooltip. Поиск, категории, upload, исходный порядок и существующий drag payload сохранены. В QA thumbnails письма и двери — старые технические fixtures, не новые художественные assets.

## Cue Editor

Связанные последовательные карточки, короткие смысловые subtitles, duration рядом с названием. Selected step и настройки справа выделены. Drag показывает lift/source opacity и линию назначения; keyboard move buttons сохранены. Проверены native reorder, обратное перемещение и сохранение без изменения исходной последовательности QA cue.

## Inspector

Группы свойств, акценты заголовков, монограмма/портрет, короткое раскрытие секций. Удаление отделено собственной danger area; обычная привязка к сетке не имеет danger accent. Проверен переход Inspector → Combat → Audio → close, cleanup exit copies и возврат к выбранному объекту.

## Responsive

1920×1080 и 1440×1000: desktop panels и radial; 768×1024: GM Table и Session drawer; 390×844: Player. Нет horizontal overflow, второй renderer canvas не создаётся. На 1440 нижние selection actions и scene actions разведены по высоте. Tablet long press проверен через настоящие Chromium touch events; физический планшет не использовался.

## Performance

Свежий Chromium 156 context, 1440×1000, scene 39: 200 props, 36 tokens, 1200 fog strokes, две image textures, fog mask 2048², один canvas. 240 requestAnimationFrame интервалов: p50 **8,3 ms**, p95 **8,5 ms**, max **8,5 ms**. Ранее записанный Task 13 baseline на той же сцене: 8,3 / 8,5 / 8,5 ms. DOM 309 вместо 301; наблюдаемый heap примерно 15,45 MB вместо 15,35 MB.

Это локальный smoke benchmark кадрового ритма, не GPU profiling и не гарантия на слабых устройствах. Измеримого ухудшения в этом сценарии нет. Пер-frame React updates не добавлены; viewport/label transforms и конечный token pulse используют текущий ticker.

## Validation

- `npm test`: **127 passed**, 26 files (8 новых тестов относительно Task 13).
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `composer test`: **89 passed / 1169 assertions**.
- `php vendor/bin/pint --test`: passed.
- `git diff --check`: passed.
- Browser: 14 состояний, без JS errors/overflow; Player snapshot не содержит скрытый токен.
- Radial commands, duplicate cleanup, lock/unlock, keyboard/outside/Escape, touch, reduced motion; props и regions; четыре края viewport.
- Реальный token drag/realtime/Undo; hide/reveal фильтрует Player; native library drop; Cue reorder/save; Next/Previous Combat и Session; panel transitions; zoom anchor.

Sandbox сначала блокировал Vite realpath B: и PHP vendor bootstrap; проверки повторены с разрешённым полным локальным доступом. Это были ошибки запуска, не падения тестов. Два QA assertions были исправлены: сравнение токена по id вместо позиции массива после authoritative patch и целочисленные координаты браузерного указателя для zoom-anchor.

## Screenshots

Локальные QA evidence, не runtime assets. Полная матрица также записана в `artifacts/task14-final-screenshots.json`.

| Размер | Состояния                                                                                                                                                                                                                                                                                                                                                               |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1920   | [Clean](../artifacts/task14-1920-clean.png) · [Session](../artifacts/task14-1920-session.png) · [Combat](../artifacts/task14-1920-combat.png) · [Assets](../artifacts/task14-1920-assets.png) · [Cue Editor](../artifacts/task14-1920-cue-editor.png) · [Inspector](../artifacts/task14-1920-inspector.png) · [Radial Token](../artifacts/task14-1920-radial-token.png) |
| 1440   | [Clean](../artifacts/task14-1440-clean.png) · [Session](../artifacts/task14-1440-session.png) · [Combat](../artifacts/task14-1440-combat.png) · [Radial](../artifacts/task14-1440-radial.png)                                                                                                                                                                           |
| 768    | [Table](../artifacts/task14-768-table.png) · [Session](../artifacts/task14-768-session.png)                                                                                                                                                                                                                                                                             |
| 390    | [Player](../artifacts/task14-390-player.png)                                                                                                                                                                                                                                                                                                                            |

Дополнительно: `task14-extra-drag.png`, `task14-extra-region.png`, `task14-extra-heavy.png`, все промежуточные pass1/pass2/pass3 снимки и JSON reports.

## Remaining Visual / Interaction Concerns

- В текущем server DTO нет faction/allegiance; kind/color для persisted tokens унифицированы. Нельзя достоверно отличить hostile от нейтрального NPC только по имеющимся данным. Новый domain field в эту задачу не добавлялся.
- При Fit горизонтальной карты на портретном экране остаются поля: сохраняются вся карта и её пропорции. Пользователь может приближать и перемещать обзор.
- Физические touch devices, Firefox и Safari не проверены. Reduced-motion и touch проверены в Chromium.
- Художественные портреты, рисунки предметов и полноценная multi-hour игровая сессия с людьми не входят в выполненную проверку. Визуальный fallback сделан для существующих материалов.
