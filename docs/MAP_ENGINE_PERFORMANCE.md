# Аудит движка карты: движение и видимость

Этот документ фиксирует первый этап аудита. Последующее согласованное изменение
движения, drag playback и presentation обзора описано в
[MOVEMENT_PRESENTATION_RESULTS.md](MOVEMENT_PRESENTATION_RESULTS.md).

Замеры 10–11 ноября 2026, локальный native runtime. Изменения не развёрнуты на production-сервере.

Baseline исходников: `063d9bb` (чистый checkout перед изменениями). Итоговые исправления остаются локальными, без commit.

## Результат и границы

На «Лесной таверне» воспроизведена задержка **авторитетного движения и обновления обзора при нормальной частоте кадров**. На данном компьютере 75 props не перегружают рендер: до исправлений уже было около 120 тиков/с и p95 кадра менее 10 мс. Пользователь уточнил, что проблема заметна именно при движении героя и обзоре.

Исправлен дорогой участок серверного LOS, исключена повторная сборка неизменившегося drag-preview и исправлено освобождение callback освещения. Расчёт полигона ускорен примерно в 2,2 раза с побитово одинаковым результатом на контрольном маршруте. Средний интервал масок WASD уменьшился с 333 до 261 мс.

**Непрерывный обзор на 60 Гц этим не достигнут.** В текущем протоколе маска привязана к подтверждённому сервером шагу, WASD отправляет не чаще пяти шагов в секунду, обычный drag намеренно применяет принятый маршрут мгновенно после отпускания. Это архитектурное ограничение, а не пропущенная React-мемоизация. Отдельный план ниже; контракт движения и секретности в этом изменении не переписан.

## Методика

- Ryzen 7 7700, 16 логических потоков, около 31 GiB доступной физической RAM; RTX 4070, ANGLE D3D11.
- Chrome 157.0.8103.39, headless, аппаратный WebGL2, viewport 1680×1050, DPR 1; GM canvas 1680×975. Фоновое торможение тестовых вкладок отключено одинаково до/после.
- Vite production build, без `public/hot`: до `app-BTOhdRGI.js`, после `app-Ciz_BW7C.js`. PHP/MySQL/Reverb локальные; frontend production build не превращает `php -S` в production HTTP-server.
- Реальная Scene 10: 75 props, 2 токена, 24 terrain chunks; 148 скомпилированных геометрических shapes. Сохранены исходные стены, окна, двери, текстуры, свет, обзор и прочие механики.
- Статические сценарии по 5 с после прогрева: idle, hover, pan, zoom, prop drag, обычный token drag, GM override drag. Drag отменяется до сохранения. Проверяется полное равенство серверного snapshot до/после.
- Реальное движение: GM и два игрока в отдельных browser contexts, штатный HTTP и Reverb. Существующий герой игрока 1, свободный участок двора (570,830) → (790,830); WASD `D` 1,4 с, Click-to-Move, drag. По три повтора каждого сценария. Исходные токены, grid, активная сцена, ручной/изученный fog восстановлены; revision counters и журнал авторитетных QA-команд закономерно увеличились.
- Метрики: интервалы Pixi ticker после рендера; PerformanceObserver long tasks; CPU-время ключевых методов; WebGL draw calls; неблокирующий `EXT_disjoint_timer_query_webgl2` раз в 16 рендеров; React commits через DevTools hook; Resource Timing и имеющийся `Server-Timing`; CDP Performance trace и sampling CPU profiler.
- `FPS` здесь — частота ticker/rAF, **не аппаратный счётчик представленных монитором кадров**. Input-to-tick также не измеряет время до фотона. GPU samples не включают весь browser compositor. Headless-замеры не заменяют проверку на другом клиентском оборудовании.
- Сначала собраны baseline и геометрические hashes, затем изменён код. Трассировки записывались отдельными диагностическими проходами и не подмешаны в сравнительную таблицу.

