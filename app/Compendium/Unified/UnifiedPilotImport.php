<?php

namespace App\Compendium\Unified;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;

/** One local CONTENT-05 pilot; this is not a general live-import switch. */
class UnifiedPilotImport
{
    public const MANIFEST_SHA256 = 'f995208190268c9621f98ae498a733d7bd877dc7149a220a3f1c16f2eca5ade9';

    public const ENTRIES = [
        'srd:equipment:acid:2024' => 340,
        'srd:equipment:arrows:2024' => 345,
        'srd:equipment:chain-mail:2024' => 374,
        'srd:equipment:leather-armor:2024' => 430,
        'srd:equipment:longsword:2024' => 436,
        'srd:equipment:potion-of-healing:2024' => 467,
        'srd:equipment:shield:2024' => 486,
        'srd:spell:cure-wounds:2024' => 73,
        'srd:spell:detect-magic:2024' => 82,
        'srd:spell:fireball:2024' => 126,
        'srd:spell:healing-word:2024' => 161,
        'srd:spell:magic-missile:2024' => 199,
        'srd:spell:shield:2024' => 275,
    ];

    public function authorize(string $root, string $manifestPath): array
    {
        $connection = DB::connection();
        if (! app()->environment('local') || $connection->getDriverName() !== 'mysql'
            || $connection->getDatabaseName() !== 'ytt_local' || $connection->getConfig('host') !== '127.0.0.1'
            || (int) $connection->getConfig('port') !== 3306 || $connection->getConfig('url')) {
            throw new InvalidArgumentException('Live writes are disabled outside the exact local CONTENT-05 target.');
        }
        if (app(UnifiedBulkImportPermit::class)->isManifest($manifestPath)) {
            return app(UnifiedBulkImportPermit::class)->authorize($root, $manifestPath);
        }
        if (! $this->samePath($root, 'B:/BG3-Assets-Work/Output/Unified-DnD-Library')
            || ! $this->samePath($manifestPath, resource_path('data/content/srd-2024-approved-13.manifest.json'))
            || hash_file('sha256', $manifestPath) !== self::MANIFEST_SHA256) {
            throw new InvalidArgumentException('Only the checksum-pinned approved 13-record pilot is allowed.');
        }
        $path = base_path('artifacts/content-05/owner-authorization.json');
        if (! is_file($path) || filesize($path) > 16384) {
            throw new InvalidArgumentException('Separate CONTENT-05 owner authorization is required; apply remains blocked.');
        }
        $permit = json_decode(file_get_contents($path), true, 32, JSON_THROW_ON_ERROR);
        if (($permit['approved'] ?? null) !== true || ($permit['target'] ?? null) !== 'ytt_local'
            || ($permit['manifest_sha256'] ?? null) !== self::MANIFEST_SHA256
            || ! preg_match('/^[a-f0-9]{64}$/D', $permit['plan_checksum'] ?? '')
            || ! is_string($permit['reviewer'] ?? null) || trim($permit['reviewer']) === ''
            || ! is_string($permit['evidence'] ?? null) || trim($permit['evidence']) === ''
            || ! is_string($permit['approved_at'] ?? null) || strtotime($permit['approved_at']) === false
            || ($permit['backup_verified'] ?? null) !== true
            || ! is_file(base_path('artifacts/content-05/backup/SHA256SUMS'))
            || ($permit['backup_manifest_sha256'] ?? null) !== hash_file('sha256', base_path('artifacts/content-05/backup/SHA256SUMS'))) {
            throw new InvalidArgumentException('Owner authorization or verified recovery binding is invalid.');
        }
        if (! Schema::hasColumn('compendium_copies', 'owner_user_id') || ! Schema::hasColumn('item_definitions', 'content')
            || ! DB::table('migrations')->where('migration', '2026_11_12_170000_add_compendium_copy_contracts')->exists()) {
            throw new InvalidArgumentException('Consumer schema activation is required.');
        }

        return $permit;
    }

    public function assertPlan(array $permit, array $plan): void
    {
        if (($permit['scope'] ?? null) === 'CONTENT-07B') {
            app(UnifiedBulkImportPermit::class)->assertPlan($permit, $plan);

            return;
        }
        $updates = ['create' => 0, 'update' => 13, 'skip' => 0, 'conflict' => 0, 'not_compared' => 0];
        $skips = ['create' => 0, 'update' => 0, 'skip' => 13, 'conflict' => 0, 'not_compared' => 0];
        $initial = ($plan['actions'] ?? null) === $updates && ($plan['plan_checksum'] ?? null) === ($permit['plan_checksum'] ?? null);
        $repeat = ($plan['actions'] ?? null) === $skips && ($permit['allow_idempotent_repeat'] ?? null) === true;
        if ((! $initial && ! $repeat) || ($plan['source'] ?? null) !== 'srd-2024' || ($plan['ruleset'] ?? null) !== 'dnd-2024'
            || ($plan['adapter_version'] ?? null) !== 4 || ! ($plan['review_ready'] ?? false) || ! ($plan['transaction_writer_ready'] ?? false)
            || array_column($plan['records'] ?? [], 'id') !== array_keys(self::ENTRIES)) {
            throw new InvalidArgumentException('Pilot scope/plan changed: only the authorized 13 updates or 13 no-op skips are allowed.');
        }
        foreach ($plan['records'] as $row) {
            if (($row['existing_entry_id'] ?? null) !== self::ENTRIES[$row['id']]
                || ($row['gates'] ?? null) !== ['browse' => true, 'copy' => true, 'execute' => false]) {
                throw new InvalidArgumentException('Pilot identity or reference-only permissions changed.');
            }
        }
    }

    private function samePath(string $left, string $right): bool
    {
        $a = realpath($left);
        $b = realpath($right);

        return $a !== false && $b !== false && (PHP_OS_FAMILY === 'Windows' ? strcasecmp($a, $b) === 0 : $a === $b);
    }
}
