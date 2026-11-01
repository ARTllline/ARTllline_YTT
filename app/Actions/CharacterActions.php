<?php

namespace App\Actions;

use App\Combat\LifeCycle;
use App\Compendium\CopyCompendiumEntry;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\CampaignMember;
use App\Models\Character;
use App\Models\CompendiumEntry;
use App\Models\Token;
use App\Models\User;
use App\Realtime\CommandContext;
use App\Services\CharacterGameplay;
use App\Services\CharacterRules;
use App\Services\SceneSnapshotBuilder;
use App\Spells\SpellCasting;
use App\Spells\SpellEffects;
use App\Support\RequestPerformance;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class CharacterActions
{
    public function validate(?Campaign $campaign, array $data, ?Character $character = null): void
    {
        if (! $campaign && ! empty($data['owner_user_id'])) {
            throw ValidationException::withMessages(['campaign_id' => 'Сначала назначьте кампанию для игрока или приватного портрета.']);
        }
        if (! empty($data['owner_user_id']) && ! CampaignMember::where('campaign_id', $campaign->id)->where('user_id', $data['owner_user_id'])->where('role', 'player')->exists()) {
            throw ValidationException::withMessages(['owner_user_id' => 'Назначьте игрока этой кампании.']);
        }
        if (! empty($data['portrait_asset_id'])) {
            $portrait = Asset::whereNull('duration_ms')->whereKey($data['portrait_asset_id'])->sharedLock()->first();
            if (! $portrait || ! Gate::allows('view', $portrait)) {
                throw ValidationException::withMessages(['portrait_asset_id' => 'Выберите изображение из библиотеки Assets.']);
            }
        }
        if (($data['hp'] ?? $character?->hp ?? 10) > ($data['max_hp'] ?? $character?->max_hp ?? 10)) {
            throw ValidationException::withMessages(['hp' => 'HP cannot exceed maximum HP.']);
        }
        foreach ($data['hit_point_dice'] ?? [] as $pool) {
            if ($pool['current'] > $pool['max']) {
                throw ValidationException::withMessages(['hit_point_dice' => 'Остаток Hit Dice не может превышать максимум.']);
            }
        }
    }

    public function save(User $user, ?Campaign $campaign, array $data, ?Character $libraryCharacter = null): array
    {
        return DB::transaction(function () use ($user, $campaign, $data, $libraryCharacter) {
            if ($campaign) {
                $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
                Gate::forUser($user)->authorize('update', $campaign);
            }
            $character = $libraryCharacter ?? (isset($data['id']) ? $campaign?->characters()->findOrFail($data['id']) : null);
            abort_if(! $campaign && (! empty($data['starting_items']) || ! empty($data['starting_spells'])), 422, 'Назначьте кампанию перед выбором её снаряжения и заклинаний.');
            abort_if($character && (! empty($data['starting_items']) || ! empty($data['starting_spells'])), 422, 'Starting loadout is only available on creation.');
            $items = $data['starting_items'] ?? [];
            $spells = $data['starting_spells'] ?? [];
            unset($data['id'], $data['starting_items'], $data['starting_spells']);
            $exhaustion = $data['exhaustion'] ?? null;
            unset($data['exhaustion']);
            $this->validate($campaign, $data, $character);
            app(CharacterRules::class)->prepare($data);
            app(CharacterGameplay::class)->validate($campaign, $data, $character);
            if ($character) {
                $beforeHp = $character->hp;
                if (! $character->lifecycle) {
                    $character->update(['lifecycle' => app(LifeCycle::class)->state($character)]);
                }
                abort_if(isset($data['hp']) && $data['hp'] > 0 && app(LifeCycle::class)->state($character)['status'] === 'dead', 422, 'Используйте GM-коррекцию возвращения к жизни.');
                $character->update($data);
                if (array_key_exists('hp', $data)) {
                    app(LifeCycle::class)->hpChanged($user, $character, $beforeHp);
                }
            } else {
                $character = (new Character)->forceFill(['campaign_id' => $campaign?->id, 'library_user_id' => ($data['kind'] ?? 'player_character') === 'player_character' ? $user->id : null, ...$data]);
                $character->save();
                $character->refresh();
                if ($character->hp === 0) {
                    app(LifeCycle::class)->save($user, $character, app(LifeCycle::class)->state($character), 'created_at_zero');
                }
            }
            if ($exhaustion !== null && $exhaustion !== $character->exhaustion) {
                app(LifeCycle::class)->exhaustion($user, $character, $exhaustion);
            }
            foreach ($items as $item) {
                $context = app(CommandContext::class);
                $parentId = $context->mutationId;
                try {
                    $context->mutationId = (string) Str::uuid();
                    app(InventoryActions::class)->command($user, $campaign, $character, ['action' => 'give', ...$item]);
                } finally {
                    $context->mutationId = $parentId;
                }
            }
            foreach ($spells as $id) {
                $entry = CompendiumEntry::where('entity_type', 'spells')->findOrFail($id);
                app(CopyCompendiumEntry::class)->copy($user, $campaign, $entry, $character->id);
            }
            $character = $character->fresh();
            $this->publish($user, $character);

            return ['character' => $this->projection($character)];
        }, 3);
    }

    public function delete(User $user, Campaign $campaign, Character $character): array
    {
        return DB::transaction(function () use ($user, $campaign, $character) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($user)->authorize('update', $campaign);
            $character = $campaign->characters()->findOrFail($character->id);
            abort_if($character->tokens()->exists(), 409, 'Сначала уберите все представления персонажа со сцен.');
            $character->delete();
            $this->publish($user, $character);

            return ['deletedCharacterId' => (string) $character->id];
        }, 3);
    }

    /** Called by existing token/Combat writers under the campaign lock. No shadow HP writes. */
    public function updateLinked(User $user, Token $token, array $data): void
    {
        $character = $token->character()->firstOrFail();
        $this->validate($token->scene->campaign, $data, $character);
        $beforeHp = $character->hp;
        if (array_key_exists('hp', $data)) {
            if (! $character->lifecycle) {
                $character->update(['lifecycle' => app(LifeCycle::class)->state($character)]);
            }
            abort_if($data['hp'] > 0 && app(LifeCycle::class)->state($character)['status'] === 'dead', 422, 'Используйте GM revival.');
        }
        $character->update($data);
        $token->setRelation('character', $character);
        if (array_key_exists('hp', $data)) {
            app(LifeCycle::class)->hpChanged($user, $token, $beforeHp);
        }
        $this->publish($user, $character, $token->scene_id);
        $token->unsetRelation('character');
        $token->unsetRelation('imageAsset');
    }

    public function publish(User $user, Character $character, ?int $exceptScene = null): void
    {
        if (! $character->campaign) {
            return;
        }
        // Existing campaign-first writer serialization also serializes damage from different scenes.
        foreach ($character->campaign->scenes()->when($exceptScene, fn ($q) => $q->where('id', '!=', $exceptScene))->orderBy('id')->get() as $scene) {
            app(SceneTransaction::class)->run($scene, function ($scene) use ($character, $user) {
                $token = $scene->tokens()->where('character_id', $character->id)->first();

                return ['_combatChanged' => true, 'charactersChanged' => true] + ($token ? ['token' => app(SceneSnapshotBuilder::class)->token($token, true, $user), '_wasVisible' => ! $token->is_hidden] : []);
            }, 'character.updated');
        }
    }

    public function projection(Character $character, bool $gm = true): array
    {
        return app(SpellEffects::class)->project(fn () => ['lifecycle' => app(LifeCycle::class)->state($character), 'exhaustion' => $character->exhaustion, 'hitPointDice' => $character->hit_point_dice ?? [], 'rest' => $character->rest_state, 'temporaryHp' => $character->temporary_hp ?? 0, 'spellcasting' => app(SpellCasting::class)->state($character), 'spellEffects' => app(SpellEffects::class)->projection($character), 'rules' => app(CharacterRules::class)->state($character), 'derived' => app(CharacterRules::class)->derived($character),
            ...($gm ? ['combatProfile' => $character->combat_profile, 'npcLootBackpack' => (bool) $character->npc_loot_backpack, 'npcSource' => $character->npc_source, 'rulesSuggestion' => app(CharacterRules::class)->suggestion($character)] : []),
            'inventoryRevision' => $this->inventoryRevision($character),
            'campaignId' => $character->campaign_id ? (string) $character->campaign_id : null,
            'campaignName' => $character->campaign?->name,
            'origin' => $character->origin,
            'id' => (string) $character->id, 'name' => $character->name,
            'portrait' => app(SceneSnapshotBuilder::class)->asset($character->portraitAsset),
            'ownerUserId' => $character->campaign_id && $character->owner_user_id ? (string) $character->owner_user_id : null,
            'kind' => $character->kind, 'disposition' => $character->disposition,
            'ac' => $gm ? $character->getRawOriginal('ac') : $character->ac, 'speed' => $gm ? $character->getRawOriginal('speed') : $character->speed,
            'resources' => collect($character->resources ?? [])->sortBy('sort_order')->values()->all(),
            'abilities' => app(CharacterGameplay::class)->abilities($character, $gm),
            'checkStats' => $gm ? (json_decode($character->getRawOriginal('check_stats') ?? '[]', true) ?? []) : ($character->check_stats ?? []), 'hp' => $character->hp, 'maxHp' => $character->max_hp]);
    }

    public function roster(Campaign $campaign, User $user): array
    {
        return app(RequestPerformance::class)->measure('character_dto', fn () => app(SpellEffects::class)->project(fn () => $this->rosterMeasured($campaign, $user)));
    }

    /** Content identity, not a cache: quantity, equipment and definition edits invalidate it. */
    private function inventoryRevision(Character $character): string
    {
        $character->loadMissing('inventory.definition');

        return hash('sha256', json_encode([app(CharacterGameplay::class)->abilities($character, false, true, false), $character->inventory->sortBy('id')->map(fn ($item) => [
            $item->getAttributes(), $item->definition->projection(false),
        ])->values()->all()], JSON_THROW_ON_ERROR));
    }

    private function rosterMeasured(Campaign $campaign, User $user): array
    {
        $gm = $campaign->roleFor($user) === 'gm';
        $characters = $campaign->characters()->with(['portraitAsset', 'inventory.definition'])->when(! $gm, fn ($q) => $q->where('owner_user_id', $user->id))->orderBy('name')->orderBy('id')->get();
        $active = CampaignMember::where('campaign_id', $campaign->id)->where('user_id', $user->id)->value('active_character_id');
        $active = $active && $characters->contains('id', $active) ? (string) $active : null;

        return ['characters' => $characters->map(fn ($c) => $this->projection($c, $gm))->all(), 'activeCharacterId' => $gm ? null : $active];
    }

    public function select(User $user, Campaign $campaign, ?int $id): array
    {
        return DB::transaction(function () use ($user, $campaign, $id) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            abort_unless($campaign->roleFor($user) === 'player', 403);
            if ($id !== null) {
                abort_unless($campaign->characters()->where('owner_user_id', $user->id)->whereKey($id)->exists(), 403);
            }
            CampaignMember::where('campaign_id', $campaign->id)->where('user_id', $user->id)->update(['active_character_id' => $id]);
            if ($campaign->active_scene_id) {
                app(SceneTransaction::class)->run($campaign->scenes()->findOrFail($campaign->active_scene_id), fn () => ['charactersChanged' => true], 'character.active_changed');
            }

            return $this->roster($campaign, $user);
        });
    }
}