Движение сравнивается по одинаковым действиям и длительности ввода. В сохранённых обеих сериях камера кратко возвращалась от заданного масштаба 0,8 к исходному fit около 0,925; это одинаковый недостаток тестового setup, исправленный в скрипте после сравнений. Первый Click/drag поэтому заканчивается иногда на 217–221 вместо ровно 220 world units. Это не тест фиксированной скорости по идеально одинаковой траектории. Измерение первой реакции WASD округлено фазой ticker: наблюдалось 0–9,1 мс от начала выборки, не «нулевая физическая задержка».

## До / после

| Сценарий / метрика                                            |            До |         После | Интерпретация                                               |
| ------------------------------------------------------------- | ------------: | ------------: | ----------------------------------------------------------- |
| 75 props: idle / pan / zoom / drag, FPS                       |          ≈120 |          ≈120 | Рендер и раньше укладывался в 60 FPS                        |
| Те же 7 сценариев: диапазон p95 кадра                         |    8,5–9,1 мс |    8,5–9,2 мс | Значимого изменения нет                                     |
| Long tasks >50 мс, эти сценарии                               |             0 |             0 | CPU main thread не объясняет задержки                       |
| GPU p95, эти сценарии                                         |  2,39–3,55 мс |  1,75–3,46 мс | Запас GPU; разброс не считаем эффектом исправления          |
| Draw calls idle / normal drag                                 |      26 / ≈27 |      26 / ≈27 | Визуальный состав сохранён                                  |
| LOS polygon, 80 расчётов: median                              |      33,87 мс |      15,36 мс | −55%                                                        |
| LOS polygon: p95                                              |      46,46 мс |      23,72 мс | −49%; одинаковые 20 выходных hashes                         |
| WASD HTTP step: mean / median                                 |  315 / 295 мс |  247 / 250 мс | 17 / 19 запросов                                            |
| WASD HTTP step: p95                                           |        862 мс |        350 мс | Малая выборка, p95 фактически максимум                      |
| WASD: интервал новых масок, mean / median                     |  333 / 304 мс |  261 / 261 мс | 14 / 16 интервалов; ≈3 → ≈3,8 обновления/с                  |
| WASD: интервал масок p95                                      |        865 мс |        354 мс | Не гарантия устранения редких сетевых пауз                  |
| WASD: расстояние за одинаковые 1,4 с ввода                    | 169–203 units | 208–215 units | Меньше замедления из-за RTT/backpressure                    |
| Click-to-Move HTTP: mean / median                             |  272 / 268 мс |  243 / 262 мс | По 12 запросов                                              |
| Click-to-Move: интервал масок mean                            |        288 мс |        254 мс | По 9 интервалов                                             |
| Обычный drag HTTP: mean                                       |        198 мс |        198 мс | По 3 запроса; практически без улучшения                     |
| Hero WASD / click / drag: p95 кадра                           |    8,5–8,7 мс |    8,5–8,6 мс | Около 120 FPS, 0 long tasks в обеих сериях                  |
| Повторное применение token drag-preview, суммарный CPU за 5 с |       19,8 мс |        7,2 мс | Небольшое полезное сокращение, не главный источник задержек |

HTTP-результаты включают конкуренцию фоновых запросов и всего три повтора. Надёжный причинный результат — ускорение одинакового LOS-вычисления. Снижение RTT и интервалов масок — наблюдаемый итог этих проходов, а не обещание такого же p95 в любой сессии.

## Цепочка ввода и реальные причины

