<?php

namespace App\Actions;

use App\Compendium\NpcTemplate;
use App\Items\ItemTransfers;
use App\Items\LootActions;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\CompendiumEntry;
use App\Models\LootContainer;
use App\Models\Scene;
use App\Models\User;
use App\Services\CharacterGameplay;
use App\Services\CharacterRules;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class NpcLibrary
{
    public function query(User $user): Builder
    {
        return Character::whereNull('campaign_id')->where('kind', 'npc')->where('library_user_id', $user->id);
    }

    public function find(User $user, int $id): Character
    {
        return $this->query($user)->findOrFail($id);
    }

    public function save(User $user, array $data): array
    {
        return DB::transaction(function () use ($user, $data) {
            $c = isset($data['id']) ? $this->query($user)->lockForUpdate()->findOrFail($data['id']) : (new Character)->forceFill(['library_user_id' => $user->id]);
            unset($data['id'], $data['owner_user_id'], $data['starting_items'], $data['starting_spells']);
            $data['kind'] = 'npc';
            $data['owner_user_id'] = null;
            $portrait = $data['portrait_asset_id'] ?? null;
            if ($portrait) {
                Asset::available()->whereNull('duration_ms')->sharedLock()->findOrFail($portrait);
            }
            $validation = $data;
            unset($validation['portrait_asset_id']);
            app(CharacterActions::class)->validate(null, $validation, $c->exists ? $c : null);
            app(CharacterRules::class)->prepare($data);
            app(CharacterGameplay::class)->validate(null, $data, $c->exists ? $c : null);
            $c->fill($data)->save();

            return ['character' => app(CharacterActions::class)->projection($c->fresh())];
        }, 3);
    }

    public function copy(User $user, array $data): array
    {
        return DB::transaction(function () use ($user, $data) {
            if (isset($data['npcId'])) {
                $source = $this->query($user)->lockForUpdate()->findOrFail($data['npcId']);
                $copy = $this->clone($source, null, $user);
            } else {
                $entry = CompendiumEntry::with('source')->whereNull('library_user_id')->where('entity_type', 'monsters')->sharedLock()->findOrFail($data['entryId']);
                $mapped = app(NpcTemplate::class)->map($entry);
                app(CharacterGameplay::class)->validate(null, $mapped, null);
                $copy = (new Character)->forceFill(['library_user_id' => $user->id, ...$mapped, 'npc_source' => [
                    'entryId' => $entry->id, 'checksum' => $entry->checksum, 'name' => $entry->source->name,
                    'version' => $entry->source->version, 'license' => $entry->source->license, 'url' => $entry->source->source_url,
                    'attribution' => $entry->source->metadata['attribution'] ?? '', 'reference' => $entry->normalized_data]]);
                $copy->save();
            }
            $copy->name = mb_substr($copy->name, 0, 71).' · копия';
            $copy->save();

            return ['character' => app(CharacterActions::class)->projection($copy)];
        }, 3);
    }

    public function place(User $user, Scene $scene, int $id, float $x, float $y, ?array $encounter = null): array
    {
        return DB::transaction(function () use ($user, $scene, $id, $x, $y, $encounter) {
            $campaign = Campaign::whereKey($scene->campaign_id)->lockForUpdate()->firstOrFail();
            Gate::forUser($user)->authorize('update', $campaign);
            $source = $this->query($user)->lockForUpdate()->findOrFail($id);
            $copy = $this->clone($source, $campaign, $user);
            $result = app(TokenActions::class)->create($user, $scene, ['character_id' => $copy->id, 'x' => $x, 'y' => $y, 'encounter' => $encounter]);
            if ($copy->npc_loot_backpack) {
                $token = $copy->tokens()->where('scene_id', $scene->id)->firstOrFail();
                $loot = LootContainer::create(['scene_id' => $scene->id, 'token_id' => $token->id,
                    'name' => $copy->name, 'kind' => 'corpse', 'created_by' => $user->id]);
                foreach ($copy->inventory()->with('definition')->whereNull('equipped_slot')->where('quantity', '>', 0)->get() as $item) {
                    app(ItemTransfers::class)->add($loot, $item->definition, $item->quantity, $item);
                }
                app(LootActions::class)->changed($user, $loot);
            }
            app(CharacterActions::class)->publish($user, $copy);
            $result['revision'] = $scene->fresh()->revision;
            $result['character'] = app(CharacterActions::class)->projection($copy->fresh());

            return $result;
        }, 3);
    }

    public function clone(Character $source, ?Campaign $campaign, User $user): Character
    {
        $copy = $source->replicate();
        $copy->forceFill(['campaign_id' => $campaign?->id, 'library_user_id' => $campaign ? null : $user->id,
            'owner_user_id' => null, 'lifecycle' => null, 'rest_state' => null, 'recovery_baseline' => null]);
        $copy->save();
        $definitions = [];
        foreach ($source->inventory()->with('definition')->where('quantity', '>', 0)->get() as $item) {
            $key = $item->item_definition_id;
            if (! isset($definitions[$key])) {
                $definition = $item->definition->replicate();
                $definition->campaign_id = $campaign?->id;
                $definition->save();
                $definitions[$key] = $definition->id;
            }
            $instance = $item->replicate();
            $instance->fill(['character_id' => $copy->id, 'item_definition_id' => $definitions[$key]])->save();
        }

        return $copy->fresh();
    }
}
