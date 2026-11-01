<?php

namespace App\Actions;

use App\Models\Campaign;
use App\Models\CampaignMember;
use App\Models\Character;
use App\Models\User;
use App\Spells\SpellEffects;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/** Personal library ownership and optional campaign assignment; runtime stays in CharacterActions. */
class CharacterLibrary
{
    public function query(User $user): Builder
    {
        return Character::where(function ($query) use ($user) {
            $query->where(fn ($q) => $q->where('kind', 'player_character')->where(function ($q) use ($user) {
                $q->where('library_user_id', $user->id)->orWhereIn('campaign_id', CampaignMember::where('user_id', $user->id)->where('role', 'gm')->select('campaign_id'));
            }))->orWhere(fn ($q) => $q->where('kind', 'npc')->whereNull('campaign_id')->where('library_user_id', $user->id));
        });
    }

    public function find(User $user, int $id): Character
    {
        return $this->query($user)->findOrFail($id);
    }

    public function save(User $user, array $data): array
    {
        return DB::transaction(function () use ($user, $data) {
            abort_if(($data['kind'] ?? 'player_character') !== 'player_character', 422, 'В этой библиотеке доступны только персонажи игроков.');
            $existing = isset($data['id']) ? $this->find($user, $data['id']) : null;
            abort_if($existing && $existing->kind !== 'player_character', 404);
            $target = $data['campaign_id'] ?? null;
            $previous = $existing?->campaign_id;
            // Keep the same campaign-first lock order as runtime mutations, including transfers.
            $campaigns = Campaign::whereIn('id', array_filter([$previous, $target]))->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            $campaign = $target ? $campaigns->get($target) : null;
            abort_if($target && ! $campaign, 404);
            if ($campaign) {
                Gate::forUser($user)->authorize('update', $campaign);
            }
            if ($existing) {
                $existing = $this->query($user)->whereKey($existing->id)->lockForUpdate()->firstOrFail();
                abort_if($existing->campaign_id !== $previous, 409, 'Назначение изменилось. Обновите библиотеку.');
                if ($previous !== ($campaign?->id)) {
                    abort_if($existing->library_user_id && $existing->library_user_id !== $user->id, 403, 'Изменить назначение кампании может владелец персонажа в библиотеке.');
                    abort_if($existing->tokens()->exists(), 409, 'Сначала уберите токены персонажа со сцен текущей кампании.');
                    abort_if($existing->inventory()->where('quantity', '>', 0)->whereHas('definition', fn ($q) => $q->whereNotNull('campaign_id'))->exists(), 409, 'Сначала уберите снаряжение текущей кампании из инвентаря.');
                    abort_if(app(SpellEffects::class)->active()->where('character_id', $existing->id)->exists(), 409, 'Сначала завершите активные эффекты заклинаний персонажа.');
                    $existing->inventory()->where('quantity', 0)->delete();
                    CampaignMember::where('active_character_id', $existing->id)->update(['active_character_id' => null]);
                    $existing->forceFill(['campaign_id' => $campaign?->id, 'owner_user_id' => null, 'portrait_asset_id' => $existing->portrait_asset_id])->save();
                    $existing->unsetRelation('campaign');
                    $existing->unsetRelation('portraitAsset');
                    // Reusable portrait IDs follow the character.
                    $data['portrait_asset_id'] = $data['portrait_asset_id'] ?? $existing->portrait_asset_id;
                }
                if (! $existing->library_user_id) {
                    $existing->forceFill(['library_user_id' => $user->id])->save();
                }
            }
            unset($data['campaign_id']);
            $result = app(CharacterActions::class)->save($user, $campaign, $data, $existing);
            if ($previous && $previous !== $campaign?->id && isset($campaigns[$previous])) {
                $oldProjection = clone $existing;
                $oldProjection->setRelation('campaign', $campaigns[$previous]);
                app(CharacterActions::class)->publish($user, $oldProjection);
            }

            return $result;
        }, 3);
    }

    public function delete(User $user, int $id): array
    {
        return DB::transaction(function () use ($user, $id) {
            $character = $this->find($user, $id);
            $campaign = $character->campaign_id ? Campaign::whereKey($character->campaign_id)->lockForUpdate()->firstOrFail() : null;
            if ($campaign) {
                Gate::forUser($user)->authorize('update', $campaign);
            }
            $character = $this->query($user)->whereKey($id)->lockForUpdate()->firstOrFail();
            abort_if($character->campaign_id !== $campaign?->id, 409, 'Назначение изменилось. Обновите библиотеку.');
            abort_if($character->tokens()->exists(), 409, 'Сначала уберите токены персонажа со сцен.');
            $character->delete();
            app(CharacterActions::class)->publish($user, $character);

            return ['deletedCharacterId' => (string) $id];
        }, 3);
    }
}
