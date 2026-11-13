<?php

namespace App\Compendium\Unified;

use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;

/** Transaction writer; live use is limited to the separately authorized local pilot. */
class UnifiedImport
{
    public function __construct(private UnifiedDryRun $plans, private UnifiedPackage $packages, private UnifiedSrdAdapter $adapter, private UnifiedCatalogPlan $catalog) {}

    public function apply(string $root, string $manifestPath, string $expectedPlan): array
    {
        $isolated = app()->runningUnitTests() && DB::connection()->getDriverName() === 'sqlite' && DB::connection()->getDatabaseName() === ':memory:';
        $permit = $isolated ? null : app(UnifiedPilotImport::class)->authorize($root, $manifestPath);
        if (! preg_match('/^[a-f0-9]{64}$/D', $expectedPlan)) {
            throw new InvalidArgumentException('An explicit live plan checksum is required.');
        }

        return DB::transaction(function () use ($root, $manifestPath, $expectedPlan, $permit) {
            $source = CompendiumSource::where('key', 'srd-2024')->lockForUpdate()->firstOrFail();
            $package = $this->packages->read($root, $manifestPath);
            $source->entries()->whereIn('external_key', array_column($package['manifest']['selection'], 'external_key'))->lockForUpdate()->get();
            $plan = $this->plans->run($root, $manifestPath);
            if (! hash_equals($expectedPlan, $plan['plan_checksum']) || ! $plan['review_ready'] || ! $plan['validation_passed']) {
                throw new InvalidArgumentException('Plan changed, conflict found, or selection contains unconfirmed/stale records. No records imported.');
            }
            if ($permit !== null) {
                app(UnifiedPilotImport::class)->assertPlan($permit, $plan);
            }
            $counts = ['create' => 0, 'update' => 0, 'skip' => 0];
            $prepared = [];
            foreach ($package['records'] as $i => $input) {
                $data = $this->adapter->prepare($input, $package['manifest'], $root);
                $row = $plan['records'][$i];
                if (! $data['gates']['browse'] || ! $data['gates']['copy']
                    || $data['checksum'] !== $row['checksum'] || $data['projection_checksum'] !== $row['projection_checksum']
                    || UnifiedReview::digest($data['normalized_data']) !== UnifiedReview::digest($row['normalized'])) {
                    throw new InvalidArgumentException('Data/review changed during preparation, or copy was not explicitly approved.');
                }
                $prepared[] = ['data' => $data, 'baseline_review' => collect($package['manifest']['baseline_reviews'] ?? [])->firstWhere('id', $input['selection']['id'])];
            }
            foreach ($prepared as $preparedRow) {
                $data = $preparedRow['data'];
                $comparison = $this->catalog->compare($source, $data, true, $preparedRow['baseline_review']);
                $action = $comparison['action'];
                if ($action === 'conflict') {
                    throw new InvalidArgumentException('Catalog conflict: '.$comparison['reason']);
                }
                $counts[$action]++;
                if ($action === 'skip') {
                    continue;
                }
                $values = array_intersect_key($data, array_flip(UnifiedCatalogPlan::FIELDS));
                $slug = Str::slug($data['name']);
                $values['normalized_data']['content']['import_receipt'] = ['writer' => 'unified-srd-2024', 'digest' => UnifiedReview::digest($values), 'slug' => $slug];
                ($comparison['existing'] ?? new CompendiumEntry)->fill($values + ['slug' => $slug, 'source_id' => $source->id, 'imported_at' => now()])->save();
            }

            return $counts;
        });
    }
}
