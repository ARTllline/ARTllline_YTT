<?php

namespace App\Compendium;

use App\Actions\CharacterActions;
use App\Combat\CombatStats;
use App\Models\Campaign;
use App\Models\CompendiumEntry;
use App\Models\User;
use App\Services\CharacterGameplay;
use App\Services\CharacterRules;
use App\Spells\SpellProjection;
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
            $consumer = app(CompendiumContent::class);
            $consumer->require($entry, 'copy');
            $n = $consumer->normalized($entry);
            $character = null;
            if ($entry->entity_type === 'spells') {
                $character = $campaign->characters()->findOrFail($characterId);
                $abilities = $character->abilities ?? [];
                abort_if(count($abilities) >= 24, 422, 'У персонажа уже 24 способности.');
                $n['source_key'] = $entry->external_key;
                $n['source_entry_id'] = $entry->id;
                $ability = $consumer->ability($entry, count($abilities));
                $data = ['abilities' => [...$abilities, $ability]];
                Validator::make($data, CharacterGameplay::rules())->validate();
                app(CharacterGameplay::class)->validate($campaign, $data, $character);
                $character->update($data);
                app(CharacterActions::class)->publish($user, $character);
                $targetType = 'ability';
                $targetKey = $ability['id'];
                $content = ['ability' => $ability];
            } elseif (in_array($entry->entity_type, ['items', 'weapons', 'armor'])) {
                $item = $consumer->item($entry, $campaign->id);
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
            $copy = $consumer->receipt($entry, $user, $targetType, $targetKey, $campaign->id, $character?->id);

            return ['copy' => $copy] + $content;
        }, 3);
    }

    public function spell(array $n, int $order): array
    {
        return app(SpellProjection::class)->ability($n, $order);
    }
}
