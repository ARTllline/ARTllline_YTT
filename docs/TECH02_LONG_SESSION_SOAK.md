# TECH-02 — Full long-session multiplayer soak

Дата: 2026-10-31.

**PASS: непрерывный 50-round workload и все функциональные assertions.**
**FAIL по полному критерию закрытия MODULE 01: убедительное heap plateau не доказано.**
Это не диагноз memory leak: небольшой остаточный рост может быть прогревом/кешированием,
но объявлять критерий «Heap стабилизируется» выполненным по этим точкам нельзя.

## Запуск и evidence

Команда: `node B:\DnD\YTT\scripts\qa\tech02-soak.cjs --full --rounds=50`.
Неизменённый townhouse-v1, native PHP/MySQL/Reverb, GM + два отдельных Player
contexts, Chrome 156.0.8078.74, Node v20.20.2, 1440×1000, physical dice enabled.
Fixture: campaign/scene 5, session 1; новых аккаунтов/сцен/сессий не создавалось.

Успешный запуск: `artifacts/tech02/2026-10-31T10-42-44-529Z/report.json`; агрегаты: `artifacts/tech02/2026-10-31T10-42-44-529Z/summary.json`.
Harness SHA256: `8ca1c805a9a1300b9f7ea20eab044d10fc6c1a4d7dea0f6ac3e09cda658572dc`.
Build manifest SHA256: `c5526a546a0fb7ab64c9210da08bf49d4051993f2d33428fd72a252b50b63953`.

Выполнено 50 полных раундов / 300 переключений ходов, 100 Player действий
с targeting и physical dice presentation, 100 Player movement commands,
50 пар condition add/remove, периодические inventory windows у обоих Players.
Ни automatic retries, ни изменений gameplay/frontend/backend не было.

## Checkpoints

Heap — decimal MB после CDP GC; DOM — reachable nodes из Memory.getDOMCounters,
не только live elements. Строки измеряются при одинаковой фазе конца раунда.

| Checkpoint         | Client   | Heap MB | DOM nodes | Listeners | Pixi objects | Channels | Dice init |
| ------------------ | -------- | ------: | --------: | --------: | -----------: | -------: | --------: |
| baseline           | GM       |   8.556 |      1240 |       351 |          142 |        4 |         — |
| baseline           | Player 1 |  11.241 |       774 |       435 |          135 |        5 |         1 |
| baseline           | Player 2 |  11.388 |       820 |       449 |          135 |        5 |         1 |
| round-10           | GM       |  10.026 |      1322 |       361 |          142 |        4 |         — |
| round-10           | Player 1 |  14.261 |       812 |       435 |          135 |        5 |         1 |
| round-10           | Player 2 |  14.762 |       864 |       449 |          135 |        5 |         1 |
| round-25           | GM       |  10.426 |      1444 |       376 |          142 |        4 |         — |
| round-25           | Player 1 |  14.755 |       812 |       435 |          135 |        5 |         1 |
| round-25           | Player 2 |  15.137 |       864 |       449 |          135 |        5 |         1 |
| after-reconnect    | GM       |  10.398 |      1444 |       376 |          142 |        4 |         — |
| after-reconnect    | Player 1 |  14.791 |       812 |       435 |          135 |        5 |         1 |
| after-reconnect    | Player 2 |  15.095 |       864 |       449 |          135 |        5 |         1 |
| round-50           | GM       |  10.821 |      1642 |       401 |          142 |        4 |         — |
| round-50           | Player 1 |  15.588 |       812 |       435 |          135 |        5 |         1 |
| round-50           | Player 2 |  15.922 |       864 |       449 |          135 |        5 |         1 |
| final-idle-cleanup | GM       |  10.547 |      1018 |       331 |          142 |        4 |         — |
| final-idle-cleanup | Player 1 |  15.485 |       659 |       424 |          135 |        5 |         1 |
| final-idle-cleanup | Player 2 |  16.216 |       679 |       438 |          135 |        5 |         1 |

## Trends

- Player DOM/listeners: от round 10 до 50 строго 812/435 и 864/449.
  После завершения боя: 659/424 и 679/438. Накопления HUD/listeners не обнаружено.
- Pixi objects: 142 у GM и по 135 у Players во всех checkpoints. Один tabletop
  canvas на клиента. У каждого Player одна инициализация dice renderer, включая
  reconnect; действие закрывалось только после settled presentation.
