<?php

namespace App\Compendium;

class SrdSpellMapper
{
    public function map(array $r): array
    {
        $description = SrdKeys::description($r);
        $range = ['text' => $r['range'] ?? null, 'distance' => SrdKeys::feet($r['range'] ?? null), 'unit' => 'ft'];
        $range['kind'] = $range['distance'] !== null ? 'distance' : strtolower($r['range'] ?? 'unknown');
        $area = isset($r['area_of_effect']) ? ['shape' => $r['area_of_effect']['type'], 'size' => $r['area_of_effect']['size'], 'unit' => 'ft', 'evidence' => 'api.area_of_effect'] : null;
        $save = isset($r['dc']['dc_type']) ? ['ability' => SrdKeys::ability($r['dc']['dc_type']['index']), 'on_success' => $r['dc']['dc_success'] ?? null, 'evidence' => 'api.dc'] : null;
        // Narrow textual extraction, never a generic rules parser. Preserve evidence for review.
        if (! $save && preg_match('/\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw\b/', $description, $m)) {
            $save = ['ability' => SrdKeys::ability($m[1]), 'on_success' => str_contains($description, 'half as much damage on a successful one') ? 'half' : null, 'evidence' => 'description'];
        }
        if (! $area && preg_match('/\b(\d+)-foot(-radius)? (Sphere|Cone|Cube|Cylinder|Line)\b/i', $description, $m)) {
            $area = ['shape' => strtolower($m[3]), 'size' => (float) $m[1], 'unit' => 'ft', 'evidence' => 'description'];
        }
        $damage = $r['damage'] ?? [];
        $dice = $damage['damage_at_slot_level'][(string) $r['level']] ?? null;

        return ['spell_level' => $r['level'], 'school' => SrdKeys::key($r['school']['index']), 'range' => $range, 'area' => $area,
            'casting_time' => $r['casting_time'] ?? null, 'duration' => $r['duration'] ?? null,
            'concentration' => $r['concentration'] ?? false, 'ritual' => $r['ritual'] ?? false,
            'components' => $r['components'] ?? [], 'material' => $r['material'] ?? null,
            'classes' => SrdKeys::refs($r['classes'] ?? []), 'saving_throw' => $save, 'attack_type' => $r['attack_type'] ?? null,
            'damage' => ['expression' => $dice, 'damage_type' => isset($damage['damage_type']) ? SrdKeys::key($damage['damage_type']['index']) : null,
                'at_slot_level' => $damage['damage_at_slot_level'] ?? [], 'at_character_level' => $damage['damage_at_character_level'] ?? []],
            'higher_level' => $r['higher_level'] ?? null, 'description' => $description,
            'mechanics_automated' => false];
    }
}
