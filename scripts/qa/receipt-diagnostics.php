<?php

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

// Local diagnostics only. No query bindings, credentials or row payloads are exported.
require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
abort_unless(app()->environment('local'), 403);
$db = DB::connection();
// Explicit local operator connection; never grant Performance Schema to the app user.
if (in_array('--local-admin', $argv, true)) {
    $config = $db->getConfig();
    $config['username'] = 'root';
    $config['password'] = '';
    Config::set('database.connections.receipt_diagnostics', $config);
    $db = DB::connection('receipt_diagnostics');
}
$mode = $argv[1] ?? 'snapshot';
if ($mode === 'shutdown') {
    abort_unless(in_array('--local-admin', $argv, true), 403);
    $db->unprepared('SHUTDOWN');
    exit;
}
if ($mode === 'metrics-enable') {
    $db->statement("SET GLOBAL innodb_monitor_enable = 'module_log'");
}
if ($mode === 'latch-enable') {
    $db->statement("SET GLOBAL innodb_monitor_enable = 'latch'");
}
if ($mode === 'queue-probe') {
    abort_unless(in_array('--local-admin', $argv, true), 403);
    $state = function () use ($db) {
        $status = $db->selectOne("SHOW GLOBAL STATUS LIKE 'Innodb_log_write_requests'");
        preg_match('/Trx id counter (\d+)/', $db->select('SHOW ENGINE INNODB STATUS')[0]->Status, $match);

        return ['redoRequests' => (int) $status->Value, 'trxId' => (int) ($match[1] ?? 0)];
    };
    $queue = app('queue')->connection('tabletop');
    $before = $state();
    $start = hrtime(true);
    for ($i = 0; $i < 1000; $i++) {
        abort_if($queue->pop('qa-empty-receipt-diagnostic') !== null, 500);
    }
    $report = ['before' => $before, 'after' => $state(), 'ms' => (hrtime(true) - $start) / 1e6];
    file_put_contents($argv[2], json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
    echo json_encode($report).PHP_EOL;
    exit;
}
if ($mode === 'boundary-probe') {
    abort_unless(in_array('--local-admin', $argv, true), 403);
    $counter = function () use ($db) {
        preg_match('/Trx id counter (\d+)/', $db->select('SHOW ENGINE INNODB STATUS')[0]->Status, $match);

        return (int) $match[1];
    };
    $queue = app('queue')->connection('tabletop');
    $connection = DB::connection();
    $rows = [];
    for ($i = 0; $i < 80; $i++) {
        $id = $counter();
        for ($n = (256 - ($id % 256)) % 256; $n > 0; $n--) {
            abort_if($queue->pop('qa-empty-receipt-diagnostic') !== null, 500);
        }
        foreach (['boundary', 'next'] as $kind) {
            $id = $counter();
            $connection->beginTransaction();
            try {
                $start = hrtime(true);
                $connection->table('scene_mutation_receipts')->insertOrIgnore([
                    'user_id' => 1, 'campaign_id' => 5, 'client_mutation_id' => (string) Str::uuid(),
                    'fingerprint' => str_repeat('0', 64), 'operation' => 'qa.rollback', 'resource_id' => 10,
                    'created_at' => now(), 'updated_at' => now(),
                ]);
                $rows[] = ['kind' => $kind, 'trxId' => $id, 'ms' => (hrtime(true) - $start) / 1e6];
            } finally {
                $connection->rollBack();
            }
        }
    }
    file_put_contents($argv[2], json_encode($rows, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
    exit;
}
if (in_array($mode, ['writer-off', 'writer-on'], true)) {
    abort_unless(in_array('--local-admin', $argv, true), 403);
    $db->statement('SET GLOBAL innodb_log_writer_threads = '.($mode === 'writer-off' ? 'OFF' : 'ON'));
}
if ($mode === 'enable') {
    $db->statement("UPDATE performance_schema.setup_consumers SET ENABLED='YES' WHERE NAME IN ('events_statements_current','events_statements_history_long','events_waits_current','events_waits_history_long')");
    $db->statement("UPDATE performance_schema.setup_instruments SET ENABLED='YES', TIMED='YES' WHERE NAME LIKE 'wait/io/file/innodb/%'");
    $db->statement("UPDATE performance_schema.setup_instruments SET ENABLED='YES', TIMED='YES' WHERE NAME LIKE 'wait/synch/%/innodb/%'");
}
if ($mode === 'watch') {
    $seen = [];
    for ($i = 0; $i < 1800; $i++) {
        foreach ($db->select("SELECT THREAD_ID, EVENT_ID, NESTING_EVENT_ID, EVENT_NAME, OPERATION, ROUND(TIMER_WAIT/1e9,3) ms FROM performance_schema.events_waits_history_long WHERE TIMER_WAIT>50000000000 AND EVENT_NAME NOT LIKE 'idle%' AND EVENT_NAME NOT LIKE 'wait/io/socket/%'") as $row) {
            $seen[$row->THREAD_ID.':'.$row->EVENT_ID] = $row;
        }
        foreach ($db->select("SELECT t.THREAD_ID, e.EVENT_ID, t.PROCESSLIST_STATE state, ROUND(e.TIMER_WAIT/1e9,3) ms, p.SQL_TEXT template, w.EVENT_NAME waitEvent, ROUND(w.TIMER_WAIT/1e9,3) waitMs FROM performance_schema.threads t JOIN performance_schema.events_statements_current e ON e.THREAD_ID=t.THREAD_ID LEFT JOIN performance_schema.prepared_statements_instances p ON p.OWNER_THREAD_ID=t.THREAD_ID LEFT JOIN performance_schema.events_waits_current w ON w.THREAD_ID=t.THREAD_ID WHERE t.PROCESSLIST_DB=DATABASE() AND e.END_EVENT_ID IS NULL AND t.PROCESSLIST_COMMAND<>'Sleep' AND t.PROCESSLIST_ID<>CONNECTION_ID()") as $row) {
            $row->template = preg_replace(["/'(?:''|[^'])*'/", '/\\b[0-9]+\\b/'], '?', $row->template ?? '');
            $key = 'current:'.$row->THREAD_ID.':'.$row->EVENT_ID;
            $row->firstSeen = $seen[$key]->firstSeen ?? microtime(true);
            $row->observedMs = (microtime(true) - $row->firstSeen) * 1000;
            $seen[$key] = $row;
        }
        file_put_contents($argv[2], json_encode(array_values($seen), JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
        usleep(50000);
    }
    exit;
}
if ($mode === 'probe') {
    $times = [];
    $timeline = [];
    $admin = $db;
    $db = DB::connection();
    $connectionId = $db->selectOne('SELECT CONNECTION_ID() id')->id;
    $osThread = in_array('--local-admin', $argv, true) ? $admin->selectOne('SELECT THREAD_OS_ID id FROM performance_schema.threads WHERE PROCESSLIST_ID=?', [$connectionId])->id : null;
    $limit = (int) getenv('YTT_RECEIPT_MAX') ?: 1000;
    $latchesBefore = in_array('--local-admin', $argv, true) ? $admin->select('SHOW ENGINE INNODB MUTEX') : [];
    for ($i = 0; $i < $limit; $i++) {
        $db->beginTransaction();
        try {
            $start = hrtime(true);
            $began = microtime(true);
            $db->table('scene_mutation_receipts')->insertOrIgnore([
                'user_id' => 1, 'campaign_id' => 5, 'client_mutation_id' => (string) Str::uuid(),
                'fingerprint' => str_repeat('0', 64), 'operation' => 'qa.rollback', 'resource_id' => 10,
                'created_at' => now(), 'updated_at' => now(),
            ]);
            $times[] = (hrtime(true) - $start) / 1e6;
            $timeline[] = ['began' => $began, 'ms' => end($times), 'thread' => $osThread];
        } finally {
            $db->rollBack();
        }
        if (($stopMs = (float) getenv('YTT_RECEIPT_STOP_MS')) > 0 && end($times) > $stopMs) {
            break;
        }
        usleep(20000);
    }
    file_put_contents($argv[2], json_encode($times, JSON_THROW_ON_ERROR));
    file_put_contents($argv[2].'.timeline.json', json_encode($timeline, JSON_THROW_ON_ERROR));
    if ($latchesBefore) {
        file_put_contents($argv[2].'.latches.json', json_encode(['before' => $latchesBefore, 'after' => $admin->select('SHOW ENGINE INNODB MUTEX')], JSON_THROW_ON_ERROR));
    }
    sort($times);
    echo json_encode(['n' => count($times), 'p50' => $times[(int) floor(count($times) * .5)], 'p95' => $times[(int) floor(count($times) * .95)], 'max' => max($times)]).PHP_EOL;
    exit;
}
$report = [];
$queries = [
    'consumers' => 'SELECT * FROM performance_schema.setup_consumers',
    'instruments' => "SELECT NAME, ENABLED, TIMED FROM performance_schema.setup_instruments WHERE NAME IN ('statement/sql/insert','statement/sql/select','wait/io/file/innodb/innodb_log_file')",
    'historyCount' => 'SELECT COUNT(*) n FROM performance_schema.events_statements_history_long',
    'instrumentationLimits' => "SHOW GLOBAL VARIABLES WHERE Variable_name IN ('performance_schema_max_sql_text_length','performance_schema_max_prepared_statements_instances')",
    'statementKinds' => 'SELECT EVENT_NAME,COUNT(*) n, ROUND(MAX(TIMER_WAIT)/1e9,3) maxMs FROM performance_schema.events_statements_history_long GROUP BY EVENT_NAME',
    'slowPrepared' => "SELECT e.THREAD_ID, e.EVENT_ID, ROUND(e.TIMER_WAIT/1e9,3) ms, (SELECT p.SQL_TEXT FROM performance_schema.events_statements_history_long p WHERE p.THREAD_ID=e.THREAD_ID AND p.EVENT_ID<e.EVENT_ID AND p.EVENT_NAME='statement/com/Prepare' ORDER BY p.EVENT_ID DESC LIMIT 1) template FROM performance_schema.events_statements_history_long e WHERE e.EVENT_NAME='statement/com/Execute' AND e.TIMER_WAIT>20000000000 ORDER BY e.TIMER_START DESC LIMIT 30",
    'slowWaits' => "SELECT THREAD_ID, EVENT_ID, NESTING_EVENT_ID, NESTING_EVENT_TYPE, EVENT_NAME, OPERATION, ROUND(TIMER_WAIT/1e9,3) ms FROM performance_schema.events_waits_history_long WHERE TIMER_WAIT>100000000000 AND EVENT_NAME NOT LIKE 'idle%' ORDER BY TIMER_START DESC LIMIT 50",
    'variables' => "SHOW GLOBAL VARIABLES WHERE Variable_name IN ('version','port','datadir','performance_schema','innodb_buffer_pool_size','innodb_log_file_size','innodb_flush_log_at_trx_commit','sync_binlog','log_bin','innodb_flush_method','innodb_io_capacity','innodb_autoinc_lock_mode','innodb_log_writer_threads')",
    'status' => "SHOW GLOBAL STATUS WHERE Variable_name IN ('Innodb_log_waits','Innodb_log_writes','Innodb_os_log_fsyncs','Innodb_buffer_pool_wait_free','Innodb_buffer_pool_reads','Innodb_row_lock_waits','Innodb_row_lock_time','Innodb_data_fsyncs','Innodb_data_pending_fsyncs','Innodb_redo_log_current_lsn','Innodb_redo_log_checkpoint_lsn','Innodb_redo_log_capacity_resized')",
    'slowStatements' => 'SELECT THREAD_ID, EVENT_ID, EVENT_NAME, ROUND(TIMER_WAIT/1e9,3) ms, ROUND(LOCK_TIME/1e9,3) lockMs, DIGEST_TEXT, MYSQL_ERRNO FROM performance_schema.events_statements_history_long WHERE TIMER_WAIT>50000000000 ORDER BY TIMER_START DESC LIMIT 60',
    'fileWaits' => "SELECT EVENT_NAME, COUNT_STAR, ROUND(SUM_TIMER_WAIT/1e9,3) totalMs, ROUND(MAX_TIMER_WAIT/1e9,3) maxMs FROM performance_schema.events_waits_summary_global_by_event_name WHERE EVENT_NAME LIKE 'wait/io/file/innodb/%'",
    'recentFileWaits' => "SELECT THREAD_ID, EVENT_ID, NESTING_EVENT_ID, NESTING_EVENT_TYPE, EVENT_NAME, OPERATION, ROUND(TIMER_WAIT/1e9,3) ms FROM performance_schema.events_waits_history_long WHERE EVENT_NAME LIKE 'wait/io/file/innodb/%' AND TIMER_WAIT>50000000000 ORDER BY TIMER_START DESC LIMIT 60",
    'locks' => 'SELECT * FROM performance_schema.data_lock_waits',
    'receipts' => 'SELECT COUNT(*) n, MIN(created_at) oldest, MAX(created_at) newest FROM scene_mutation_receipts',
    'tableSize' => "SELECT TABLE_NAME, DATA_LENGTH, INDEX_LENGTH, DATA_FREE, AVG_ROW_LENGTH FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('scene_mutation_receipts','jobs')",
    'innodbMetrics' => "SELECT NAME, COUNT, STATUS FROM information_schema.INNODB_METRICS WHERE NAME LIKE 'log_%' OR NAME LIKE 'buffer_pool_wait%'",
    'latches' => 'SHOW ENGINE INNODB MUTEX',
    'probeProgress' => "SELECT t.THREAD_ID,t.THREAD_OS_ID,t.PROCESSLIST_COMMAND,t.PROCESSLIST_TIME,s.VARIABLE_VALUE executes FROM performance_schema.threads t LEFT JOIN performance_schema.status_by_thread s ON s.THREAD_ID=t.THREAD_ID AND s.VARIABLE_NAME='COM_STMT_EXECUTE' WHERE t.PROCESSLIST_DB=DATABASE()",
    'persistedIo' => "SELECT VARIABLE_NAME,VARIABLE_VALUE FROM performance_schema.persisted_variables WHERE VARIABLE_NAME='innodb_flush_method'",
    'receiptStatements' => "SELECT THREAD_ID, EVENT_ID, ROUND(TIMER_WAIT/1e9,3) ms, ROUND(LOCK_TIME/1e9,3) lockMs, DIGEST_TEXT FROM performance_schema.events_statements_history_long WHERE CURRENT_SCHEMA=DATABASE() AND (DIGEST_TEXT LIKE '%scene_mutation_receipts%' OR EVENT_NAME='statement/sql/commit') ORDER BY TIMER_WAIT DESC LIMIT 25",
];
foreach ($queries as $key => $sql) {
    $report[$key] = $db->select($sql);
}
foreach ($report['slowPrepared'] as $row) {
    $row->template = preg_replace(["/'(?:''|[^'])*'/", '/\\b[0-9]+\\b/'], '?', $row->template ?? '');
}
$path = $argv[2] ?? 'artifacts/map-engine-performance/receipt-diagnostics.json';
file_put_contents($path, json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
echo json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;
