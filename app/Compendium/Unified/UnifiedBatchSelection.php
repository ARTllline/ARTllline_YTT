<?php

namespace App\Compendium\Unified;

use App\Compendium\SrdEquipmentMapper;
use App\Models\CompendiumEntry;
use InvalidArgumentException;

/** Deterministic, diverse source selection; never confers review or import permission. */
class UnifiedBatchSelection
{
    public function __construct(private UnifiedJson $json) {}

    public function installedIds(string $root): array
    {
        $index = $this->json->read($this->json->inside($root, 'data/index.js'), 'acceptIndex');
        $byId = array_column($index['records'], null, 'id');
        $shards = $ids = [];
        foreach (CompendiumEntry::whereHas('source', fn ($q) => $q->where('key', 'srd-2024'))->whereNull('library_user_id')->whereIn('normalization_version', UnifiedSrdAdapter::SUPPORTED_VERSIONS)->get() as $entry) {
            $data = $entry->only(UnifiedCatalogPlan::FIELDS);
            $receipt = data_get($data, 'normalized_data.content.import_receipt');
            unset($data['normalized_data']['content']['import_receipt']);
            $id = data_get($data, 'normalized_data.content.source_id');
            if (! is_array($receipt) || ($receipt['writer'] ?? null) !== 'unified-srd-2024' || ($receipt['digest'] ?? null) !== UnifiedReview::digest($data)
                || ($receipt['slug'] ?? null) !== $entry->slug || ! isset($byId[$id]) || $byId[$id]['source'] !== '2024') {
                continue;
            }
            $shard = $byId[$id]['shard'];
            if (! preg_match('/^\d{1,4}$/D', $shard)) {
                throw new InvalidArgumentException('Invalid installed record shard.');
            }
            $shards[$shard] ??= $this->json->read($this->json->inside($root, 'data/records-'.$shard.'.js'), 'acceptShard.bind(null,"'.$shard.'")');
            if (isset($shards[$shard][$id]) && data_get($data, 'normalized_data.content.provenance.source_checksum') === UnifiedSrdAdapter::checksum($shards[$shard][$id])) {
                $ids[] = $id;
            }
        }

        return $ids;
    }