- Player heap: baseline → 10 — 11.24→14.26 и 11.39→14.76 MB (начальный прогрев).
  Затем 10→25: +0.494/+0.375 MB; 25→50: +0.833/+0.785 MB. Поздний темп
  около 0.032 MB/round не исчез. Final idle: 15.49/16.22 MB, заметного возврата
  heap нет. Это малый drift без видимой деградации, но ещё не доказанное plateau.
- GM heap 10.03→10.43→10.82 MB на rounds 10/25/50. DOM/listeners растут
  вместе с реальными pending manual tasks, а не копиями интерфейса: при
  диагностическом чтении в ходе round ~30 было 30 задач Fire Bolt (28 обычных
  и 2 scroll). GMResolutionQueue рендерит data.pending.map; GMResolutions
  выбирает durable receipts с manualResolution=pending. Workload оставляет их
  нерешёнными. После окончания боя GM DOM/listeners падают 1642/401→1018/331.
  Этот доменный рост не следует выдавать за leak и не следует молча убирать
  из workload ради красивого графика.

## API latency и frame pacing

Значения — p50 / p95, ms. Интервалы: rounds 1–10, 11–25, 26–50;
малый reconnect checkpoint отдельно и не смешан с равномерным workload.

| Operation                  |      1–10 |     11–25 |     26–50 |
| -------------------------- | --------: | --------: | --------: |
| GM combat/next             | 222 / 324 | 221 / 476 | 225 / 656 |
| Player 1 inventory/use     | 313 / 461 | 332 / 723 | 318 / 452 |
| Player 2 abilities/execute | 188 / 202 | 194 / 393 | 192 / 440 |
| Player 1 move              | 133 / 301 | 126 / 573 | 130 / 562 |
| Player 2 move              | 114 / 135 | 122 / 529 | 124 / 790 |

Медианы не деградируют; tails неоднородны. GM next-turn в поздних пяти
5-round окнах имел p95 2166, 311, 308, 979, 350 ms; последние пять раундов
сопоставимы с первыми пятью (341 ms). Максимум 3349 ms, отдельные stalls также
были в середине (2978 ms). Поэтому рост aggregate p95 нельзя назвать
монотонной накопительной деградацией; локальная latency вариативна и имеет
редкие длинные хвосты. Причина stalls не установлена, изменения runtime/DTO
ради них не делались. Windows native HTTP обслуживает запросы последовательно.

Across checkpoints, rAF p95 ~8.4 ms после baseline ~8.5 ms; в сохранённых
последних bounded frame windows боевых checkpoints не было интервалов >50 ms.
Это выборки до 4096 frames, не непрерывная запись всей сессии и не GPU timings.

## Reconnect / realtime correctness

После round 25 Player 1: HTTP offline + настоящий Pusher disconnect; GM меняет
HP, Player 2 продолжает читать сцену; затем network/transport restore без reload.
Авторизованный Player snapshot совпал с фактическим frontend state; последующие
25 раундов прошли. Каналы до/после: GM 4, Players 5/5; у Player 1 subscribe
attempts 5→10, что соответствует переподписке на новом соединении.

Во всех checkpoints: duplicate scene mutations = 0, repeated active subscriptions = 0.
Все 300 next-turn mutation IDs проверены на GM и обоих Players; соответствующий
Pixi revision проверен у Players. Регулярные comparisons включали combat, revision,
visible positions/HP/conditions и own Character selection/HP. Desync, missing
turn updates и uncaught JS errors в успешном прогоне не зафиксированы.
Детектор replay хранит последние 512 IDs; control events без mutationId не
считаются дублями лишь из-за совпадения типа.

## Ошибки и прерванные попытки

- Первая попытка: 0 rounds, MySQL на 127.0.0.1:3306 остановлен; reset отказал
  до чтения fixture.
- `2026-10-31T10-35-35-792Z`: после 5 rounds, GM POST /scenes/5/combat/next,
  Failed to fetch; исчезли native PHP/MySQL, cleanup connection refused.
- `2026-10-31T10-39-06-646Z`: после 3 rounds, Player 2 GET /scenes/5/snapshot,
  Failed to fetch. Исходный manually started MySQL process завершился
  (supervisor MYSQL_ALIVE=False). Open Server main.log фиксирует restart
  и startup MySQL/Apache в 12:40:40–12:40:51; PHP YTT также остановился.
  Open Server Panel был запущен в 12:37:36, в момент первого прерывания.
- После завершения Open Server startup заново штатно запущены native YTT
  services; следующий прогон прошёл все 50 rounds без fetch failure.