| Приоритет      | Участок                           | Доказательство / причина                                                                                                                                                                                                                                         | Решение и ожидаемый эффект                                                                                                               |
| -------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| P0             | Движение ↔ авторитетная видимость | `WasdControl` interval=200 мс, один in-flight запрос, ограниченная prediction и адаптация скорости к RTT. `PlayerVisionLayer` получает новые masks только после accepted state; затем ограниченное easing около 120 мс. Между обновлениями геометрия не меняется | Нужен согласованный контракт accepted movement + visibility playback. Главный оставшийся источник ощущения рывков                        |
| P1             | Серверный LOS CPU                 | `VisibilityPolygon` имел angular buckets для лучей, но `clearDistance` повторно собирал кандидатов по world-space прямоугольнику для каждого луча/уточнения                                                                                                      | Реализован один консервативный angular broad phase для точной проверки; median 33,87 → 15,36 мс                                          |
| P1             | HTTP / очередь локального сервера | Диагностический step: около 181 мс приложения и 287 мс полного ответа; перед ним приватный asset GET. Другой step 209 мс приложения против 299 мс ответа. Preload и asset requests конкурируют с движением                                                       | Отдельно проверить concurrent native HTTP runtime. Переписывание Echo и увеличение частоты команд не устранят очередь                    |
| P1             | Семантика normal drag / click     | `ClickToMove` ждёт accepted route; normal drag передаёт `instant=true`. Во время удержания виден destination/path preview, после отпускания — подтверждённый переход. Click исполняется последовательными сегментами                                             | Это текущий продуктовый контракт. Плавный перенос самого героя с маской требует согласованного изменения, а не удаления server authority |
| P2             | Повторная Graphics-геометрия      | Один и тот же route-preview вызывался из pointer updates и ticker                                                                                                                                                                                                | Реализована invalidation по target/result/zoom/overlay revision; изменение внешнего overlay и результат Worker не теряются               |
| P2             | Освобождение renderer             | `destroy()` обнулял `onLightingFrame`, затем снова присваивал callback, удерживающий renderer и принимающий lighting frames                                                                                                                                      | Убрано повторное присваивание и replay; regression test проверяет освобождение callbacks                                                 |
| P2, рост сцены | Token rendering                   | 26 → 391 → 1016 draw calls при 2 → 75 → 200 токенах; у каждого portrait Graphics mask, собственные graphics/text, нарушающие batching                                                                                                                            | Резервировать отдельный профиль token masks/batching; не менять порядок слоёв или качество без отдельного сравнения                      |
| P3             | React / zoom UI                   | 183/184 commits за 5 с zoom, но p95 кадра 8,7 мс; на остальных static сценариях обычно 0–3 commits                                                                                                                                                               | Это не подтверждённая причина нынешнего торможения. Изоляцию UI camera readout делать при измеренном превышении бюджета                  |
| P3             | Hit testing / коллекции           | `TokenLayer.hit`/`ScenePropLayer.hit` создают reverse arrays и линейно ищут объект. При 75 props p95 ≈0,1 мс; 300 props — до 0,2 мс. Некоторые sync membership loops квадратичны                                                                                 | Не добавлен spatial tree без пользы на текущей нагрузке. Измерять при массовых mutations, отдельно от статического рендера               |

После изменения средний `Server-Timing app` для WASD — 192 мс: bootstrap 14 мс, SQL 34 мс, `vision_view` 20 мс, `los_polygon` 15 мс, `vision_projection` 33 мс, `fog_record` 19 мс, `broadcast_prepare` 15 мс. **Эти таймеры вложены: складывать их нельзя.** Player collision phase дополнительно имеет намеренный минимум 40 мс для защиты от утечки приватной геометрии через время ответа (`TokenMovement`). Он сохранён.

Reverb доставляет инкрементальные accepted updates; ожидание сервера не блокирует Pixi ticker. WASD локально показывает bounded prediction уже на ближайшем кадре. В проверенных данных у GM первое принятие движения появляется спустя примерно 442–592 мс от начала сценария: сюда входят открытие control stream, накопление первого шага, HTTP и доставка. Это не чистая задержка WebSocket. Игрок 2 не получает скрытого героя; отсутствие его movement samples ожидаемо и не трактуется как потеря realtime.

## Рендер, состояние и память

