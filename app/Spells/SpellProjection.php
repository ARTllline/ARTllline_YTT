<?php

namespace App\Spells;

use Illuminate\Support\Str;

/** Reviewed SRD 5.2.1 recipes. Source prose is reference only, never executable input. */
class SpellProjection
{
    public function recipe(string $key): ?array
    {
        $attack = fn ($dice, $type, $melee = false) => ['damage' => [$dice, $type], 'attack' => $melee ? 'melee' : 'ranged'];
        $save = fn ($dice, $type, $stat, $shape = null, $size = 0, $width = 0) => ['damage' => [$dice, $type], 'save' => $stat, 'area' => $shape ? ['shape' => $shape, 'size' => $size, 'width' => $width ?: $size] : null];

        return match ($key) {
            'acid-splash' => $save('1d6', 'acid', 'dex', 'circle', 5) + ['cantrip' => true, 'negates' => true],
            'circle-of-death' => $save('8d8', 'necrotic', 'con', 'circle', 60) + ['step' => '2d8'],
            'hellish-rebuke' => $save('2d10', 'fire', 'dex') + ['step' => '1d10'],
            'guiding-bolt' => $attack('4d6', 'radiant') + ['step' => '1d6'],
            'ray-of-sickness' => $attack('2d8', 'poison') + ['step' => '1d8'],
            'dissonant-whispers' => $save('3d6', 'psychic', 'wis') + ['step' => '1d6'],
            'blight' => $save('8d8', 'necrotic', 'con') + ['step' => '1d8'],
            'befuddlement' => $save('10d12', 'psychic', 'int'),
            'finger-of-death' => $save('7d8+30', 'necrotic', 'con'),
            'vicious-mockery' => $save('1d6', 'psychic', 'wis') + ['cantrip' => true, 'negates' => true],
            'heal' => ['healing' => '70', 'healing_step' => '10', 'spellcasting' => false, 'sight' => true, 'effects' => [['type' => 'remove_condition', 'key' => 'blinded', 'when' => 'always'], ['type' => 'remove_condition', 'key' => 'deafened', 'when' => 'always'], ['type' => 'remove_condition', 'key' => 'poisoned', 'when' => 'always']]],
            'mass-healing-word' => ['healing' => '2d4', 'healing_step' => '1d4', 'spellcasting' => true, 'sight' => true],
            'fire-bolt' => $attack('1d10', 'fire') + ['cantrip' => true],
            'poison-spray' => $attack('1d12', 'poison') + ['cantrip' => true],
            'ray-of-frost' => $attack('1d8', 'cold') + ['cantrip' => true, 'duration' => ['mode' => 'source_start', 'amount' => 1], 'effects' => [['type' => 'modifier', 'key' => 'speed', 'value' => -10, 'when' => 'hit']]],
            'shocking-grasp' => $attack('1d8', 'lightning', true) + ['cantrip' => true],
            'sacred-flame' => $save('1d8', 'radiant', 'dex') + ['cantrip' => true, 'negates' => true],
            'fireball' => $save('8d6', 'fire', 'dex', 'circle', 20) + ['step' => '1d6'],
            'burning-hands' => $save('3d6', 'fire', 'dex', 'cone', 15) + ['step' => '1d6', 'range' => 15],
            'lightning-bolt' => $save('8d6', 'lightning', 'dex', 'line', 100, 5) + ['step' => '1d6', 'range' => 100],
            'cone-of-cold' => $save('8d8', 'cold', 'con', 'cone', 60) + ['step' => '1d8', 'range' => 60],
            'shatter' => $save('3d8', 'thunder', 'con', 'circle', 10) + ['step' => '1d8'],
            'inflict-wounds' => $save('2d10', 'necrotic', 'con') + ['step' => '1d10'],
            'cure-wounds' => ['healing' => '2d8', 'healing_step' => '2d8', 'spellcasting' => true],
            'healing-word' => ['healing' => '2d4', 'healing_step' => '2d4', 'spellcasting' => true, 'sight' => true],
            'shield-of-faith' => ['effects' => [['type' => 'modifier', 'key' => 'ac', 'value' => 2, 'when' => 'always']]],
            'shield' => ['self' => true, 'duration' => ['mode' => 'source_start', 'amount' => 1], 'effects' => [['type' => 'modifier', 'key' => 'ac', 'value' => 5, 'when' => 'always']]],
            'bless' => ['effects' => [['type' => 'modifier', 'key' => 'attack', 'dice' => '1d4', 'when' => 'always'], ['type' => 'modifier', 'key' => 'save', 'dice' => '1d4', 'when' => 'always']]],
            'longstrider' => ['effects' => [['type' => 'modifier', 'key' => 'speed', 'value' => 10, 'when' => 'always']]],
            'false-life' => ['self' => true, 'effects' => [['type' => 'temporary_hp', 'dice' => '2d4+4', 'when' => 'always']], 'temporary_step' => '5'],
            'lesser-restoration' => ['effects' => [['type' => 'remove_condition', 'choices' => ['blinded', 'deafened', 'paralyzed', 'poisoned'], 'when' => 'always']]],
            'blindness-deafness' => ['save' => 'con', 'negates' => true, 'conditions' => [['key' => 'blinded', 'when' => 'failed_save', 'duration_mode' => 'until_removed']]],
            default => null,
        };
    }