Наблюдения связывают эти fetch failures с изменением доступности local runtime
на разных routes/roles, а не с доказанным long-session gameplay дефектом.
Они не доказывают причину старого preflight transient failure. Частичные
метрики прерванных попыток исключены из таблиц. Никаких скрытых retries.

## Cleanup, fixes, remaining risks

Harness завершился с success=true, restored=true и exit code 0. После закрытия
contexts штатный qa:townhouse восстановил подготовленную fixture; новые
постоянные данные для теста не создавались. Промежуточные failed cleanup
покрыты последующим успешным reset и полным прогоном.

Продуктовых fixes/regression tests в этой задаче не потребовалось: воспроизводимый
P0/P1 дефект приложения не установлен. Изменён только этот отчёт; существующие
TECH-01/preflight изменения сохранены. Полный workload с runtime assertions
является выполненной проверкой; повторный общий suite без изменений кода не запускался.

Риски: причина остаточного heap drift не установлена; browser/GPU caches могут
быть его частью. Достоверных per-client GPU bytes и detached-node counts нет.
Headless Chromium/local native HTTP не эквивалентны WAN, production PHP-FPM,
Safari/Firefox, физическим телефонам и многочасовому GPU тесту. Это границы
результата, не дополнительные требования к MODULE 02.

## Можно ли закрыть MODULE 01?

**Пока нет без оговорок. Конкретный blocker: критерий heap stabilization не
доказан — после прогрева Player heap продолжил расти на ~0.8 MB за rounds
25–50 и не вернулся на idle.** Это blocker верификации, не подтверждённый leak.
Нужен адресный анализ удерживаемых объектов / причин этого малого drift,
без повторного общего refactor или объявления нормальных caches утечкой.
Остальные проверяемые критерии MODULE 01 выполнены в локальном сценарии;
устойчивой накопительной latency деградации не обнаружено, stalls отмечены выше.
Критерии MODULE 01 прочитаны адресно для этого вывода; внешний Control Center
не изменялся. MODULE 02 не начинался.

## Дополнение — residual heap verification (2026-10-31)

**Вердикт: slope сильно замедляется, но bounded plateau ещё не доказано.
Leak не установлен; production fix не делался. MODULE 01 пока не закрыт.**

### Фактический запуск и остановка

Тот же townhouse-v1 workload, без нового gameplay. Исходный diagnostic run на
150 rounds НЕ перезапускался. По уточнению пользователя сохранён R50 checkpoint
и прекращён дальнейший тест. Однако остановить его ровно на R50 не удалось:
в загруженном harness не было stop-флага; первая одноразовая debugger-остановка
была установлена поздно. На ближайшей безопасной границе цикл завершён после
R54. Это отклонение от запрошенной остановки на R50, не 150-round результат.
R51–54 исключены из основного сравнения; final idle относится к R54.
Combat/end, browser close и deterministic qa:townhouse прошли штатно:
success=true, restored=true, stoppedByUserAtRound=54, exit code 0.
Артефакты: `artifacts/tech02/2026-10-31T11-07-59-663Z/report.json`.
Reconnect был запланирован на R75 и в этом run не выполнялся; его результат
предыдущего полного TECH-02 остаётся отдельным evidence. Automatic retries нет.

### Методика

Старый heapBytes уже снимался после HeapProfiler.collectGarbage через
Runtime.getHeapUsage; это не был raw heap. Но моментальный post-GC замер мог
включать ещё живые временные allocations/незавершённые UI requests.
В существующий harness добавлены только rawHeapBytes перед GC и settledHeapBytes
после снятия UI-метрик, drain измерительных буферов, 1 секунды ожидания и второго
GC. GC выполняется на checkpoints, не используется для исправления gameplay.

Browser instrumentation bounded: rAF ≤4096 чисел (drain на checkpoint), marks
≤256, ResourceTiming entries фактически 250. Marks на R25/R50 — 256, resources
на R10/R25/R50 — 250. Player SceneStore.localMutations — 0. Latency, WS recent IDs
(512), event maps и report rows находятся в управляющем Node, отдельно от browser
heap. Bridge не сохраняет scene/renderer references. Backing capacity/cache
warm-up возможен; бесконечного роста длины этих browser buffers не видно.

### Heap по checkpoints

Decimal MB (1 MB = 1,000,000 bytes). Settled — второй GC после ожидания/drain.

