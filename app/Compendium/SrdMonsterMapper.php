<?php

namespace App\Compendium;

class SrdMonsterMapper
{
    public function map(array $r): array
    {
        $scores = [];
        foreach (['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] as $ability) {
            $scores[SrdKeys::ability($ability)] = $r[$ability] ?? null;
        }
        $saves = $skills = [];
        foreach ($r['proficiencies'] ?? [] as $p) {
            $key = $p['proficiency']['index'];
            if (str_starts_with($key, 'saving-throw-')) {
                $ability = SrdKeys::ability(substr($key, 13));
                if ($ability) {
                    $saves[$ability] = $p['value'];
                }
            } elseif (str_starts_with($key, 'skill-')) {
                $skills[SrdKeys::key(substr($key, 6))] = $p['value'];
            }
        }
        $speed = [];
        foreach ($r['speed'] ?? [] as $mode => $value) {
            $speed[$mode] = is_string($value) ? ['feet' => SrdKeys::feet($value), 'text' => $value] : $value;
        }

        return ['size' => strtolower($r['size']), 'creature_type' => $r['type'], 'subtype' => $r['subtype'] ?? null,
            'alignment' => $r['alignment'] ?? null, 'armor_class' => $r['armor_class'],
            'hp' => $r['hit_points'], 'hit_dice' => $r['hit_dice'] ?? null, 'hp_roll' => $r['hit_points_roll'] ?? null,
            'speed' => $speed, 'ability_scores' => $scores, 'saving_throws' => $saves, 'skills' => $skills,
            'senses' => $r['senses'] ?? [], 'languages' => $r['languages'] ?? null,
            'damage_vulnerabilities' => SrdKeys::refs($r['damage_vulnerabilities'] ?? []),
            'damage_resistances' => SrdKeys::refs($r['damage_resistances'] ?? []),
            'damage_immunities' => SrdKeys::refs($r['damage_immunities'] ?? []), 'condition_immunities' => SrdKeys::refs($r['condition_immunities'] ?? []),
            'actions' => $r['actions'] ?? [], 'bonus_actions' => $r['bonus_actions'] ?? [], 'reactions' => $r['reactions'] ?? [],
            'legendary_actions' => $r['legendary_actions'] ?? [], 'traits' => $r['special_abilities'] ?? [],
            'challenge_rating' => $r['challenge_rating'] ?? null, 'proficiency_bonus' => $r['proficiency_bonus'] ?? null,
            'mechanics_automated' => false];
    }
}