    public function coverage(string $key): array
    {
        $rows = json_decode(file_get_contents(resource_path('data/spell-coverage.json')), true);

        return $rows[$key] ?? ['status' => 'MANUAL', 'reason' => 'Not reviewed; requires GM resolution.'];
    }

    public function ability(array $n, int $order): array
    {
        $key = $n['source_key'] ?? str_replace('_', '-', $n['key'] ?? '');
        $r = $this->recipe($key) ?? [];
        $coverage = $this->coverage($key);
        $time = $n['casting_time'] ?? 'Action';
        $range = $r['range'] ?? $n['range']['distance'] ?? ($n['range']['kind'] === 'touch' ? 5 : null);
        $a = ['id' => (string) Str::uuid(), 'name' => Str::limit($n['name'], 60, ''), 'icon' => isset($r['healing']) ? 'heart' : 'spark', 'description' => Str::limit($n['description'], 800, ''),
            'category' => isset($r['attack']) ? 'attack' : 'effect', 'attack_type' => isset($r['attack']) ? $r['attack'] : 'spell',
            'target' => ! $r ? 'none' : (isset($r['area']) ? 'point' : (! empty($r['self']) ? 'self' : 'token')),
            'check' => null, 'costs' => [], 'damage' => null, 'result' => ['type' => 'nothing', 'target' => null, 'amount' => 0], 'enabled' => true, 'sort_order' => $order,
            'activation' => str_starts_with(strtolower($time), 'reaction') ? 'reaction' : (str_contains(strtolower($time), 'bonus') ? 'bonus_action' : 'action'),
            'range' => $range !== null ? ['normal' => $range, 'long' => null] : null, 'area' => $r['area'] ?? null, 'requires_sight' => $r['sight'] ?? false,
            'spell' => ['level' => $n['spell_level'], 'school' => $n['school'], 'classes' => $n['classes'], 'known' => true, 'prepared' => false, 'available' => true, 'ritual' => $n['ritual'], 'concentration' => $n['concentration'],
                'source_key' => $key, 'source_entry_id' => $n['source_entry_id'] ?? null, 'reference' => $n['description']."\n\n".(is_array($n['higher_level']) ? implode("\n", $n['higher_level']) : ($n['higher_level'] ?? '')),
                'coverage' => $coverage['status'], 'reasons' => [$coverage['reason']], 'manual_allowed' => false,
                'casting_time' => $time, 'duration' => $r['duration'] ?? SpellMetadata::duration($n['duration']), 'duration_text' => $n['duration'], 'components' => $n['components'], 'material' => $n['material'], 'effects' => $r['effects'] ?? []]];
        if (isset($r['attack'])) {
            $a['attack'] = ['ability' => 'spellcasting', 'proficient' => true, 'bonus' => 0];
        }
        if (isset($r['save'])) {
            $a['save'] = ['ability' => $r['save'], 'dc_source' => 'spellcasting', 'dc' => 0, 'on_success' => ! empty($r['negates']) ? 'negates' : 'half', 'on_failure' => 'full'];
        }
        if (isset($r['damage'])) {
            $a['damage_components'] = [['dice' => $r['damage'][0], 'type' => $r['damage'][1]]];
        }
        if (isset($r['conditions'])) {
            $a['condition_effects'] = $r['conditions'];
        }
        if (isset($r['healing'])) {
            $a['result'] = ['type' => 'heal', 'target' => null, 'amount' => 0, 'dice' => $r['healing']];
        }
        if (isset($r['step'])) {
            $a['spell']['scaling']['damage'] = ['per_level' => $r['step']];
        }
        if (isset($r['healing'])) {
            $a['spell']['scaling']['healing'] = ['per_level' => $r['healing_step'], 'spellcasting' => $r['spellcasting']];
        }
        if (isset($r['temporary_step'])) {
            $a['spell']['scaling']['temporary_hp'] = ['per_level' => $r['temporary_step']];
        }
        if (! empty($r['cantrip'])) {
            $a['spell']['cantrip_dice'] = $r['damage'][0];
        }

        return $a;
    }
}