| Point          |    P1 raw |     P1 GC | P1 settled |    P2 raw |     P2 GC | P2 settled |
| -------------- | --------: | --------: | ---------: | --------: | --------: | ---------: |
| Baseline       | 15.011696 | 11.297576 |  11.307436 | 17.652284 | 11.510264 |  11.484332 |
| R25            | 22.777588 | 14.663648 |  14.624648 | 43.496244 | 14.987988 |  14.948808 |
| R50            | 40.904452 | 15.298008 |  15.264352 | 44.691484 | 15.867436 |  15.824292 |
| Final idle R54 | 18.563412 | 15.388484 |  15.342884 | 20.710656 | 15.842664 |  15.797048 |

### Absolute / relative growth and slope

| Client / measurement | Baseline→R25 Δ MB (%) |  R25→R50 Δ MB (%) | Early / late kB per round | Slope reduction |
| -------------------- | --------------------: | ----------------: | ------------------------: | --------------: |
| P1 post-GC           |    +3.366072 (29.79%) | +0.634360 (4.33%) |            134.64 / 25.37 |          81.15% |
| P2 post-GC           |    +3.477724 (30.21%) | +0.879448 (5.87%) |            139.11 / 35.18 |          74.71% |
| P1 settled           |    +3.317212 (29.34%) | +0.639704 (4.37%) |            132.69 / 25.59 |          80.72% |
| P2 settled           |    +3.464476 (30.17%) | +0.875484 (5.86%) |            138.58 / 35.02 |          74.73% |

Оба интервала — 25 rounds; проценты от начала соответствующего интервала.
Early interval включает основной initial warm-up. Более строгое сравнение после
него: settled slopes R10→R25 — 51.23 / 41.71 kB/round, R25→R50 — 25.59 / 35.02.
Поздний slope тоже ниже, но особенно у P2 остаётся близким к прежним ~32 kB/round.
Три точки не доказывают асимптотический plateau. Короткий final idle R54 не
является полноценным поздним интервалом и не доказывает стабилизацию.

### Что данные позволяют исключить / чего не позволяют

- На R50 GC освобождает ~25.61 / 28.82 MB: raw curve содержит много temporary
  allocations и не является retention curve.
- Второй GC снимает лишь ~0.03–0.04 MB на R25/R50. Остаточные +0.64/+0.88 MB
  не объясняются только отсутствием GC или незавершённым первым измерением.
- Player DOM/listeners R25→R50 неизменны: 812/435, 864/449; final idle — 659/424,
  679/438. Pixi objects по 135, один tabletop canvas и одна dice initialization.
  Duplicate mutations/subscriptions — 0. Накопление копий HUD/renderers/listeners
  не подтверждается как причина этого drift.
- Marks/resource counts достигли bounded limits, а диагностический Node-report
  не входит в browser heap. Рост бесконечного browser diagnostic журнала не виден.
- Retention внутри существующих React/Pixi/dice/runtime объектов и верхние
  границы других caches этими счётчиками НЕ исключены.

### Интерпретация и следующий шаг

Ранний рост хорошо согласуется с warm-up. Bounded cache/runtime behaviour
правдоподобно, slope явно снижается. Но поздний retained drift воспроизводим
по величине, а settled почти повторяет post-GC. Чистый measurement noise не
является достаточным объяснением всего эффекта; малую вариативность измерений
исключать нельзя. Real retention остаётся гипотезой, не диагнозом. Численные
вероятности из этих точек не выводятся.

Snapshots не снимались: условный trigger был на R75 при сохраняющемся росте;
до него run по уточнённому указанию не доводился. Глубокого snapshot analysis,
blind cleanup или production fixes не было. ESLint и node syntax check прошли.

**Можно ли закрыть MODULE 01? Пока нет: retained heap plateau не доказано.**
Один минимальный следующий шаг — отдельный адресный heap-verification task тем
же harness до R100 с GC-aware точками R50/R75/R100; при сохраняющемся late drift
снять и сравнить retaining paths поздних snapshots, без нового framework/workload.
Текущие browser contexts закрыты и fixture восстановлена: это будет новый run
по отдельному запросу, не скрытое продолжение текущего. В этой сессии он не
запускался. MODULE 02 не начинался.

## Final retained heap verification — R100 (2026-10-31)

100-round townhouse-v1 run completed, success=true, restored=true. Chrome headless,
GM + two Players; reconnect after R50 succeeded. No application fixes were made.
Private raw snapshots remain ignored in `artifacts/tech02/2026-10-31T14-01-16-091Z/`;
they may contain sensitive session data and must not be published.