`TabletopRenderer` создаёт Pixi scene graph, React управляет UI. Высокочастотная camera/presentation state уже живёт отдельно от persisted scene. DOM pointer controller владеет вводом; Pixi world имеет `eventMode='none'`, поэтому дублирующий рекурсивный Pixi hit testing здесь не является причиной тормозов.

Props и tokens сохраняют view instances; текстуры переиспользуются по asset ID. Геометрия структуры/terrain не пересобирается на каждый сырой pointer event. Обычный prop drag меняет presentation transform, окончательная mutation идёт после отпускания. Worker drag-route принимает latest target и не сохраняет каждую позицию мыши. Полной замены scene snapshot на каждом pointer event нет.

`PlayerVisionLayer` использует две переиспользуемые поверхности и memory texture. Геометрия/пиксели маски обновляются при изменении key, не каждый кадр; `tick` меняет shader progress. На WASD CPU `vision.sync` после изменения в среднем 0,4 мс, p95 0,7 мс. Exact current mask клипует сущности; presentation easing не заменяет авторитетную фильтрацию.

Следует различать текущую видимость (range/LOS), ручной fog, explored memory и освещение. В текущем checkout уже существуют `FogExploration`, `PlayerVisionLayer` и `SceneLighting`; это не основание считать запрошенную будущую систему Fog of War законченной. Изменение касается общего точного LOS-ядра, не добавляет новую fog-механику. Ночное представление использует raster с cell size `max(2, ceil(max(width,height)/384))`; это отдельный источник пространственной дискретности, его разрешение не уменьшалось.

В отдельном baseline zoom trace: MinorGC 0,52 мс, MajorGC 1,50 мс, incremental marking суммарно около 2,25 мс. В отдельном WASD trace после изменения (несколько renderer contexts) максимальная MajorGC-пауза 2,30 мс. Длительные GC-паузы как причина данного симптома не подтверждены. Замеры сами сохраняют массивы samples, поэтому рост heap во время профилирования нельзя объявлять утечкой приложения. Исправление callback подтверждено кодом и regression test; многократный heap-snapshot/часовой soak-test не выполнен.

## Масштабирование

Дополнительные props/tokens клонировались **только в browser store**, с исходными текстурами. В БД новые сущности не создавались. Это нагрузка на renderer/hit testing, не на серверные LOS, множество независимых observers или уникальные asset downloads.

| Сцена после изменений   | Сценарии                       |  FPS | Максимальный p95 кадра | Draw calls | CPU render p95 до | GPU p95 до |
| ----------------------- | ------------------------------ | ---: | ---------------------: | ---------: | ----------------: | ---------: |
| 75 props + 2 tokens     | 7 сценариев                    | ≈120 |                 9,2 мс |      26–28 |            0,7 мс |    3,46 мс |
| 300 props + 75 tokens   | idle/hover/pan/zoom/token drag | ≈120 |                10,2 мс |    391–392 |            2,4 мс |    5,29 мс |
| 1000 props + 200 tokens | idle/hover/zoom                | ≈120 |                13,7 мс |       1016 |            6,5 мс |    6,94 мс |

На последней сцене p99 кадра до 14,5 мс, max 15,3 мс, input-to-tick p95 до 7,5 мс; long tasks отсутствовали. Запас на более слабой GPU/HiDPI существенно меньше. Это не доказательство 60 FPS при 200 одновременно движущихся героях, 200 observers или сотнях новых текстур. Серверная стоимость растёт с числом наблюдателей, источников света, пересекающихся blockers и изменяемых проекций; новый angular broad phase не превращает LOS в константную операцию.

Map Editor отдельно проверен после изменений: idle/pan/zoom/отменяемый prop drag, ≈120 FPS, p95 8,5–8,9 мс, без browser errors и без изменения server snapshot. Session Runtime и player movement проверены отдельно, с настоящими accepted commands.

