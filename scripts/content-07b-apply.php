<?php

/** Applies only the separately authorized CONTENT-07B scope; verifies invariants before commit. */
use App\Compendium\Unified\UnifiedBatchPreparation;
use App\Compendium\Unified\UnifiedBulkImportPermit;
use App\Compendium\Unified\UnifiedDryRun;
use App\Compendium\Unified\UnifiedJson;
use App\Compendium\Unified\UnifiedReview;
use App\Models\CompendiumEntry;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
require base_path('artifacts/content-fix-01/helpers.php');
$base = base_path('artifacts/content-07b');
$active = $base.'/owner-authorization.json';
$root = 'B:/BG3-Assets-Work/Output/Unified-DnD-Library';
$json = app(UnifiedJson::class);
$files = app(UnifiedBatchPreparation::class);
$gate = app(UnifiedBulkImportPermit::class);
$current = DB::connection();
if (! app()->environment('local') || ! $app->isDownForMaintenance() || $current->getDriverName() !== 'mysql'
    || $current->getDatabaseName() !== 'ytt_local' || $current->getConfig('host') !== '127.0.0.1' || (int) $current->getConfig('port') !== 3306) {
    throw new RuntimeException('Paused exact local target required.');
}
$completed = false;
try {
    $scope = $json->read($base.'/import-scope.json');
    $permit = $gate->authorize($root, $base.'/approved/'.$scope['chunks'][0]['manifest']);
    foreach (file($base.'/backup/SHA256SUMS', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        [$hash, $file] = explode('  ', $line, 2);
        if (! preg_match('/^[a-zA-Z0-9_.-]+$/D', $file) || hash_file('sha256', $base.'/backup/'.$file) !== $hash) {
            throw new RuntimeException('Recovery set changed.');
        }
    }
    $before = fingerprints($current->getPdo());
    $backupState = $json->read($base.'/backup-live-fingerprints.json');
    $preflightState = $json->read($base.'/preflight-fingerprints.json');
    $maintenanceDrift = null;
    if ($before !== $backupState || $before !== $preflightState) {
        // Daily retention may remove expired completed technical receipts. Require
        // exact per-row proof against the immutable SQL dump, never blanket exclusion.
        $maintenanceDrift = $json->read($base.'/maintenance-drift-verification.json');
        $retryState = $json->read($base.'/current-before-retry-fingerprints.json');
        $sameBefore = $before;
        $sameBackup = $backupState;
        unset($sameBefore['scene_mutation_receipts'], $sameBackup['scene_mutation_receipts']);
        if ($backupState !== $preflightState || $before !== $retryState || $sameBefore !== $sameBackup
            || ($maintenanceDrift['verified'] ?? null) !== true
            || ($maintenanceDrift['all_retained_receipts_byte_identical'] ?? null) !== true
            || ($maintenanceDrift['all_other_72_tables_identical'] ?? null) !== true
            || ($maintenanceDrift['backup_fingerprints_sha256'] ?? null) !== hash_file('sha256', $base.'/backup-live-fingerprints.json')
            || ($maintenanceDrift['current_fingerprints_sha256'] ?? null) !== hash_file('sha256', $base.'/current-before-retry-fingerprints.json')
            || ($maintenanceDrift['backup_manifest_sha256'] ?? null) !== hash_file('sha256', $base.'/backup/SHA256SUMS')
            || ($permit['evidence_sha256']['maintenance-drift-verification.json'] ?? null) !== hash_file('sha256', $base.'/maintenance-drift-verification.json')) {
            throw new RuntimeException('Live rows changed outside the exactly verified existing retention policy.');
        }
    }
    $assetRoot = base_path('storage/app/campaigns-private');
    $privateFiles = [];
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($assetRoot, FilesystemIterator::SKIP_DOTS)) as $file) {
        if ($file->isFile()) {
            $privateFiles[str_replace('\\', '/', substr($file->getPathname(), strlen($assetRoot) + 1))] = hash_file('sha256', $file->getPathname());
        }
    }
    ksort($privateFiles);
    if ($privateFiles !== $json->read($base.'/backup/private-assets-hashes.private.json')) {
        throw new RuntimeException('Private assets changed after backup.');
    }
    if (base64_encode(hash_file('sha256', base_path('.env'), true)) !== trim(file_get_contents($base.'/backup/environment.sha256.private.txt'))) {
        throw new RuntimeException('Local configuration changed after backup.');
    }
    $expectedRows = array_merge(...array_column($scope['chunks'], 'records'));
    $updateIds = array_values(array_filter(array_column($expectedRows, 'existing_entry_id'), fn ($id) => $id !== null));
    $untouched = UnifiedReview::digest(DB::table('compendium_entries')->whereNotIn('id', $updateIds)->orderBy('id')->get()->toArray());
    $counts = ['create' => 0, 'update' => 0, 'skip' => 0];
    $entryIds = [];
    DB::beginTransaction();
    try {
        foreach ($scope['chunks'] as $chunk) {
            $manifest = $base.'/approved/'.$chunk['manifest'];
            $args = ['root' => $root, '--manifest' => $manifest, '--apply' => true, '--confirm-plan' => $chunk['plan_checksum'], '--no-interaction' => true];
            if (Artisan::call('compendium:unified-import', $args) !== 0) {
                throw new RuntimeException('Exact approved CLI chunk failed: '.$chunk['manifest']);
            }
            $actual = json_decode(trim(Artisan::output()), true, 32, JSON_THROW_ON_ERROR);
            foreach ($counts as $key => $_) {
                $counts[$key] += $actual[$key];
            }
        }
        if ($counts !== ['create' => 234, 'update' => 318, 'skip' => 0]) {
            throw new RuntimeException('Actual mutation counts differ; rolling back all chunks.');
        }
        foreach ($expectedRows as $row) {
            $entry = CompendiumEntry::whereNull('library_user_id')->whereHas('source', fn ($q) => $q->where('key', 'srd-2024'))
                ->where('entity_type', $row['identity']['entity_type'])->where('external_key', $row['identity']['external_key'])->sole();
            if (($row['existing_entry_id'] !== null && $entry->id !== $row['existing_entry_id'])
                || $entry->checksum !== $row['checksum'] || $entry->normalization_version !== 5
                || UnifiedReview::projection($entry->only(['entity_type', 'external_key', 'name', 'checksum', 'normalization_version', 'normalized_data'])) !== $row['projection_checksum']
                || UnifiedReview::digest(data_get($entry->normalized_data, 'content.review.gates')) !== UnifiedReview::digest(['browse' => true, 'copy' => true, 'execute' => false])) {
                throw new RuntimeException('Imported record identity/projection mismatch; rolling back.');
            }
            $entryIds[$row['id']] = $entry->id;
        }
        $after = fingerprints($current->getPdo());
        $a = $after;
        $b = $before;
        unset($a['compendium_entries'], $b['compendium_entries']);
        if ($a !== $b || $after['compendium_entries']['count'] !== $before['compendium_entries']['count'] + 234
            || UnifiedReview::digest(DB::table('compendium_entries')->whereNotIn('id', array_values($entryIds))->orderBy('id')->get()->toArray()) !== $untouched) {
            throw new RuntimeException('User copies/runtime/unselected state changed; rolling back all chunks.');
        }
        DB::commit();
    } catch (Throwable $e) {
        DB::rollBack();
        throw $e;
    }
    $report = ['scope' => 'CONTENT-07B', 'bundle_checksum' => UnifiedBulkImportPermit::BUNDLE,
        'scope_sha256' => hash_file('sha256', $base.'/import-scope.json'), 'generated_at' => now()->setTimezone('Europe/Kiev')->toIso8601String(),
        'applied' => $counts, 'entry_ids' => $entryIds, 'all_other_tables_unchanged' => count($a),
        'all_unselected_entries_unchanged' => true, 'private_files_unchanged' => count($privateFiles),
        'all_execute_false' => true, 'all_chunks_atomic' => true, 'maintenance_drift_before_import' => $maintenanceDrift];
    $files->write($base.'/import-result.json', $report);
    $files->write($base.'/after-import-fingerprints.json', $after);
    // The owner's explicit no-op repeat is bound to the verified actual IDs created above.
    $permit = $json->read($active);
    $permit['repeat_result_sha256'] = hash_file('sha256', $base.'/import-result.json');
    file_put_contents($active, json_encode($permit, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n");
    $repeatCounts = ['create' => 0, 'update' => 0, 'skip' => 0];
    DB::beginTransaction();
    try {
        foreach ($scope['chunks'] as $chunk) {
            $manifest = $base.'/approved/'.$chunk['manifest'];
            $plan = app(UnifiedDryRun::class)->run($root, $manifest);
            $gate->assertPlan($gate->authorize($root, $manifest), $plan);
            if (Artisan::call('compendium:unified-import', ['root' => $root, '--manifest' => $manifest, '--apply' => true,
                '--confirm-plan' => $plan['plan_checksum'], '--no-interaction' => true]) !== 0) {
                throw new RuntimeException('No-op repeat refused.');
            }
            $actual = json_decode(trim(Artisan::output()), true, 32, JSON_THROW_ON_ERROR);
            foreach ($repeatCounts as $key => $_) {
                $repeatCounts[$key] += $actual[$key];
            }
            $files->write($base.'/plans/'.str_replace('.manifest.json', '.repeat.json', $chunk['manifest']), $plan);
        }
        if ($repeatCounts !== ['create' => 0, 'update' => 0, 'skip' => 552] || fingerprints($current->getPdo()) !== $after) {
            throw new RuntimeException('Repeat changed state.');
        }
        DB::commit();
    } catch (Throwable $e) {
        DB::rollBack();
        throw $e;
    }
    $files->write($base.'/repeat-result.json', ['repeat' => $repeatCounts, 'all_live_tables_identical' => count($after), 'database_writes' => 0]);
    $completed = true;
    echo json_encode(['applied' => $counts, 'repeat' => $repeatCounts, 'preserved_other_tables' => count($a), 'all_execute_false' => true], JSON_THROW_ON_ERROR).PHP_EOL;
} finally {
    if (is_file($active)) {
        $closed = $base.'/owner-authorization.'.($completed ? 'completed' : 'failed-closed').'.json';
        if (file_exists($closed)) {
            $closed = $base.'/owner-authorization.failed-closed-'.gmdate('Ymd-His').'-'.bin2hex(random_bytes(3)).'.json';
        }
        if (! rename($active, $closed)) {
            throw new RuntimeException('Cannot archive active permit; stop and close writer manually.');
        }
    }
}
