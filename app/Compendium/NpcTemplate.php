<?php

namespace App\Compendium;

use App\Combat\CombatMetadata;
use App\Combat\CombatStats;
use App\Models\CompendiumEntry;
use App\Services\CharacterCatalog;
use App\Services\CharacterRules;
use App\Services\DamageRoller;
use Illuminate\Support\Str;

/** Conservative SRD conversion: simple attacks execute; prose stays a GM reference. */
class NpcTemplate
{
    public function map(CompendiumEntry $entry): array
    {
        $n = $entry->normalized_data;
        $rules = app(CharacterRules::class)->defaults();
        $rules['scores'] = array_replace($rules['scores'], array_filter($n['ability_scores'] ?? [], fn ($v) => is_int($v)));
        $rules['proficiency_bonus'] = $n['proficiency_bonus'] ?? 2;
        foreach (['saving_throws' => 'saves', 'skills' => 'skills'] as $source => $target) {
            foreach ($n[$source] ?? [] as $key => $value) {
                if (isset($rules[$target][$key])) {
                    // Preserve exact SRD totals; uncommon bonuses live in Advanced.
                    $rules[$target][$key]['proficient'] = true;
                    $rules[$target][$key]['bonus'] = $value - $this->modifier($rules, $key, $target) - $rules['proficiency_bonus'];
                }
            }
        }
        $ac = $n['armor_class'] ?? 10;
        if (is_array($ac)) {
            $ac = collect($ac)->max('value') ?? 10;
        }
        $abilities = [];
        foreach (['actions' => 'action', 'bonus_actions' => 'bonus_action', 'reactions' => 'reaction', 'traits' => 'free', 'legendary_actions' => 'free'] as $group => $activation) {
            foreach ($n[$group] ?? [] as $a) {
                if (count($abilities) >= 24) {
                    break;
                }
                $text = $a['desc'] ?? '';
                $parts = [];
                // Additional components may be conditional (e.g. Goblin advantage).
                // Only the base component executes; full prose remains in the source.
                foreach (array_slice($a['damage'] ?? [], 0, 1) as $d) {
                    $type = $d['damage_type']['index'] ?? null;
                    if ($type && in_array($type, CombatMetadata::types()) && isset($d['damage_dice']) && preg_match(DamageRoller::PATTERN, $d['damage_dice'])) {
                        $parts[] = ['dice' => $d['damage_dice'], 'type' => $type];
                    }
                }
                $attack = isset($a['attack_bonus']) && count($parts) > 0 && count($parts) <= 4 && $group !== 'traits';
                preg_match('/range\s+(\d+)(?:\/(\d+))?\s*(?:ft|feet)/i', $text, $range);
                preg_match('/reach\s+(\d+)\s*(?:ft|feet)/i', $text, $reach);
                $abilities[] = ['id' => (string) Str::uuid(), 'name' => mb_substr($a['name'], 0, 60),
                    'description' => mb_substr($text, 0, 700).' · Условные эффекты и особые правила разрешает GM.',
                    'icon' => $attack ? (isset($range[1]) ? 'bow' : 'sword') : 'spark',
                    'category' => $attack ? 'attack' : 'utility', 'target' => $attack ? 'token' : 'none', 'activation' => $activation,
                    'attack_type' => $attack ? (isset($range[1]) ? 'ranged' : 'melee') : 'utility',
                    'check' => $attack ? ['stat_key' => null, 'modifier' => $a['attack_bonus'], 'dc' => 0, 'dc_visible' => true, 'defense' => 'ac'] : null,
                    'costs' => [], 'damage' => null, 'damage_components' => $attack ? $parts : [],
                    'range' => $attack ? ['normal' => (int) ($range[1] ?? $reach[1] ?? 5), 'long' => isset($range[2]) ? (int) $range[2] : null] : null,
                    'result' => ['type' => 'nothing', 'target' => null, 'amount' => 0], 'enabled' => true, 'sort_order' => count($abilities)];
            }
        }

        $profile = array_diff_key(app(CombatStats::class)->fromMonster($n), array_flip(['ability_scores', 'saving_throws', 'proficiency_bonus']));
        foreach ($profile as $key => $values) {
            $allowed = $key === 'condition_immunities' ? array_keys(app(CharacterCatalog::class)->entries('conditions')) : CombatMetadata::types();
            $profile[$key] = array_values(array_intersect($values, $allowed));
        }

        return ['name' => mb_substr($entry->name, 0, 80), 'kind' => 'npc', 'disposition' => 'hostile', 'rules' => $rules,
            'hp' => $n['hp'], 'max_hp' => $n['hp'], 'ac' => $ac, 'speed' => $n['speed']['walk']['feet'] ?? 0,
            'combat_profile' => $profile,
            'resources' => [], 'abilities' => $abilities, 'check_stats' => [],
            'origin' => ['species' => mb_substr(($n['size'] ?? '').' '.($n['creature_type'] ?? ''), 0, 120)]];
    }

    private function modifier(array $rules, string $key, string $target): int
    {
        $ability = $target === 'saves' ? $key : (app(CharacterCatalog::class)->skills()[$key]['ability'] ?? 'dex');

        return app(CharacterRules::class)->abilityModifier($rules['scores'][$ability]);
    }
}