Дополнительная регрессия на постоянном Scene 7 с пятью источниками, ночным светом, fog и тремя одновременно работающими клиентами даёт другой бюджет: WASD около 109,5 FPS до/после (p95 10,9 → 10,8 мс), Click-to-Move 71,7 → 71,3 FPS (p95 16,6 → 17,1 мс). Это по одному проходу, отдельная сцена и отдельный существующий harness; смешивать с таблицей Scene 10 нельзя. Здесь нет подтверждённого улучшения и бывают кадры дольше 16,7 мс. GPU/compositor и влияние трёх клиентов на одном GPU отдельно не изолированы — причина этого ограничения остаётся для дополнительного профиля, а не объявляется исправленной. Маршрут завершён, browser errors и movement resets отсутствуют, memory texture не пересоздаётся на каждом шаге. Данные Scene 7 и активная сцена восстановлены.

## Выполненные изменения и проверки

- `LineOfSight::radialCandidates`: консервативное распределение EPS-expanded AABB по тем же 512 angular sectors. Если origin внутри bounds, shape попадает во все sectors; wraparound и границы учитываются. `ShapeIntersection`, clipping, точность и private DTO policy не изменены.
- `VisibilityPolygon`: reuse этих candidates при точной проверке каждого луча. Нет аппроксимации стен или уменьшения количества/точности ray events.
- `DragRoutePreview`: повторный draw только при изменении target, результата Worker, zoom или external overlay revision.
- `TabletopRenderer.destroy`: освобождение lighting callback без повторного подключения к уничтожаемому слою.
- Добавлены воспроизводимые QA scripts и ограниченная Scene 10 поддержка существующего fog backup/restore helper.
- Production build прошёл. ESLint изменённых TS/CJS прошёл. PHP syntax и `git diff --check` прошли.
- 82 frontend tests / 18 files: navigation, vision, lighting, renderer/interaction/camera, TokenLayer, SceneStore — passed. В Node есть предупреждение о >10 обработчиках одного AbortSignal в interaction tests; это не установленная утечка браузера.
- 76 PHP tests / 16 541 assertions: LOS, radial parity, PlayerVision, Lighting, FogExploration, TokenMovement, DirectControl, MovementTrigger, Structure — passed, isolated SQLite in-memory.
- Radial parity: 8192 луча, wraparound, касания, epsilon, origins внутри bounds, polygon/band/rotated ellipse. Дополнительно все 20 hashes полигонов реальной сцены до/после совпали; peak PHP allocation benchmark в обоих случаях 32 MiB.

## Отдельный план для непрерывного движения и обзора

Это следующий архитектурный этап, **не выполненная часть данного patch**.

1. Зафиксировать общий presentation clock и revision/sequence для принятого маршрута, его воспроизведения и видимости. Сейчас токен может быть в predicted/animated position, а mask — уже/ещё в другом accepted state. Сохранить server authority, проверки владения, combat budget, triggers, door changes, idempotency и reconnect.
2. Сравнить две ограниченные реализации на том же fixture: серверные visibility samples вдоль уже принятого маршрута с временными метками; либо разрешённый сервером локальный visibility envelope для prediction. Первый путь предпочтителен для начала: он опирается на существующий accepted path и не требует отдавать игроку скрытые blockers. Его CPU/payload стоимость ещё не измерена; заранее умножать число LOS-расчётов в 12 раз нельзя.
3. Exact entity visibility и explored-memory progression применять только на принятой сервером позиции/revision. Никогда не раскрывать будущие сущности заранее и не переводить произвольную текущую LOS texture вслед за курсором: это показывает области за стенами. Сглаживание background mask должно иметь доказанный допустимый envelope, а не только красивую интерполяцию.
4. Унифицировать drag/click/WASD presentation: немедленный destination/ghost preview, затем плавный playback принятого маршрута; отдельно решить, должен ли normal drag сохранять нынешнюю instant-семантику. При rejection, закрытии двери, внешнем перемещении и reconnect прекращать устаревший playback.
5. Перед повышением сетевой частоты проверить concurrent native HTTP-сервер с сохранением endpoints/private assets/Reverb/queue. Windows `php -S` сериализует запросы; его multi-worker режим на Windows не поддерживается. Это изменение runtime, не скрытая правка launchers в данном patch. Сначала измерить выигрыш и регрессии в отдельной конфигурации.
6. Критерии следующего этапа: p95 frame ≤16,7 мс; измерение local input→presentation, максимального разрыва между положением героя и допустимой областью обзора, частоты/размера masks и server CPU. По 10+ повторов, 75/300 объектов, GM + 2 players, искусственные RTT 50/150/300 мс и reconnect; отдельные двери/углы/узкие проходы/ночной свет/секретные сущности/бой.

