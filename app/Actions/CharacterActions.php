<?php

namespace App\Actions;

use App\Models\Asset;
use App\Models\Campaign;
use App\Models\CampaignMember;
use App\Models\Character;
use App\Models\Token;
use App\Models\User;
use App\Services\CharacterGameplay;
use App\Services\CharacterRules;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class CharacterActions
{
    public function validate(Campaign $campaign, array $data, ?Character $character = null): void
    {
        if (! empty($data['owner_user_id']) && ! CampaignMember::where('campaign_id', $campaign->id)->where('user_id', $data['owner_user_id'])->where('role', 'player')->exists()) {
            throw ValidationException::withMessages(['owner_user_id' => 'Назначьте игрока этой кампании.']);
        }
        if (! empty($data['portrait_asset_id']) && ! Asset::where('campaign_id', $campaign->id)->where('kind', 'token')->whereKey($data['portrait_asset_id'])->exists()) {
            throw ValidationException::withMessages(['portrait_asset_id' => 'Выберите портрет этой кампании.']);
        }
        if (($data['hp'] ?? $character?->hp ?? 10) > ($data['max_hp'] ?? $character?->max_hp ?? 10)) {
            throw ValidationException::withMessages(['hp' => 'HP cannot exceed maximum HP.']);
        }
    }

    public function save(User $user, Campaign $campaign, array $data): array
    {
        return DB::transaction(function () use ($user, $campaign, $data) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($user)->authorize('update', $campaign);
            $character = isset($data['id']) ? $campaign->characters()->findOrFail($data['id']) : null;
            unset($data['id']);
            $this->validate($campaign, $data, $character);
            app(CharacterRules::class)->prepare($data);
            app(CharacterGameplay::class)->validate($campaign, $data, $character);
            if ($character) {
                $character->update($data);
            } else {
                $character = $campaign->characters()->create($data)->refresh();
            }
            $this->publish($user, $character);

            return ['character' => $this->projection($character)];
        }, 3);
    }

    /** Called by existing token/Combat writers under the campaign lock. No shadow HP writes. */
    public function updateLinked(User $user, Token $token, array $data): void
    {
        $character = $token->character()->firstOrFail();
        $this->validate($token->scene->campaign, $data, $character);
        $character->update($data);
        $this->publish($user, $character, $token->scene_id);
        $token->unsetRelation('character');
        $token->unsetRelation('imageAsset');
    }

    public function publish(User $user, Character $character, ?int $exceptScene = null): void
    {
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
        return ['rules' => app(CharacterRules::class)->state($character), 'derived' => app(CharacterRules::class)->derived($character),
            ...($gm ? ['rulesSuggestion' => app(CharacterRules::class)->suggestion($character)] : []),
            'id' => (string) $character->id, 'name' => $character->name,
            'portrait' => app(SceneSnapshotBuilder::class)->asset($character->portraitAsset),
            'ownerUserId' => $character->owner_user_id ? (string) $character->owner_user_id : null,
            'kind' => $character->kind, 'disposition' => $character->disposition,
            'ac' => $gm ? $character->getRawOriginal('ac') : $character->ac, 'speed' => $gm ? $character->getRawOriginal('speed') : $character->speed,
            'resources' => collect($character->resources ?? [])->sortBy('sort_order')->values()->all(),
            'abilities' => app(CharacterGameplay::class)->abilities($character, $gm),
            'checkStats' => $gm ? (json_decode($character->getRawOriginal('check_stats') ?? '[]', true) ?? []) : ($character->check_stats ?? []), 'hp' => $character->hp, 'maxHp' => $character->max_hp];
    }

    public function roster(Campaign $campaign, User $user): array
    {
        $gm = $campaign->roleFor($user) === 'gm';
        $characters = $campaign->characters()->with('portraitAsset')->when(! $gm, fn ($q) => $q->where('owner_user_id', $user->id))->orderBy('name')->orderBy('id')->get();
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
