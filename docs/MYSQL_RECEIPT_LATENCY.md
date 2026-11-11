# Диагностика задержек receipts — 11 ноября 2026

Статус: **промежуточное исследование завершено по указанию пользователя**.
Конкретная первопричина ожидания внутри Windows/InnoDB не доказана. Доказанного
исправления нет; production-код idempotency и постоянная конфигурация не менялись.

**Подтверждено отдельным файловым тестом:** проблема воспроизводится без MySQL.
500 операций по 4 КиБ, WriteThrough + Flush(true), 5 чередующихся серий:
диск C — p50 0,581 / p95 73,008 / max 1601,834 мс; диск B —
p50 15,757 / p95 25,757 / max 75,738 мс. Это локализует длинный хвост в
Windows/storage path диска C. Точный вклад SSD firmware, драйвера и фильтров
не установлен; называть диск физически неисправным по этим данным нельзя.
Но проверка всей цепочки на B не дала улучшения; перенос рабочей БД не рекомендован
как доказанное исправление. Рабочие данные не перемещались.

## Итог проверки C → B

Одна версия и бинарник MySQL 8.0.30, buffer pool 256 МиБ, redo 64 МиБ,
unbuffered, flush-log-at-commit=1, sync-binlog=1, log-writer-threads=ON.
Для обеих серий — port 3308, production build `app-BSoqJij9.js`, Chrome 157,
GM + Player, Scene 10, 75 props + 2 токена, zoom 0,8, added RTT 250 мс,
по 10 WASD (1,4 с) и 10 drag (220 units). Во время замеров нет trace, build,
импорта или параллельного синтетического I/O-теста.

B — холодная копия контрольной БД C после полного выхода server/supervisor.
SHA256 `scene_mutation_receipts.ibd`, `tokens.ibd`, `scenes.ibd` совпали.
Состояние сцены и позиции между сериями восстановлены. Служебные receipts/revisions
пополнялись при выполнении C-серии, поэтому начальные БД двух серий не называются
побайтово идентичными до выполнения этих команд. Геометрия, роли, lighting/vision,
камера и сценарий совпадают. Это малая серия для редких хвостов, не гарантия p99.

| Метрика                                        |             C, SSD |              B, HDD |
| ---------------------------------------------- | -----------------: | ------------------: |
| Успешных movement-ответов с Server-Timing      |                 37 |                  33 |
| Receipt INSERT p50 / p95 / max, мс             | 0,26 / 0,36 / 0,36 | 0,26 / 0,35 / 71,02 |
| Laravel movement p95 / max, мс                 |      226,5 / 233,2 |       280,2 / 521,5 |
| SQL aggregate p95 / max, мс                    |        51,6 / 55,3 |       118,3 / 387,3 |
| Commit + callbacks p95 / max, мс               |        17,0 / 33,9 |         25,7 / 65,6 |
| Drag fetch p50 / p95, включая added RTT, мс    |      447,5 / 472,4 |       447,5 / 994,4 |
| Pointer-up → playback p95, мс                  |              490,1 |              1415,2 |
| Прерванных HTTP control/step                   |                  1 |                   3 |
| WASD с расстоянием <240 units за сценарий      |               1/10 |                5/10 |
| Наибольший p95 кадра по прогонам GM/Player, мс |                8,6 |                 8,6 |
| Long tasks ≥50 мс                              |                  0 |                   0 |

Все 10 drag на каждом диске завершились. В конце samples расхождение GM/Player и
canonical/presentation равно 0; это не отменяет остановки/коррекции WASD.
`restored=true`, browser exceptions=[] в обеих сериях. FPS около 120.
Aborted запросы без ответа не входят в Server-Timing aggregates: оценивать только
успешные ответы было бы неверно, поэтому остановки приведены отдельно.

Исходные данные: [сводка C/B](../artifacts/map-engine-performance/receipt-disk-comparison.json),
[покадровая сводка](../artifacts/map-engine-performance/receipt-disk-motion-summary.json),
`receipt-disk-c-control-250/`, `receipt-disk-b-250/`, `receipt-cold-copy-parity.json`,
`receipt-flush-probe.json` в `artifacts/map-engine-performance/`.

## Вывод и рекомендации

**Точно установлены** редкие длинные SQL/commit ожидания, независимость проблемы
от браузерного frame budget и нестабильные синхронные записи на C. Обычная вставка
receipt занимает доли миллисекунды, потому отсутствие необходимого индекса или
обычная алгоритмическая стоимость INSERT не объясняют секундные выбросы.