Для дальнейшего света/LOS/Fog сохранять раздельные domain, visibility projection и renderer presentation. Кеши геометрии привязывать к реальному geometry revision и permissions, а не только positions или TTL. Не добавлять глобальную event bus, ECS, quadtree или full-scene render texture без отдельного профиля. Следующий рендерный кандидат на больших сценах — token masks/batching; следующий серверный — повторные visibility/projection и DB costs после снятия HTTP queue contention.

## Воспроизведение и артефакты

Из корня проекта, при запущенном native runtime и свободном QA fixture; не запускать измерения параллельно с build/tests/другим профилем:

```powershell
npm run build
node scripts/qa/map-engine-performance.cjs current
node scripts/qa/map-engine-motion.cjs motion-current
php scripts/qa/map-engine-geometry.php artifacts/map-engine-performance/geometry-current.json
```

`YTT_PERF_PROP_COUNT`, `YTT_PERF_TOKEN_COUNT`, `YTT_PERF_CASES` задают browser-only stress test; `YTT_PERF_EDITOR=1` открывает Map Editor. Для движения есть `YTT_PERF_INPUTS`, `YTT_PERF_REPEATS`; `YTT_PERF_TRACE=1` записывает отдельный diagnostic trace. Не сравнивать trace-enabled series с обычной. При прерванном live motion: `node scripts/qa/map-engine-motion.cjs recovery --restore` восстанавливает сохранённые токены/grid/active scene/fog; не удалять private restore backup вручную.

Локальные ignored artifacts:

- `artifacts/map-engine-performance/baseline/report.json`, `after/report.json` — сравнительные render серии и raw samples.
- `motion-before-valid/motion-report.json`, `motion-after/motion-report.json` в той же папке — единственные итоговые paired movement серии. Ранние `motion-baseline`, `motion-before`, `motion-debug` — отладка сценария/HUD, не использовать как baseline.
- `geometry-before.json`, `geometry-after.json` — одинаковая геометрия, timings и hashes.
- `baseline/zoom-trace.json`, `baseline/zoom.cpuprofile`, `motion-profile/wasd-0-trace.json`, `motion-profile/wasd-0.cpuprofile` — открываются в Chrome DevTools Performance / JavaScript profiler.
- `network-diagnostic/motion-report.json` — дополнительный проход со всеми API timing records.
- `scale-300-75/report.json`, `scale-1000-200/report.json`, `editor-after/report.json` и PNG — отдельные проверки масштабирования и Editor.
- `artifacts/vision-motion/engine-before/report.json`, `artifacts/vision-motion/engine-after-regression/report.json` — отдельная регрессия Scene 7 с пятью источниками света.

Использованные официальные документы: [PixiJS v8 performance tips](https://pixijs.com/8.x/guides/concepts/performance-tips), [PixiJS v8 events](https://pixijs.com/8.x/guides/components/events), [PHP built-in web server](https://www.php.net/commandline.webserver). Их рекомендации сверены с реальным кодом; отключение возможностей или слепое кеширование сцены ради FPS не применялось.