    public function select(string $root, array $excluded, array $quotas = ['equipment' => 60, 'magic_item' => 40, 'spell' => 60], bool $all = false): array
    {
        $index = $this->json->read($this->json->inside($root, 'data/index.js'), 'acceptIndex');
        if (($index['schemaVersion'] ?? null) !== 1 || ($index['inputSchemas']['srd'] ?? null) !== 2) {
            throw new InvalidArgumentException('Unsupported export schema.');
        }
        $seen = $shards = $available = $kinds = $inventory = [];
        $total = 0;
        foreach ($index['records'] as $row) {
            if (! is_string($row['id'] ?? null) || isset($seen[$row['id']])) {
                throw new InvalidArgumentException('Missing/duplicate source index ID.');
            }
            $seen[$row['id']] = true;
            if (($row['source'] ?? null) !== '2024') {
                continue;
            }
            $total++;
            if (in_array($row['id'], $excluded, true)) {
                continue;
            }
            if (! in_array($row['kind'], ['equipment', 'magic_item', 'spell'], true) || ! preg_match('/^\d{1,4}$/D', $row['shard'])) {
                throw new InvalidArgumentException('Unexpected SRD kind/shard.');
            }
            $shard = $row['shard'];
            $shards[$shard] ??= $this->json->read($this->json->inside($root, 'data/records-'.$shard.'.js'), 'acceptShard.bind(null,"'.$shard.'")');
            $detail = $shards[$shard][$row['id']] ?? null;
            if (! is_array($detail)) {
                throw new InvalidArgumentException('Source detail missing.');
            }
            $record = $detail['record'];
            if ($row['kind'] === 'spell') {
                $row['school'] ??= $record['raw']['school']['name'] ?? 'unknown';
                $row['level'] ??= $record['raw']['level'] ?? -1;
            }
            $stratum = $this->stratum($row);
            $kinds[$row['kind']] = ($kinds[$row['kind']] ?? 0) + 1;
            $inventory[] = ['id' => $row['id'], 'kind' => $row['kind'], 'stratum' => $stratum,
                'name_en' => $record['name_en'] ?? $row['en'], 'name_ru' => $record['name_ru'] ?? null,
                'has_ru_name' => trim($record['name_ru'] ?? '') !== '',
                'has_en_text' => UnifiedContentChecks::prose($record['description_en'] ?? null) !== '',
                'has_ru_text' => UnifiedContentChecks::prose($record['description_ru'] ?? null) !== '',
                'official_reference_present' => ! empty($record['official_reference'])];
            $available[$row['kind']][$stratum][] = ['index' => $row, 'detail' => $detail];
        }
        if ($all) {
            $quotas = $kinds;
            ksort($quotas);
        }
        $selected = [];
        foreach ($quotas as $kind => $count) {
            $buckets = $available[$kind] ?? [];
            ksort($buckets);
            foreach ($buckets as &$bucket) {
                usort($bucket, fn ($a, $b) => strcmp(hash('sha256', $a['index']['id']), hash('sha256', $b['index']['id'])));
            }
            unset($bucket);
            $picked = 0;
            $kindSelected = [];
            if ($kind === 'spell') {
                // Cover both dimensions before filling the school/level buckets fairly.
                foreach (['school', 'level'] as $dimension) {
                    $values = array_values(array_unique(array_map(fn ($b) => $b[0]['index'][$dimension], $buckets)));
                    sort($values);
                    foreach ($values as $value) {
                        if ($picked >= $count) {
                            break 2;
                        }
                        if (in_array($value, array_column(array_column($kindSelected, 'index'), $dimension), true)) {
                            continue;
                        }
                        foreach ($buckets as $key => $bucket) {
                            if ($bucket[0]['index'][$dimension] === $value) {
                                $input = array_shift($buckets[$key]);
                                $selected[] = $kindSelected[] = $input;
                                $picked++;
                                if (! $buckets[$key]) {
                                    unset($buckets[$key]);
                                }
                                break;
                            }
                        }
                    }
                }
            }
            while ($picked < $count && $buckets) {
                if ($kind === 'spell') {
                    $schools = array_count_values(array_column(array_column($kindSelected, 'index'), 'school'));
                    $levels = array_count_values(array_column(array_column($kindSelected, 'index'), 'level'));
                    $keys = array_keys($buckets);
                    usort($keys, function ($a, $b) use ($buckets, $schools, $levels) {
                        $x = $buckets[$a][0]['index'];
                        $y = $buckets[$b][0]['index'];

                        return [$schools[$x['school']] ?? 0, $levels[$x['level']] ?? 0, $a]
                            <=> [$schools[$y['school']] ?? 0, $levels[$y['level']] ?? 0, $b];
                    });
                    $key = $keys[0];
                    $input = array_shift($buckets[$key]);
                    $selected[] = $kindSelected[] = $input;
                    $picked++;
                    if (! $buckets[$key]) {
                        unset($buckets[$key]);
                    }

                    continue;
                }
                foreach (array_keys($buckets) as $key) {
                    $selected[] = array_shift($buckets[$key]);
                    $picked++;
                    if (! $buckets[$key]) {
                        unset($buckets[$key]);
                    }
                    if ($picked === $count) {
                        break;
                    }
                }
            }
            if ($picked !== $count) {
                throw new InvalidArgumentException('Insufficient source records for explicit quota: '.$kind);
            }
        }
        $selection = [];
        $evidence = [];
        foreach ($selected as $input) {
            $row = $input['index'];
            $key = $input['detail']['record']['source']['index'];
            $selection[] = ['id' => $row['id'], 'kind' => $row['kind'],
                'entity_type' => $row['kind'] === 'spell' ? 'spells' : ($row['kind'] === 'magic_item' ? 'items' : app(SrdEquipmentMapper::class)->type($input['detail']['record']['raw'])),
                'external_key' => $row['kind'] === 'magic_item' ? 'magic-item:'.$key : $key,
                'checksum' => UnifiedSrdAdapter::checksum($input['detail'])];
            $record = $input['detail']['record'];
            $differences = [];
            foreach ($record['mechanics'] ?? [] as $field => $value) {
                if (array_key_exists($field, $record['raw']) && UnifiedReview::digest($value) !== UnifiedReview::digest($record['raw'][$field])) {
                    $differences[$field] = ['raw' => $record['raw'][$field], 'curated_mechanics' => $value];
                }
            }
            $evidence[] = ['source' => $record['source'], 'edition' => $record['edition'],
                'mechanics_diff' => $differences, 'raw_components' => $record['raw']['components'] ?? null,
                'languages' => ['en' => ['name' => $record['name_en'], 'description' => $record['description_en']],
                    'ru' => ['name' => $record['name_ru'] ?? null, 'description' => $record['description_ru']]]];
        }

        return ['export' => ['srd_commit' => $index['srdCommit'], 'library_version' => $index['srdLibraryVersion']],
            'source_total' => $total, 'remaining' => count($inventory), 'remaining_kinds' => $kinds,
            'excluded_ids' => $excluded, 'inventory' => $inventory, 'selection' => $selection,
            'selected_evidence' => $evidence,
            'selected_strata' => array_map(fn ($r) => $this->stratum($r['index']), $selected)];
    }

    private function stratum(array $row): string
    {
        return match ($row['kind']) {
            'spell' => ($row['school'] ?? 'unknown').' / level '.($row['level'] ?? '?'),
            'magic_item' => $row['rarity'] ?? 'unknown rarity',
            default => implode(', ', $row['types'] ?? []) ?: 'uncategorized equipment',
        };
    }
}
