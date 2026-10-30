<?php

namespace App\Compendium;

use App\Actions\CharacterActions;
use App\Combat\CombatStats;
use App\Models\Campaign;
use App\Models\CompendiumCopy;
use App\Models\CompendiumEntry;
use App\Models\ItemDefinition;
use App\Models\User;
use App\Services\CharacterGameplay;
use App\Services\CharacterRules;
use App\Services\DamageRoller;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class CopyCompendiumEntry
{
    public function copy(User $user, Campaign $campaign, CompendiumEntry $entry, ?int $characterId): array
    {
        return DB::transaction(function () use ($user, $campaign, $entry, $characterId) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($user)->authorize('update', $campaign);
            // A concurrent sync cannot change the source between mapping and recording provenance.
            $entry = CompendiumEntry::with('source')->whereKey($entry->id)->sharedLock()->firstOrFail();
            $n = $entry->normalized_data;
            $character = null;
            if ($entry->entity_type === 'spells') {
                $character = $campaign->characters()->findOrFail($characterId);
                $abilities = $character->abilities ?? [];
                abort_if(count($abilities) >= 24, 422, 'У персонажа уже 24 способности.');
                $ability = $this->spell($n, count($abilities));
                $data = ['abilities' => [...$abilities, $ability]];
                Validator::make($data, CharacterGameplay::rules())->validate();
                app(CharacterGameplay::class)->validate($campaign, $data, $character);
                $character->update($data);
                app(CharacterActions::class)->publish($user, $character);
                $targetType = 'ability';
                $targetKey = $ability['id'];
                $content = ['ability' => $ability];
            } elseif (in_array($entry->entity_type, ['items', 'weapons', 'armor'])) {
                $weapon = $n['category'] === 'weapon';
                $armor = $n['category'] === 'armor';
                $shield = ($n['armor']['category'] ?? null) === 'shield';
                $item = (new ItemDefinition)->forceFill(['campaign_id' => $campaign->id,
                    'name' => Str::limit($n['name'], 80, ''), 'description' => Str::limit($n['description'], 1000, ''),
                    'icon' => $weapon ? 'item_sword' : ($shield ? 'item_shield' : ($armor ? 'item_armor' : 'book')),
                    'category' => $weapon ? 'weapon' : ($armor ? 'armor' : 'trinket'), 'rarity' => 'common',
                    'width' => 1, 'height' => 1, 'max_stack' => 1,
                    'equipment_slots' => $weapon ? ['main_hand'] : ($shield ? ['off_hand'] : ($armor ? ['armor'] : [])),
                    // Base AC is not an additive modifier. Training/armor rules remain future work.
                    'modifiers' => [], 'use_ability_id' => null]);
                $item->save();
                $targetType = 'item';
                $targetKey = $item->id;
                $content = ['definition' => $item];
            } elseif ($entry->entity_type === 'monsters') {
                $checks = [];
                foreach ($n['ability_scores'] as $key => $score) {
                    if ($score !== null) {
                        $checks[] = ['key' => $key, 'label' => strtoupper($key), 'modifier' => app(CharacterRules::class)->abilityModifier($score)];
                    }
                }
                foreach ($n['saving_throws'] as $key => $value) {
                    $checks[] = ['key' => 'save_'.$key, 'label' => 'Save '.strtoupper($key), 'modifier' => $value];
                }
                foreach ($n['skills'] as $key => $value) {
                    $checks[] = ['key' => $key, 'label' => Str::headline($key), 'modifier' => $value];
                }
                $ac = is_numeric($n['armor_class']) ? $n['armor_class'] : (collect($n['armor_class'])->first(fn ($a) => empty($a['condition']))['value'] ?? null);
                $character = $campaign->characters()->create(['name' => Str::limit($n['name'], 80, ''), 'kind' => 'npc', 'disposition' => 'hostile',
                    'combat_profile' => app(CombatStats::class)->fromMonster($n),
                    'hp' => $n['hp'], 'max_hp' => $n['hp'], 'ac' => $ac, 'speed' => $n['speed']['walk']['feet'] ?? null,
                    'check_stats' => $checks, 'resources' => [], 'abilities' => []]);
                app(CharacterActions::class)->publish($user, $character);
                $targetType = 'creature';
                $targetKey = (string) $character->id;
                $content = ['character' => app(CharacterActions::class)->projection($character)];
            } else {
                abort(422, 'Эта запись доступна как справочник; копирование не требуется.');
            }
            $copy = CompendiumCopy::create(['campaign_id' => $campaign->id, 'compendium_entry_id' => $entry->id,
                'character_id' => $character?->id, 'target_type' => $targetType, 'target_key' => $targetKey,
                'source_checksum' => $entry->checksum,
                'source_reference' => ['key' => $entry->source->key, 'version' => $entry->source->version, 'license' => $entry->source->license,
                    'external_key' => $entry->external_key, 'normalization_version' => $entry->normalization_version,
                    'attribution' => $entry->source->metadata['attribution'], 'source_url' => $entry->source->source_url],
                'snapshot' => ['raw_data' => $entry->raw_data, 'normalized_data' => $n], 'created_at' => now()]);

            return ['copy' => $copy] + $content;
        }, 3);
    }

    public function spell(array $n, int $order): array
    {
        $area = $n['area'];
        // Only YTT-compatible geometry; cylinder height and other dimensions stay in the snapshot.
        $shape = match ($area['shape'] ?? null) {
            'sphere' => 'circle', 'cone' => 'cone', 'cube' => 'rectangle', default => null
        };
        $geometry = $shape ? ['shape' => $shape, 'size' => $area['size'], 'width' => $area['size']] : null;
        $attack = $n['attack_type'] && ! $n['saving_throw'] && ! $area;
        $range = $n['range']['distance'];
        if ($geometry && $shape === 'cone' && $range === null && $n['range']['kind'] === 'self') {
            $range = $area['size'];
        }
        // E.g. Dragon's Breath grants a later cone to a touched creature. Do not
        // mistake that secondary effect for the casting geometry or expand range.
        if ($geometry && (($n['range']['kind'] === 'touch') || ($shape === 'cone' && ($range === null || $range < $area['size'])))) {
            $geometry = null;
        }
        $dice = $n['damage']['expression'];
        $safeDice = is_string($dice) && preg_match(DamageRoller::PATTERN, $dice) ? $dice : null;

        return ['id' => (string) Str::uuid(), 'name' => Str::limit($n['name'], 60, ''), 'icon' => 'spark',
            'description' => Str::limit($n['description'], 800, ''),
            'category' => $attack ? 'attack' : ($geometry ? 'effect' : 'utility'), 'attack_type' => 'spell',
            'target' => $geometry ? 'point' : ($attack ? 'token' : ($n['range']['kind'] === 'self' ? 'self' : 'none')),
            'check' => $attack ? ['stat_key' => 'spell_attack', 'modifier' => 0, 'dc' => 0, 'dc_visible' => false, 'defense' => 'ac'] : null,
            'range' => $range !== null ? ['normal' => $range, 'long' => null] : null, 'area' => $geometry,
            'damage' => $attack || $geometry ? $safeDice : null, 'costs' => [],
            'result' => ['type' => 'nothing', 'target' => null, 'amount' => 0], 'sort_order' => $order,
            'enabled' => false, // GM reviews unsupported saves/conditional damage before enabling.
            'spell' => ['level' => $n['spell_level'], 'school' => $n['school'], 'classes' => $n['classes'],
                'known' => true, 'prepared' => false, 'ritual' => $n['ritual'], 'concentration' => $n['concentration']]];
    }
}
