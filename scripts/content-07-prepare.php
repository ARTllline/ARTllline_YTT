<?php

/** Read-only preparation evidence; no import, approval, migration or runtime branch. */
use App\Compendium\Unified\UnifiedBatchPreparation;
use App\Compendium\Unified\UnifiedPilotImport;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if (count($argv) !== 4 || ! $app->environment('local') || DB::connection()->getDriverName() !== 'mysql') {
    throw new RuntimeException('Usage: php -d memory_limit=1024M scripts/content-07-prepare.php source-root new-output new-evidence.json (local MySQL, SELECT only)');
}
DB::connection()->beforeExecuting(function ($sql) {
    if (! preg_match('/^select\s/i', ltrim($sql))) {
        throw new RuntimeException('Preparation refuses all non-SELECT statements.');
    }
});
$fingerprints = function (): array {
    $tables = DB::select('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = ?', ['BASE TABLE']);
    $result = [];
    foreach ($tables as $table) {
        $hashes = [];
        foreach (DB::table($table->name)->cursor() as $row) {
            $hashes[] = hash('sha256', json_encode($row, JSON_THROW_ON_ERROR));
        }
        sort($hashes);
        $result[$table->name] = ['rows' => count($hashes), 'sha256' => hash('sha256', implode('', $hashes))];
    }
    ksort($result);

    return $result;
};
$files = function () use ($argv): array {
    $paths = [...glob($argv[1].'/data/*.js'), ...glob(resource_path('data/content/srd-2024-batch-01/*')), base_path('docs/CONTENT_06_APPROVAL.html')];
    $result = [];
    foreach ($paths as $path) {
        if (is_file($path)) {
            $result[str_replace('\\', '/', $path)] = hash_file('sha256', $path);
        }
    }
    ksort($result);

    return $result;
};
$before = $fingerprints();
$sourceBefore = $files();
$bundle = app(UnifiedBatchPreparation::class)->prepare($argv[1], $argv[2],
    [...array_keys(UnifiedPilotImport::ENTRIES), 'srd:magic_item:bag-of-holding:2024', 'srd:spell:wish:2024'],
    false, [], true, resource_path('data/content/srd-2024-batch-01/review.json'));
$after = $fingerprints();
$sourceAfter = $files();
$evidence = ['bundle_checksum' => $bundle['bundle_checksum'], 'database_writes' => 0,
    'tables_identical' => $before === $after, 'source_and_prior_batch_identical' => $sourceBefore === $sourceAfter,
    'table_fingerprints_before' => $before, 'table_fingerprints_after' => $after,
    'source_and_prior_batch_hashes' => $sourceBefore,
    'selected' => $bundle['selected'], 'counts' => $bundle['counts'], 'reused_screening_count' => $bundle['reused_screening_count'],
    'human_approvals' => 0, 'execute' => false, 'import_authorized' => false];
app(UnifiedBatchPreparation::class)->write($argv[3], $evidence);
if ($before !== $after || $sourceBefore !== $sourceAfter) {
    throw new RuntimeException('Concurrent state/source drift: inspect evidence before any decision.');
}
echo json_encode(array_intersect_key($evidence, array_flip(['selected', 'counts', 'reused_screening_count', 'tables_identical', 'source_and_prior_batch_identical', 'bundle_checksum'])), JSON_THROW_ON_ERROR).PHP_EOL;