**Наиболее вероятна** комбинация ожиданий I/O/служебных страниц InnoDB и задержек
локального Windows runtime. Однопоточный PHP HTTP listener дополнительно
сериализует обращения GM/Player; время за пределами Laravel нельзя автоматически
назвать чистым MySQL wait. Исследование не установило конкретный драйвер, firmware,
фильтр или latch, отвечающий за исходные 1625 мс. Считать C единственной причиной
после результата B нельзя. Физическая неисправность SSD и вина Defender не доказаны.

**Локальное окружение:** отдельно проверить здоровье/firmware накопителя и драйверы,
выбирать хранилище по стабильности flush под реальной нагрузкой. B в данном опыте
не подтвердил исправление; автоматический переезд туда не предлагается. Отдельно
можно согласовать сравнение полноценного concurrent HTTP runtime с built-in PHP.
Это рекомендации для следующего согласованного этапа, не выполненные изменения.

**Код YTT:** основания менять production idempotency, транзакции, unique keys,
права, фильтрацию видимости или ослаблять durability не получены. Преждевременный
patch скроет симптом либо создаст риск повторного выполнения команды. Новые правки
этого этапа относятся к диагностике/QA и отчёту. Ранее реализованные изменения
движения/обзора сохранены.

**Восстановление:** исходный native MySQL 8.0.30 снова работает на 3306 с исходным
datadir, `unbuffered`, log-writer-threads=ON, flush-log-at-commit=1, sync-binlog=1,
Performance Schema=OFF. App 8090 и Reverb 8085 запущены на исходной БД;
тестовые порты 3307/3308 закрыты, WPR не пишет. `.env`, `my.ini`, persisted variables,
launcher и queue configuration постоянно не изменялись. Результаты сохранены
локально, приватные дампы/ETL не публикуются и не отслеживаются Git.
Проверка восстановления сохранена в `receipt-restored-source-db.json`,
`receipt-restoration-health.json`, `receipt-restoration-check.json`:
исходный endpoint, состав сцены и позиция последней source fixture совпали.

Ниже сохранён ход проверки гипотез и дополнительные ограничения измерений.

## Воспроизведение

Native MySQL 8.0.30, PHP 8.3, production `app-BSoqJij9.js`. Scene 10 «Лесная
таверна», 75 props, GM + Player, added RTT 250 мс. По 10 WASD и 10 drag в серии.
Сцена, grid, active scene и fog memory восстановлены. Сборки приложения между
сериями не менялись. RTT добавлен к fetch, это не TCP traffic shaping.

| Метрика, мс                          |   ON, исходная серия |   OFF, эксперимент | ON, контрольный возврат |
| ------------------------------------ | -------------------: | -----------------: | ----------------------: |
| Receipt INSERT p50 / p95 / max       | 0,27 / 0,36 / 752,16 | 0,28 / 0,37 / 0,86 |      0,26 / 0,36 / 0,37 |
| Laravel movement p95 / max           |        417,8 / 947,0 |      212,5 / 233,6 |           222,0 / 231,4 |
| Drag response p95, включая added RTT |               1214,0 |              460,5 |                   495,4 |
| Drag playback start p95              |               1232,1 |              473,6 |                   515,2 |
| Наибольший p95 кадра GM/Player       |                  8,7 |                8,6 |                     8,6 |

Исходная серия включала два неудачных WASD старта/движения при серверных паузах;
они сохранены. Агрегаты SQL относятся к завершённым movement-ответам: n=35/42/40.
Timeout без ответа в них не входит. Медленный drag локализован в
`insert ignore into scene_mutation_receipts`: 752,16 из 797,78 мс SQL.

Возврат ON тоже оказался быстрым. Следовательно, `innodb_log_writer_threads=OFF`
**не доказан как исправление**; исходное ON восстановлено, SET PERSIST не применялся.
Изолированные серии 1000 rollback INSERT: ON max 1413 мс, OFF max 11 мс,
повторный ON max 12,8 мс. Это также исключает уверенный вывод по одному A/B.

Проверены также 5 пар штатных запусков с `innodb_flush_method=unbuffered/normal`,
по 100 rollback-вставок. Максимумы по парам: unbuffered 74,8 / 926,7 / 1797,3 /
78,1 / 80,2 мс; normal 74,5 / 1139,1 / 748,8 / 70,5 / 70,3 мс.
Buffered I/O проблему не устраняет; постоянно настройка не сохранялась.

