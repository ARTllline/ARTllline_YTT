<?php

use Illuminate\Contracts\Console\Kernel;

// Disposable native MySQL QA only. Dumps and client errors are private, ignored files.
require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
abort_unless(app()->environment('local'), 403);
$config = config('database.connections.mysql');
$root = realpath(__DIR__.'/../../artifacts/receipt-mysql-runtime');
$dump = $root.'/ytt.private.sql';
$run = function (array $command, array $descriptors, array $env = []) {
    $process = proc_open($command, $descriptors, $pipes, base_path(), array_merge(getenv(), $env), ['bypass_shell' => true]);
    abort_unless(is_resource($process) && proc_close($process) === 0, 500, 'Private database tool failed; inspect ignored client error file.');
};
if (($argv[1] ?? '') === 'dump') {
    abort_unless((int) $config['port'] === 3306, 500, 'Dump must target original database.');
    $run(['C:/OSPanel/modules/database/MySQL-8.0-Win10/bin/mysqldump.exe',
        '--host=127.0.0.1', '--port=3306', '--user='.$config['username'], '--single-transaction', '--no-tablespaces', '--set-gtid-purged=OFF', '--skip-comments',
        '--result-file='.$dump, '--databases', $config['database']],
        [0 => ['pipe', 'r'], 1 => ['file', $root.'/dump.private.log', 'w'], 2 => ['file', $root.'/dump-error.private.log', 'w']], ['MYSQL_PWD' => $config['password']]);
    echo "Private consistent dump completed.\n";
    exit;
}
abort_unless(($argv[1] ?? '') === 'import' && is_file($dump), 400);
$binary = $root.'/mysql-8.0.46-winx64/bin/mysql.exe';
$port = (int) ($argv[2] ?? 3307);
abort_unless(in_array($port, [3307, 3308, 3309], true), 400, 'Only disposable ports are permitted.');
$run([$binary, '--host=127.0.0.1', '--port='.$port, '--user=root', '--binary-mode', '--default-character-set=utf8mb4'],
    [0 => ['file', $dump, 'r'], 1 => ['file', $root.'/import.private.log', 'w'], 2 => ['file', $root.'/import-error.private.log', 'w']], ['MYSQL_PWD' => '']);
$pdo = new PDO('mysql:host=127.0.0.1;port='.$port.';charset=utf8mb4', 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
abort_unless(preg_match('/^[a-zA-Z0-9_]+$/', $config['database']), 500);
$account = $pdo->quote($config['username'])."@'localhost'";
$pdo->exec('CREATE USER IF NOT EXISTS '.$account.' IDENTIFIED BY '.$pdo->quote($config['password']));
$pdo->exec('GRANT ALL PRIVILEGES ON `'.$config['database'].'`.* TO '.$account);
echo "Disposable clone imported; application account scoped to copied database.\n";
