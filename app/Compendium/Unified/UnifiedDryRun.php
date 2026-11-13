<?php

namespace App\Compendium\Unified;

use App\Compendium\CompendiumSync;
use App\Models\CompendiumSource;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/** A read-only plan. Deliberately has no persistence/import branch. */
class UnifiedDryRun
{
    public function __construct(private UnifiedPackage $packages, private UnifiedSrdAdapter $adapter, private UnifiedCatalogPlan $catalog) {}

    public function run(string $root, string $manifestPath, bool $offline = false): array
    {
        // Parse the whole selection before consulting the database.
        $package = $this->packages->read($root, $manifestPath);
        $manifest = $package['manifest'];
        $prepared = [];
        $identities = [];
        foreach ($package['records'] as $input) {
            try {
                $data = $this->adapter->prepare($input, $manifest, $root);
                $identity = $data['entity_type'].'|'.$data['external_key'];
                if (isset($identities[$identity])) {
                    throw new InvalidArgumentException('Duplicate Compendium identity in selection.');
                }
                $identities[$identity] = true;
                $prepared[] = ['id' => $input['selection']['id'], 'data' => $data];
            } catch (InvalidArgumentException|ValidationException $e) {
                $prepared[] = ['id' => $input['selection']['id'], 'errors' => $e instanceof ValidationException ? $e->errors() : [$e->getMessage()]];
            }
        }
        $source = $offline ? null : CompendiumSource::where('key', 'srd-2024')->first();
        $counts = array_fill_keys(['created', 'updated', 'unchanged', 'rejected'], 0);
        $planned = array_fill_keys(['created', 'updated', 'unchanged', 'conflict', 'not_compared'], 0);
        $rows = [];
        foreach ($prepared as $row) {
            if (isset($row['errors'])) {
                $counts['rejected']++;
                $rows[] = $row + ['state' => 'rejected', 'reason' => 'validation_failed'];

                continue;
            }
            $data = $row['data'];
            $baselineReview = collect($manifest['baseline_reviews'] ?? [])->firstWhere('id', $row['id']);
            $comparison = $this->catalog->compare($source, $data, baselineReview: $baselineReview);
            $existing = $comparison['existing'];
            $diff = $comparison['diff'];
            $state = $offline ? 'not_compared' : ($comparison['action'] === 'conflict' ? 'conflict' : (! $existing ? 'created' : ($diff ? 'updated' : 'unchanged')));
            $planned[$state]++;
            $eligible = ! $offline && $source && $data['gates']['browse'] && $state !== 'conflict';
            $counts[$eligible ? $state : 'rejected']++;
            // Avoid duplicating raw payloads in the report; the original remains in the
            // package and checksum. Show separate semantic/review/relations/visual diffs.
            unset($diff['raw_data']);
            $sections = [];
            foreach (['review', 'relations', 'visual', 'languages', 'provenance'] as $section) {
                $before = data_get($existing?->normalized_data, 'content.'.$section);
                $after = $data['normalized_data']['content'][$section];
                $sections[$section] = ['changed' => ! $this->same($before, $after), 'before' => $before, 'after' => $after];
            }
            $before = $existing?->normalized_data ?? [];
            $after = $data['normalized_data'];
            unset($before['content'], $after['content']);
            $sections['projection'] = ['changed' => ! $this->same($before, $after), 'before' => $before, 'after' => $after];
            $rows[] = ['id' => $row['id'], 'state' => $eligible ? $state : 'rejected', 'reason' => $comparison['reason'] ?? ($eligible ? null : (! $data['gates']['browse'] ? 'local_checksum_review_required' : 'catalog_not_checked_or_source_missing')),
                'action' => $offline ? 'not_compared' : $comparison['action'], 'baseline' => $comparison['baseline'],
                'baseline_assessment' => $offline ? null : $comparison['baseline_assessment'],
                'projection_checksum' => $data['projection_checksum'], 'source_checksum' => $manifest['selection'][array_search($row['id'], array_column($manifest['selection'], 'id'), true)]['checksum'],
                'proposed_state' => $state, 'existing_entry_id' => $existing?->id,
                'identity' => ['source' => 'srd-2024', 'entity_type' => $data['entity_type'], 'external_key' => $data['external_key']],
                'checksum' => $data['checksum'], 'gates' => $data['gates'], 'review_required' => $data['review_required'],
                'unsupported_fields' => $data['unsupported_fields'], 'coverage' => $data['coverage'],
                'normalized' => $data['normalized_data'], 'diff' => $offline ? null : $diff, 'content_diff' => $offline ? null : $sections];
        }

        $actions = array_fill_keys(['create', 'update', 'skip', 'conflict', 'not_compared'], 0);
        foreach ($rows as $row) {
            $actions[$row['action'] ?? 'conflict']++;
        }
        $planChecksum = UnifiedReview::digest(['source_id' => $source?->id, 'source_baseline' => $source?->getAttributes(), 'manifest' => $manifest, 'rows' => $rows]);

        return ['plan_checksum' => $planChecksum, 'actions' => $actions, 'format' => 1, 'mode' => 'dry-run', 'database_writes' => 0, 'source' => 'srd-2024', 'ruleset' => 'dnd-2024',
            'catalog_checked' => ! $offline, 'source_exists' => $offline ? null : $source !== null, 'source_id' => $source?->id, 'source_declared_version' => $source?->version,
            'export' => $manifest['export'], 'adapter_version' => $manifest['adapter_version'],
            'counts' => $counts, 'proposed_counts_before_review' => $planned,
            'validation_passed' => ! collect($rows)->contains(fn ($r) => isset($r['errors'])),
            'review_ready' => $counts['rejected'] === 0,
            'transaction_writer_ready' => $counts['rejected'] === 0 && ! collect($rows)->contains(fn ($r) => ! ($r['gates']['copy'] ?? false)),
            'consumer_contract_version' => 1,
            'apply_blockers' => ['live_consumer_contract_migration_required', 'explicit_baseline_and_content_approvals_required', 'separate_execution_profile_approval_for_automation', 'content_05_writer_enablement_and_import_authorization'],
            'import_available' => false, 'runtime_execution_available' => false, 'records' => $rows];
    }

    private function same(mixed $before, mixed $after): bool
    {
        return json_encode(CompendiumSync::canonical($before), JSON_THROW_ON_ERROR) === json_encode(CompendiumSync::canonical($after), JSON_THROW_ON_ERROR);
    }
}