MySQL 8.0.46 проверен только на изолированной копии, порт 3307, тот же SSD C,
тот же production build и 20 GM/Player сценариев. Receipt INSERT max 8,31 мс,
но commit/callbacks max 396,37 мс, SQL max 209,03 мс; перенос ожидания на commit
не является устранением длинного хвоста. Import создавал дополнительную нагрузку,
поэтому это диагностическая серия, не доказательство ускорения новой версии.
Упомянутый в [8.0.40](https://dev.mysql.com/doc/relnotes/mysql/8.0/en/news-8-0-40.html)
Windows doublewrite fix (Bug #36259487) сам по себе не доказывает причину данного
эпизода. Обновление оригинального datadir не выполнялось.

## Что уже установлено

- MySQL подтвердил медленный Execute (до 1833 мс), а не только PHP/PDO timer.
- Row lock waits/time = 0, buffer pool wait free = 0, log buffer waits = 0.
- Redo capacity 64 МиБ; свободно около 59 МиБ, ожиданий file-space не обнаружено.
- MySQL process CPU priority Normal, I/O priority 2 (normal), power throttling off;
  свободно примерно 11 ГиБ физической памяти. Причина не установлена как RAM shortage.
- Вне браузера обычная rollback-вставка воспроизводит задержку. LOS, React, HTTP и
  realtime для её появления не нужны.
- ETW `receipt-thread-waits-app`: 14 вставок, последняя 195,326 мс; OS thread 11024.
  Без потери событий. Поток в состоянии Wait 71,143 + 123,412 мс; CPU работы в
  этих интервалах нет. В тех же интервалах диск 1 выполнял записи по 70–133 мс.
  Это корреляция, ещё не имя конкретного виновного latch/драйвера.
- FileIO-профиль без потерь: flush `ibdata1`, `mysql.ibd`, записи redo занимают
  100–229 мс. Требуется отделить ожидание устройства от внутренних зависимостей InnoDB.
- Наличие событий AMFilter и I/O процесса MsMpEng само по себе **не доказывает**,
  что антивирус вызывает медленный receipt. Исключения/отключения защиты не применялись.
- Первый тяжёлый CPU/DiskIO trace потерял события и дал пробу 6,14 с; он исключён
  из сравнительных выводов из-за неполной записи и нагрузки профайлера.

## Безопасность и проверки

Контракт приложения, unique(user_id, client_mutation_id), fingerprint, транзакции,
writer locks, receipt retention, проверки ролей и серверная видимость не менялись.
`innodb_flush_log_at_trx_commit=1`, doublewrite и sync_binlog не ослаблялись.

23 SQLite tests / 222 assertions: MultiplayerTest, DirectControlTest прошли.
Live `receipt-idempotency-pass-250`: два перекрывающихся одинаковых запроса дают
одну revision и один replay; другой payload с тем же UUID получает 409; после
блокировки токена старый receipt отклоняется. JSON geometry сравнивается с допуском
1e-8 для численного round-trip MySQL. `restored=true`, browser errors=[];
Windows PHP built-in server сериализует HTTP, поэтому это не доказательство
конкурентной работы двух PHP workers.

## Инструменты и данные

Локальные артефакты `artifacts/map-engine-performance/receipt-*` игнорируются Git.
Приватные ETL не предназначены для публикации. Из ETW экспортируются только
диагностические поля, SQL bindings/credentials не экспортируются.

- `receipt-diagnostics.php`: local-only counters, waits, rollback probe;
  `--local-admin` использует отдельное operator connection, права приложения не
  расширяются. Rollback probe не сохраняет receipts; auto_increment может вырасти.
- `receipt-summary.cjs`: воспроизводит таблицу из browser JSON и performance.jsonl.
- `receipt-system-profile.ps1` и `receipt-waits.wprp`: согласованный UAC-сбор;
  128 МиБ кольцевых буферов, stop после первой вставки >100 мс, максимум 10 000.
- `read-receipt-etw.ps1`: Microsoft TraceEvent 3.1.21 из временных artifacts;
  зависимости проекта не меняются. Для CSwitch нужно передавать OS thread ID:
  process rundown может приходить после измеряемых событий.

Методика MySQL: [Performance Schema history](https://dev.mysql.com/doc/refman/8.0/en/performance-schema-events-statements-history-long-table.html),
[настройки InnoDB и latch monitor](https://docs.oracle.com/cd/E17952_01/mysql-8.0-en/innodb-parameters.html).
