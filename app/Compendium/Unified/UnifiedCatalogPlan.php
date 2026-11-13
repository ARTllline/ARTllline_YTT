<?php

namespace App\Compendium\Unified;

use App\Compendium\CompendiumSync;
use App\Compendium\SrdEquipmentMapper;
use App\Compendium\SrdKeys;
use App\Compendium\SrdSpellMapper;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use Illuminate\Support\Str;

/** Shared comparison policy for the read-only plan and the transaction writer. */
class UnifiedCatalogPlan
{
    public const NULL_AMMUNITION_POLICY = 'legacy-equipment-missing-null-ammunition-v1';

    public const MISSING_AMMUNITION_POLICY = 'legacy-equipment-missing-source-ammunition-v1';

    public const BASELINE_POLICIES = [self::NULL_AMMUNITION_POLICY, self::MISSING_AMMUNITION_POLICY];

    public const FIELDS = ['entity_type', 'external_key', 'name', 'checksum', 'normalization_version', 'raw_data', 'normalized_data'];

    public function compare(?CompendiumSource $source, array $data, bool $lock = false, ?array $baselineReview = null): array
    {
        $types = in_array($data['entity_type'], ['items', 'weapons', 'armor'], true) ? ['items', 'weapons', 'armor'] : [$data['entity_type']];
        $query = $source?->entries()->whereIn('entity_type', $types)->where('external_key', $data['external_key']);
        $matches = $query ? ($lock ? $query->lockForUpdate() : $query)->get() : collect();
        $existing = $matches->first();
        $reason = null;
        $assessment = ['status' => 'new', 'accepted' => true];
        if ($matches->count() > 1 || $matches->contains(fn ($e) => $e->library_user_id !== null)) {
            $reason = 'existing_identity_conflict_or_user_content';
            $assessment = ['status' => 'user_or_ambiguous', 'accepted' => false];
        } elseif ($existing) {
            $assessment = $this->assess($existing, $data, $baselineReview);
            if (! $assessment['accepted']) {
                $reason = in_array($assessment['status'], self::BASELINE_POLICIES, true) ? 'explicit_baseline_review_required' : 'unmanaged_or_locally_modified_entry';
            }
        }
        $diff = [];
        foreach (self::FIELDS as $field) {
            $before = $existing?->getAttribute($field);
            if ($field === 'normalized_data' && is_array($before)) {
                unset($before['content']['import_receipt']);
            }
            if (! $existing || UnifiedReview::digest($before) !== UnifiedReview::digest($data[$field])) {
                $diff[$field] = ['before' => $before, 'after' => $data[$field]];
            }
        }

        return ['action' => $reason ? 'conflict' : (! $existing ? 'create' : ($diff ? 'update' : 'skip')),
            'reason' => $reason, 'existing' => $existing, 'diff' => $diff,
            'baseline_assessment' => $assessment,
            'baseline' => $matches->map(fn ($e) => ['id' => $e->id, 'digest' => self::baseline($e)])->all()];
    }

    public static function baseline(CompendiumEntry $entry): string
    {
        return UnifiedReview::digest($entry->getAttributes());
    }

    private function assess(CompendiumEntry $entry, array $incoming, ?array $review): array
    {
        $rejected = ['status' => 'modified_or_unrecognized', 'accepted' => false];
        $receipt = data_get($entry->normalized_data, 'content.import_receipt');
        if (! is_array($receipt) || ($receipt['writer'] ?? null) !== 'unified-srd-2024') {
            // Adopt only a reproducible, unmodified old API import. Merely having
            // library_user_id=NULL or a matching raw checksum is insufficient.
            $raw = $entry->raw_data;
            $key = $raw['index'] ?? null;
            $name = $raw['name'] ?? null;
            if (! is_string($key) || ! is_string($name) || $entry->external_key !== $key
                || ! in_array($entry->entity_type, ['items', 'weapons', 'armor', 'spells'], true)
                || ($raw['url'] ?? null) !== '/api/2024/'.($entry->entity_type === 'spells' ? 'spells' : 'equipment').'/'.$key) {
                return $rejected;
            }
            $expected = ['schema_version' => CompendiumSync::VERSION, 'key' => SrdKeys::key($key), 'name' => $name]
                + ($entry->entity_type === 'spells' ? app(SrdSpellMapper::class)->map($raw) : app(SrdEquipmentMapper::class)->map($raw));

            if ($entry->checksum !== UnifiedReview::digest($raw) || $entry->normalization_version !== CompendiumSync::VERSION
                || $entry->name !== $name || $entry->slug !== Str::slug($name)) {
                return $rejected;
            }
            if (UnifiedReview::digest($entry->normalized_data) === UnifiedReview::digest($expected)) {
                return ['status' => 'legacy_exact', 'accepted' => true];
            }
            // A single, evidenced old schema shape. Never normalize arbitrary
            // missing/null fields, ammo assignments, extra fields or manual edits.
            $actual = $entry->normalized_data;
            if ($entry->entity_type === 'spells' || array_key_exists('ammunition', $actual)) {
                return $rejected;
            }
            $ammunition = $expected['ammunition'];
            $policy = $ammunition === null ? self::NULL_AMMUNITION_POLICY : self::MISSING_AMMUNITION_POLICY;
            unset($expected['ammunition']);
            if (UnifiedReview::digest($actual) !== UnifiedReview::digest($expected)) {
                return $rejected;
            }
            $sourceId = data_get($incoming, 'normalized_data.content.source_id');
            $accepted = $review && ($review['confirmed'] ?? false) === true
                && ($review['id'] ?? null) === $sourceId && ($review['policy'] ?? null) === $policy
                && ($review['entry_id'] ?? null) === $entry->id && ($review['baseline_digest'] ?? null) === self::baseline($entry)
                && is_string($review['reviewer'] ?? null) && trim($review['reviewer']) !== ''
                && is_string($review['evidence'] ?? null) && trim($review['evidence']) !== '';

            return ['status' => $policy, 'accepted' => (bool) $accepted,
                'difference' => ['path' => 'normalized_data.ammunition', 'before' => 'absent', 'current_mapper' => $ammunition],
                'entry_id' => $entry->id, 'baseline_digest' => self::baseline($entry),
                'review_status' => $accepted ? 'explicitly_confirmed' : ($review ? 'stale_or_mismatched' : 'pending')];
        }
        $data = $entry->only(self::FIELDS);
        unset($data['normalized_data']['content']['import_receipt']);

        return ['status' => 'managed_receipt', 'accepted' => ($receipt['digest'] ?? null) === UnifiedReview::digest($data)
            && ($receipt['slug'] ?? null) === $entry->slug];
    }
}
