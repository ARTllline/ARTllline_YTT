<?php

namespace App\Compendium;

use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;

class CompendiumSync
{
    public const VERSION = 1;

    public const TYPES = ['spells', 'items', 'weapons', 'armor', 'monsters', 'conditions', 'skills', 'rules'];

    public function types(array $types): array
    {
        $types = array_values(array_unique(array_merge(...array_map(fn ($t) => $t === 'equipment' ? ['items', 'weapons', 'armor'] : [$t], $types))));
        if (! $types) {
            return self::TYPES;
        }
        if (array_diff($types, self::TYPES)) {
            throw new InvalidArgumentException('Unknown type. Use: '.implode(', ', self::TYPES).', equipment.');
        }

        return $types;
    }

    public function endpoints(array $types): array
    {
        return array_values(array_filter(SrdApi::ENDPOINTS, fn ($e) => match ($e) {
            'equipment' => (bool) array_intersect($types, ['items', 'weapons', 'armor']),
            'spells', 'monsters', 'conditions', 'skills' => in_array($e, $types),
            default => in_array('rules', $types),
        }));
    }

    public static function canonical(mixed $data): mixed
    {
        if (! is_array($data)) {
            return $data;
        }
        if (! array_is_list($data)) {
            ksort($data);
        }

        return array_map(self::canonical(...), $data);
    }

    public function import(CompendiumSource $source, array $records, array $types, bool $dryRun = false, bool $force = false): array
    {
        $prepared = [];
        foreach ($records as $record) {
            $endpoint = $record['endpoint'] ?? '';
            $raw = $record['data'] ?? [];
            if (! in_array($endpoint, SrdApi::ENDPOINTS, true) || ! preg_match('/^[a-z0-9][a-z0-9-]*$/', $raw['index'] ?? '') || empty($raw['name'])) {
                throw new InvalidArgumentException('Invalid SRD import record.');
            }
            $type = match ($endpoint) {
                'equipment' => app(SrdEquipmentMapper::class)->type($raw),
                'spells', 'monsters', 'conditions', 'skills' => $endpoint, default => 'rules',
            };
            if (! in_array($type, $types, true)) {
                continue;
            }
            $key = $type === 'rules' ? $endpoint.':'.$raw['index'] : $raw['index'];
            if (isset($prepared[$type.'|'.$key])) {
                throw new InvalidArgumentException('Duplicate SRD import identity: '.$key);
            }
            $normalized = ['schema_version' => self::VERSION, 'key' => SrdKeys::key($raw['index']), 'name' => $raw['name']] + match ($type) {
                'spells' => app(SrdSpellMapper::class)->map($raw),
                'items', 'weapons', 'armor' => app(SrdEquipmentMapper::class)->map($raw),
                'monsters' => app(SrdMonsterMapper::class)->map($raw),
                default => app(SrdReferenceMapper::class)->map($endpoint, $raw),
            };
            $prepared[$type.'|'.$key] = ['entity_type' => $type, 'external_key' => $key, 'slug' => Str::slug($raw['name']), 'name' => $raw['name'],
                'raw_data' => $raw, 'normalized_data' => $normalized,
                'checksum' => hash('sha256', json_encode(self::canonical($raw), JSON_THROW_ON_ERROR)), 'normalization_version' => self::VERSION];
        }

        return DB::transaction(function () use ($source, $prepared, $types, $dryRun, $force) {
            $source = CompendiumSource::whereKey($source->id)->lockForUpdate()->firstOrFail();
            $counts = array_fill_keys($types, ['created' => 0, 'updated' => 0, 'unchanged' => 0]);
            foreach ($prepared as $data) {
                $entry = $source->entries()->where('entity_type', $data['entity_type'])->where('external_key', $data['external_key'])->first();
                if (! $entry && in_array($data['entity_type'], ['items', 'weapons', 'armor'])) {
                    // A source correction can reclassify equipment; retain the same
                    // local identity and existing provenance instead of duplicating it.
                    $entry = $source->entries()->whereIn('entity_type', ['items', 'weapons', 'armor'])->where('external_key', $data['external_key'])->first();
                }
                $state = ! $entry ? 'created' : (($force || $entry->checksum !== $data['checksum'] || $entry->normalization_version !== self::VERSION || json_encode(self::canonical($entry->normalized_data)) !== json_encode(self::canonical($data['normalized_data']))) ? 'updated' : 'unchanged');
                $counts[$data['entity_type']][$state]++;
                if (! $dryRun && $state !== 'unchanged') {
                    ($entry ?? new CompendiumEntry)->fill($data + ['source_id' => $source->id, 'imported_at' => now()])->save();
                }
            }
            if (! $dryRun) {
                $times = $source->type_synced_at ?? [];
                foreach ($types as $type) {
                    $times[$type] = now()->toIso8601String();
                }
                $source->update(['type_synced_at' => $times] + (count(array_diff(self::TYPES, $types)) === 0 ? ['last_synced_at' => now()] : []));
            }

            return $counts;
        });
    }
}
