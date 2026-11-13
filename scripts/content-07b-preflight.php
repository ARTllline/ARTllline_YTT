<?php

use App\Compendium\Unified\UnifiedBatchPreparation;
use App\Compendium\Unified\UnifiedBulkImportPermit;
use App\Compendium\Unified\UnifiedDryRun;
use App\Compendium\Unified\UnifiedJson;
use App\Compendium\Unified\UnifiedReview;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
require base_path('artifacts/content-fix-01/helpers.php');
$base = base_path('artifacts/content-07b');
$connection = DB::connection();
if (! app()->environment('local') || $connection->getDriverName() !== 'mysql' || $connection->getDatabaseName() !== 'ytt_local'
    || $connection->getConfig('host') !== '127.0.0.1' || (int) $connection->getConfig('port') !== 3306) {
    throw new RuntimeException('Exact local target required.');
}
$files = app(UnifiedBatchPreparation::class);
$json = app(UnifiedJson::class);
$decision = $json->read($base.'/content-decision.json');
$group = $json->read($base.'/approved/group-confirmation.json');
if (($decision['owner_response'] ?? null) !== 'Одобряю G1–G4 и все 147 B'
    || ($decision['bundle_checksum'] ?? null) !== UnifiedBulkImportPermit::BUNDLE
    || ($group['bundle_checksum'] ?? null) !== UnifiedBulkImportPermit::BUNDLE
    || UnifiedReview::digest($group['ids']) !== UnifiedBulkImportPermit::SELECTION) {
    throw new RuntimeException('Exact owner C/B decision and group receipts required.');
}
DB::connection()->beforeExecuting(function ($sql) {
    if (! preg_match('/^select\s/i', ltrim($sql))) {
        throw new RuntimeException('Preflight is SELECT only.');
    }
});
$pdo = $connection->getPdo();
if (! DB::table('migrations')->where('migration', '2026_11_12_170000_add_compendium_copy_contracts')->exists()) {
    throw new RuntimeException('Existing consumer schema is not active; no migrations are run by this task.');
}
$columns = DB::select("SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='compendium_copies' AND COLUMN_NAME IN ('campaign_id','owner_user_id')) OR (TABLE_NAME='item_definitions' AND COLUMN_NAME='content'))");
if (count($columns) !== 3 || array_filter($columns, fn ($column) => $column->IS_NULLABLE !== 'YES')) {
    throw new RuntimeException('Existing consumer column contract changed.');
}
$before = fingerprints($pdo);
$chunks = $ids = [];
$counts = ['create' => 0, 'update' => 0, 'skip' => 0, 'conflict' => 0, 'not_compared' => 0];
$baselines = $reviews = 0;
$manifests = glob($base.'/approved/approved-part-*.manifest.json');
sort($manifests);
if (count($manifests) !== 28) {
    throw new RuntimeException('Expected exactly 28 approved manifests.');
}
foreach ($manifests as $manifest) {
    $m = $json->read($manifest);
    $plan = app(UnifiedDryRun::class)->run('B:/BG3-Assets-Work/Output/Unified-DnD-Library', $manifest);
    if (! $plan['validation_passed'] || ! $plan['review_ready'] || ! $plan['transaction_writer_ready']
        || $plan['actions']['conflict'] !== 0 || $plan['actions']['not_compared'] !== 0) {
        throw new RuntimeException('Approved live diff is not ready: '.basename($manifest));
    }
    $records = [];
    foreach ($plan['records'] as $row) {
        if ($row['gates'] !== ['browse' => true, 'copy' => true, 'execute' => false]) {
            throw new RuntimeException('Unexpected execution permissions.');
        }
        $ids[] = $row['id'];
        $records[] = array_intersect_key($row, array_flip(['id', 'identity', 'source_checksum', 'checksum', 'projection_checksum', 'existing_entry_id', 'action', 'baseline']));
    }
    foreach ($plan['actions'] as $key => $number) {
        $counts[$key] += $number;
    }
    $reviews += count($m['reviews']);
    $baselines += count($m['baseline_reviews']);
    $name = basename($manifest);
    $files->write($base.'/plans/'.str_replace('.manifest.json', '.diff.json', $name), $plan);
    $chunks[] = ['manifest' => $name, 'manifest_sha256' => hash_file('sha256', $manifest),
        'plan_checksum' => $plan['plan_checksum'], 'actions' => $plan['actions'], 'records' => $records];
}
if (UnifiedReview::digest($ids) !== UnifiedBulkImportPermit::SELECTION || count($ids) !== 552 || count(array_unique($ids)) !== 552
    || $reviews !== 552 || $baselines !== 147 || $counts !== ['create' => 234, 'update' => 318, 'skip' => 0, 'conflict' => 0, 'not_compared' => 0]) {
    throw new RuntimeException('Exact 552 C / 147 B / 234 create / 318 update scope changed.');
}
if ($before !== fingerprints($pdo)) {
    throw new RuntimeException('Database changed during preflight.');
}
$scope = ['scope' => 'CONTENT-07B', 'bundle_checksum' => UnifiedBulkImportPermit::BUNDLE,
    'ids' => $ids, 'chunks' => $chunks, 'actions' => $counts, 'execute' => false,
    'content_decision_sha256' => hash_file('sha256', $base.'/content-decision.json'),
    'group_confirmation_sha256' => hash_file('sha256', $base.'/approved/group-confirmation.json')];
$files->write($base.'/import-scope.json', $scope);
$files->write($base.'/preflight-fingerprints.json', $before);
$report = ['generated_at' => now()->setTimezone('Europe/Kiev')->toIso8601String(), 'database_writes' => 0,
    'scope_sha256' => hash_file('sha256', $base.'/import-scope.json'), 'bundle_checksum' => UnifiedBulkImportPermit::BUNDLE,
    'selected' => count($ids), 'approved_content_decisions' => $reviews, 'approved_baselines' => $baselines,
    'chunks' => count($chunks), 'actions' => $counts, 'all_live_tables_unchanged' => count($before),
    'execute' => false, 'apply_authorized' => false];
$files->write($base.'/preflight-report.json', $report);
echo json_encode($report, JSON_THROW_ON_ERROR).PHP_EOL;
