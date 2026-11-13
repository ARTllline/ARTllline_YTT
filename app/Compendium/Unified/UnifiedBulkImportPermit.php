<?php

namespace App\Compendium\Unified;

use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/** Exact CONTENT-07B selection only. An absent owner permit keeps the writer closed. */
class UnifiedBulkImportPermit
{
    public const BUNDLE = '6f897a7ea61026a658e2cef4a278e08d683e6e368fb1cea292acf5fbda63fb1a';

    public const SELECTION = '0f540df53de577382158fbea3cfbc305438afb6cacbd2b14db0405ffd2640b5d';

    public function isManifest(string $path): bool
    {
        return preg_match('/^approved-part-(?:0[1-9]|1[0-9]|2[0-8])\.manifest\.json$/D', basename($path)) === 1
            && $this->samePath(dirname($path), base_path('artifacts/content-07b/approved'));
    }

    public function authorize(string $root, string $manifestPath): array
    {
        $c = DB::connection();
        if (! app()->environment('local') || $c->getDriverName() !== 'mysql' || $c->getDatabaseName() !== 'ytt_local'
            || $c->getConfig('host') !== '127.0.0.1' || (int) $c->getConfig('port') !== 3306 || $c->getConfig('url')
            || ! $this->samePath($root, 'B:/BG3-Assets-Work/Output/Unified-DnD-Library') || ! $this->isManifest($manifestPath)) {
            throw new InvalidArgumentException('CONTENT-07B is restricted to the exact local source, target and approved manifests.');
        }
        $base = base_path('artifacts/content-07b');
        $permit = $this->read($base.'/owner-authorization.json');
        $scope = $this->read($base.'/import-scope.json');
        if (($permit['scope'] ?? null) !== 'CONTENT-07B' || ($permit['approved'] ?? null) !== true
            || ($permit['target'] ?? null) !== 'ytt_local' || ($permit['bundle_checksum'] ?? null) !== self::BUNDLE
            || ($permit['scope_sha256'] ?? null) !== hash_file('sha256', $base.'/import-scope.json')
            || ($scope['bundle_checksum'] ?? null) !== self::BUNDLE || ($scope['execute'] ?? null) !== false
            || count($scope['ids'] ?? []) !== 552 || UnifiedReview::digest($scope['ids']) !== self::SELECTION
            || count($scope['chunks'] ?? []) !== 28 || ($permit['allow_idempotent_repeat'] ?? null) !== true
            || ! is_string($permit['reviewer'] ?? null) || trim($permit['reviewer']) === ''
            || ! is_string($permit['evidence'] ?? null) || trim($permit['evidence']) === ''
            || ! is_string($permit['approved_at'] ?? null) || strtotime($permit['approved_at']) === false) {
            throw new InvalidArgumentException('Separate explicit CONTENT-07B apply authorization and exact scope are required.');
        }
        foreach (['content-decision.json', 'approved/group-confirmation.json', 'backup/SHA256SUMS', 'backup-report.json', 'restore-report.json'] as $file) {
            if (! is_file($base.'/'.$file) || ($permit['evidence_sha256'][$file] ?? null) !== hash_file('sha256', $base.'/'.$file)) {
                throw new InvalidArgumentException('Owner decision or verified recovery binding changed.');
            }
        }
        $restore = $this->read($base.'/restore-report.json');
        if (($restore['all_table_fingerprints_match'] ?? null) !== true || ($restore['main_database_writes'] ?? null) !== 0
            || ($restore['migrations_executed'] ?? null) !== false || ($restore['private_files_verified'] ?? 0) < 1) {
            throw new InvalidArgumentException('Verified isolated recovery rehearsal is required.');
        }
        $ids = array_merge(...array_map(fn ($chunk) => array_column($chunk['records'], 'id'), $scope['chunks']));
        if ($ids !== $scope['ids']) {
            throw new InvalidArgumentException('Chunk membership is not the exact approved selection.');
        }
        $chunk = collect($scope['chunks'])->firstWhere('manifest', basename($manifestPath));
        if (! $chunk || ($chunk['manifest_sha256'] ?? null) !== hash_file('sha256', $manifestPath)) {
            throw new InvalidArgumentException('Approved manifest changed or is outside the owner permit.');
        }

        return $permit + ['chunk' => $chunk];
    }

    public function assertPlan(array $permit, array $plan): void
    {
        $chunk = $permit['chunk'] ?? [];
        $expected = $chunk['records'] ?? [];
        $rows = $plan['records'] ?? [];
        $initial = ($plan['plan_checksum'] ?? null) === ($chunk['plan_checksum'] ?? null)
            && ($plan['actions'] ?? null) === ($chunk['actions'] ?? null);
        $repeat = ! $initial && ($permit['allow_idempotent_repeat'] ?? null) === true
            && ($plan['actions'] ?? null) === ['create' => 0, 'update' => 0, 'skip' => count($expected), 'conflict' => 0, 'not_compared' => 0];
        if (! $expected || count($expected) > 20 || array_column($rows, 'id') !== array_column($expected, 'id')
            || (! $initial && ! $repeat) || ($plan['source'] ?? null) !== 'srd-2024' || ($plan['ruleset'] ?? null) !== 'dnd-2024'
            || ($plan['adapter_version'] ?? null) !== 5 || ! ($plan['validation_passed'] ?? false)
            || ! ($plan['review_ready'] ?? false) || ! ($plan['transaction_writer_ready'] ?? false)
            || ($plan['actions']['conflict'] ?? 1) !== 0 || ($plan['actions']['not_compared'] ?? 1) !== 0) {
            throw new InvalidArgumentException('CONTENT-07B plan changed or is not the exact approved reference-only chunk.');
        }
        $result = null;
        if ($repeat) {
            $file = base_path('artifacts/content-07b/import-result.json');
            if (! is_file($file) || ($permit['repeat_result_sha256'] ?? null) !== hash_file('sha256', $file)) {
                throw new InvalidArgumentException('No verified initial result is bound to this no-op repeat.');
            }
            $result = $this->read($file);
        }
        foreach ($rows as $i => $row) {
            foreach (['id', 'identity', 'checksum', 'source_checksum', 'projection_checksum'] as $key) {
                if (($row[$key] ?? null) !== ($expected[$i][$key] ?? null)) {
                    throw new InvalidArgumentException('Pinned record identity/content/projection changed.');
                }
            }
            $entryId = $repeat ? ($result['entry_ids'][$row['id']] ?? null) : $expected[$i]['existing_entry_id'];
            if (($row['gates'] ?? null) !== ['browse' => true, 'copy' => true, 'execute' => false]
                || ($row['existing_entry_id'] ?? null) !== $entryId
                || ($repeat && (! is_int($entryId) || ($row['baseline_assessment']['status'] ?? null) !== 'managed_receipt'
                    || ($row['baseline_assessment']['accepted'] ?? null) !== true))) {
                throw new InvalidArgumentException('Pinned entry IDs, neutral permissions or import receipt changed.');
            }
        }
    }

    private function read(string $path): array
    {
        if (! is_file($path) || filesize($path) > 1048576) {
            throw new InvalidArgumentException('CONTENT-07B owner/recovery evidence is missing; writer remains closed.');
        }

        return app(UnifiedJson::class)->read($path, limit: 1048576);
    }

    private function samePath(string $left, string $right): bool
    {
        $a = realpath($left);
        $b = realpath($right);

        return $a !== false && $b !== false && (PHP_OS_FAMILY === 'Windows' ? strcasecmp($a, $b) === 0 : $a === $b);
    }
}