| Checkpoint | P1 settled MB | P2 settled MB |
| ---------- | ------------: | ------------: |
| Baseline   |     11.262884 |     11.488236 |
| R25        |     14.741948 |     15.188644 |
| R50        |     15.295368 |     15.792156 |
| R75        |     15.572900 |     16.002640 |
| R100       |     15.741800 |     16.141412 |

| Interval       | P1 delta MB / kB per round | P2 delta MB / kB per round |
| -------------- | -------------------------: | -------------------------: |
| Baseline → R25 |         +3.479064 / 139.16 |         +3.700408 / 148.02 |
| R25 → R50      |          +0.553420 / 22.14 |          +0.603512 / 24.14 |
| R50 → R75      |          +0.277532 / 11.10 |           +0.210484 / 8.42 |
| R75 → R100     |           +0.168900 / 6.76 |           +0.138772 / 5.55 |

P1 slopes decline approximately 84%, 50%, 39%; P2 84%, 65%, 34% between
successive intervals. The total settled heap growth is decelerating strongly.
Player DOM/listeners remain 812/435 and 864/449 from R10 to R100. Pixi stage
objects 135, dice initialization 1, tabletop canvas 1; duplicate events and
repeated active subscriptions 0 throughout. Final idle heap 15.677880/16.108640 MB.

Snapshots were triggered at R50 because settled growth since R25 exceeded
0.5 MB, then collected at R75 and R100 for each Player. Comparison of **live
node count and aggregate shallow self_size**, not dominator retained size:

| Object group                              | Player | R50 count / shallow bytes |           R75 |          R100 |
| ----------------------------------------- | ------ | ------------------------: | ------------: | ------------: |
| blink::NetworkResourcesData::ResourceData | P1     |             1089 / 313632 | 1607 / 462816 | 2112 / 608256 |
| blink::NetworkResourcesData::ResourceData | P2     |             1068 / 307584 | 1579 / 454752 | 2071 / 596448 |
| JS object `Kt` (minified name)            | P1     |                124 / 9424 |   174 / 13224 |   224 / 17024 |
| JS object `Kt` (minified name)            | P2     |                124 / 9424 |   174 / 13224 |   224 / 17024 |

These are surviving snapshot nodes and shallow sizes, not retained sizes or
proof of the owning path. Other rising groups include V8 InstructionStream;
no claim is made that their growth is a leak. ResourceData points to browser
network/inspection machinery as a hypothesis, while `Kt` is unresolved. Both
object groups grow consistently even as total heap slopes decay. Whether they
are bounded browser/DevTools caches, diagnostic retention or app-owned objects
cannot be established from group counts alone. Capturing snapshots can itself
perturb subsequent measurements. No dominator/retaining-path analysis was done
in this task, per the requested escalation boundary.

**Verdict: inconclusive for strict MODULE 01 closure.** Total heap meets the
requested decaying-slope criterion, and visible runtime metrics remain stable;
however the snapshots reveal systematic growth of identifiable live object
classes whose owner and upper bound remain unknown. This is evidence to inspect,
not proof of a production leak. One blocker: establish ownership and boundedness
of the growing snapshot groups, especially ResourceData / Kt. Recommended next:
**GPT-6.1 Sol · High — heap snapshot / retaining-path root-cause task**. No
R150/R200 run and no speculative cleanup were performed. MODULE 02 not started.

## Ownership closure — ResourceData / Kt (2026-10-31)

**PASS. MODULE 01 — Stability & Long-session Hardening завершён в проверенном
локальном Chromium/native-runtime scope.** Этот вывод заменяет прежний
inconclusive verdict: обе оставшиеся группы получили конкретного владельца.
Новый soak не запускался; production code не менялся.

### blink::NetworkResourcesData::ResourceData

R100 snapshot strong retaining path (P1/P2): C++ Persistent roots →
v8_inspector::V8InspectorSessionImpl → blink::DevToolsSession → InspectorNetworkAgent
→ NetworkResourcesData → request_id_to_resource_data_map_ backing → ResourceData.
Найденный owner — Chromium/Blink DevTools network agent, активированный средствами
Playwright/CDP. Это не ссылка из React/store/application fetch cache.

Chromium source ResourceCreated создаёт запись на request ID и сохраняет requested
URL/loader ID; типы включают fetch/XHR/document/script и другие network resources.
В snapshots строковые URL скрыты внутри native fields, поэтому точный список
соответствий каждому старому request ID из них восстановить нельзя. По source и
адресному тесту установлено: счётчик отслеживает network records, а не длину
Performance Resource Timing buffer. Harness использует fetch для API и обычные
asset requests; оба типа попадают под этот agent.

