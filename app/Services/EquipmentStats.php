<?php

namespace App\Services;

use App\Models\Character;

/** Compute over original attributes; never write derived values back to Character. */
class EquipmentStats
{
    public function apply(Character $character, string $key, mixed $base): mixed
    {
        if (! $character->exists) {
            return $base;
        }
        $character->loadMissing('inventory.definition');
        foreach ($character->inventory as $item) {
            if (! $item->equipped_slot || $item->quantity < 1) {
                continue;
            }
            $mods = $item->definition->modifiers;
            if (in_array($key, ['ac', 'speed']) && $base !== null) {
                $base += $mods[$key] ?? 0;
            }
            if ($key === 'check_stats') {
                $base = array_map(fn ($s) => [...$s, 'modifier' => $s['modifier'] + ($mods['checks'][$s['key']] ?? 0)], $base ?? []);
            }
        }

        return match ($key) {
            'ac' => $base === null ? null : max(0, min(99, $base)),
            'speed' => $base === null ? null : max(0, min(999, $base)),
            default => $base,
        };
    }
}
