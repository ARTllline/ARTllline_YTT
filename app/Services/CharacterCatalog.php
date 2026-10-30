<?php

namespace App\Services;

use App\Models\CompendiumEntry;

/** Request-local definitions from the installed SRD source. Never calls HTTP. */
class CharacterCatalog
{
    private array $loaded = [];

    public function entries(string $type): array
    {
        return $this->loaded[$type] ??= CompendiumEntry::whereHas('source', fn ($q) => $q->where('key', 'srd-2024'))
            ->where('entity_type', $type)->orderBy('name')->get()->mapWithKeys(function ($entry) use ($type) {
                $n = $entry->normalized_data;
                $key = $n['key'] ?? null;
                if (! is_string($key) || ! preg_match('/^[a-z][a-z0-9_]*$/', $key)
                    || ($type === 'skills' && ! isset(CharacterRules::ABILITIES[$n['ability'] ?? '']))) {
                    return [];
                }

                return [$key => ['key' => $key, 'name' => $entry->name, 'ability' => $n['ability'] ?? null,
                    'compendium_entry_id' => $entry->id, 'source_id' => $entry->source_id]];
            })->all();
    }

    public function skills(): array
    {
        return $this->entries('skills');
    }

    public function ready(): bool
    {
        return count($this->skills()) === 18;
    }
}