Boundedness нужно формулировать точно: content buffers имеют byte limits, но это
НЕ обещание фиксированного лимита количества metadata ResourceData. Их число
может расти в пределах включённой inspection session. Network.disable очищает
agent resources_data_; закрытие diagnostic session также снимает владельца.
Значит, это lifetime диагностического agent, не доказанный application leak.
Production issue: **no**; подменять это искусственной очисткой приложения нельзя.

Адресная проверка без аккаунтов, на intercepted synthetic page: до запросов 1
ResourceData; после 80 fetch — 163 (участвуют два network agents, включая
Playwright). performance.clearResourceTimings: всё ещё 163. Network.disable на
нашем отдельном CDP session: 82. Ушли 81 запись именно этого agent; оставшиеся
принадлежат другому Playwright agent, browser/context затем закрыт. Raw snapshots
этой проверки существовали только в памяти и не сохранялись.

Primary Chromium sources (source revision может отличаться от установленного
Chrome; локальный тест подтверждает ключевую disable/clear семантику):

- https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/inspector/network_resources_data.cc
- https://chromium.googlesource.com/chromium/src/+/494419358caf690316f160a1f27d9e771a14c033/third_party/blink/renderer/core/inspector/inspector_network_agent.cc

### Kt = PixiJS TextStyle

Constructor в public/build/assets/TabletopRenderer-KuWXkYHr.js:
class Kt extends St, uid("textStyle"), font/fill/stroke fields. Это соответствует
установленному Pixi TextStyle и полям snapshot (_fontFamily, _fontSize, _fill,
_cachedFontString и т.д.), а не заключение по одному минифицированному имени.

Активные экземпляры имеют обычный путь TabletopRenderer.tokens → TokenView.badges
(Pixi Text) → _style → Kt. Путь поздних удерживаемых экземпляров:
rAF/module context → CanvasTextMetrics (minified R/Bt) → _measurementCache →
tiny-lru (Gu) → items[text + styleKey + wordWrap] → value (CanvasTextMetrics)
→ style → Kt. Snapshot keys включают damage feedback text (например −11).
Новый measurement сохраняет style внутри результата; он живёт до cache eviction.
Это не очередь подписок или неосвобождённый Text display object.

Installed source: node_modules/pixi.js/lib/scene/text/canvas/CanvasTextMetrics.mjs,
measureText key/cache lookup и _measurementCache = lru(1e3). Owner — статический
Pixi measurement LRU; entry limit 1000. Смена чисел/стилей в feedback постепенно
наполняет cache. Удаление текста со сцены не обязано удалять reusable measurement.

Проверка реального установленного CanvasTextMetrics.measureText и TextStyle,
с минимальным canvas-measure shim (GPU/rendering не тестировались): 2200 уникальных
измерений, sizes после 500/1000/1500/2200 — 500/1000/1000/1000; самая старая
запись вытеснена. Рост Kt 124→174→224 в R50/R75/R100 происходит существенно ниже
этой границы. Upper bound по entries подтверждён, объём entry зависит от текста.
Production issue: **no**; ownership/lifecycle корректны, исправление не требуется.

### Evidence, changes, verdict

- Sanitized retaining-path evidence: artifacts/tech02/2026-10-31T14-01-16-091Z/ownership.json.
- Проверка boundedness/agent lifetime: artifacts/tech02/targeted-ownership-verification.json.
- Вспомогательные read-only analysis / isolated verification scripts лежат в
  ignored artifacts/tech02/. Исходные приватные snapshots не публикуются.
- Production changes: none. Текущая задача изменяет только этот отчёт;
  прежние TECH-01/harness изменения сохранены.
- Автотесты приложения не перезапускались: код приложения не менялся; выполнены
  адресные assertions для cache capacity/eviction и Network agent cleanup.

Доказанного application accumulating retention в этих двух группах нет.
ResourceData показывает profiling-session retention; Kt — bounded library cache.
Это согласуется с убывающими late slopes и стабильными DOM/listeners/Pixi/dice/
realtime в уже выполненных 100 rounds. Идеально нулевой heap delta не требуется.
**MODULE 01 можно закрыть; в этом отчёте он зафиксирован как завершённый.**
Внешний Development Control Center не редактировался. MODULE 02 не начинался.
