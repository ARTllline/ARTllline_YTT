<?php

namespace App\Compendium;

class SrdEquipmentMapper
{
    public function type(array $r): string
    {
        $categories = SrdKeys::refs($r['equipment_categories'] ?? (isset($r['equipment_category']) ? [$r['equipment_category']] : []));

        return isset($r['armor_class']) || in_array('armor', $categories) ? 'armor'
            : (in_array('weapons', $categories) || isset($r['weapon_category']) ? 'weapons' : 'items');
    }

    public function map(array $r): array
    {
        $categories = SrdKeys::refs($r['equipment_categories'] ?? (isset($r['equipment_category']) ? [$r['equipment_category']] : []));
        $shield = in_array('shields', $categories);
        $armor = $r['armor_class'] ?? null;

        return ['category' => match ($this->type($r)) {
            'weapons' => 'weapon', 'armor' => 'armor', default => 'adventuring_item'
        },
            'equipment_categories' => $categories, 'description' => SrdKeys::description($r),
            'damage' => isset($r['damage']) ? ['expression' => $r['damage']['damage_dice'] ?? null, 'damage_type' => SrdKeys::key($r['damage']['damage_type']['index'])] : null,
            'two_handed_damage' => $r['two_handed_damage'] ?? null,
            'weapon_properties' => SrdKeys::refs($r['properties'] ?? []), 'weapon_mastery' => isset($r['mastery']) ? SrdKeys::key($r['mastery']['index']) : null,
            'range' => isset($r['range']) ? ['normal' => $r['range']['normal'], 'long' => $r['range']['long'] ?? null, 'unit' => 'ft'] : null,
            'throw_range' => $r['throw_range'] ?? null,
            'armor' => $armor ? ['category' => $shield ? 'shield' : (collect($categories)->first(fn ($c) => in_array($c, ['light_armor', 'medium_armor', 'heavy_armor'])) ?? $r['armor_category'] ?? null),
                'ac_semantics' => $shield ? 'bonus' : 'base', 'base_ac' => $shield ? null : $armor['base'], 'ac_bonus' => $shield ? $armor['base'] : null,
                'add_dex' => $armor['dex_bonus'] ?? false, 'max_dex_bonus' => $armor['max_bonus'] ?? null,
                'strength_minimum' => $r['str_minimum'] ?? null, 'stealth_disadvantage' => $r['stealth_disadvantage'] ?? false] : null,
            'cost' => $r['cost'] ?? null, 'weight' => isset($r['weight']) ? ['value' => $r['weight'], 'unit' => 'lb'] : null];
    }
}
