<?php

namespace App\Actions;

use App\Models\Asset;
use App\Models\CampaignMember;
use App\Models\Combat;
use App\Models\Scene;
use App\Models\Token;
use App\Models\User;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class TokenActions
{
    public function __construct(private SceneTransaction $transaction, private SceneSnapshotBuilder $snapshots) {}

    public function create(User $user, Scene $scene, array $data): array
    {
        return $this->transaction->run($scene, function ($scene) use ($user, $data) {
            Gate::forUser($user)->authorize('update', $scene);
            $token = $scene->tokens()->create($data);
            $token->refresh();

            return ['token' => $this->snapshots->token($token, true, $user)];
        }, 'token.created');
    }

    public function update(User $user, Token $token, array $data, bool $move = false): array
    {
        return $this->transaction->run($token->scene, function ($scene) use ($user, $token, $data, $move) {
            $token = $scene->tokens()->whereKey($token->id)->firstOrFail();
            $token->setRelation('scene', $scene);
            Gate::forUser($user)->authorize($move ? 'move' : 'update', $token);
            $wasVisible = ! $token->is_hidden;
            if (! $move) {
                if (! empty($data['owner_user_id']) && ! CampaignMember::where('campaign_id', $scene->campaign_id)->where('user_id', $data['owner_user_id'])->exists()) {
                    throw ValidationException::withMessages(['owner_user_id' => 'The controller must be a member of this campaign.']);
                }
                if (! empty($data['token_image_asset_id']) && ! Asset::whereKey($data['token_image_asset_id'])->where('campaign_id', $scene->campaign_id)->where('kind', 'token')->exists()) {
                    throw ValidationException::withMessages(['token_image_asset_id' => 'Choose a token image belonging to this campaign.']);
                }
                $maxHp = $data['max_hp'] ?? $token->max_hp;
                if (isset($data['hp']) && $data['hp'] > $maxHp) {
                    throw ValidationException::withMessages(['hp' => 'HP cannot exceed maximum HP.']);
                }
                if (! isset($data['hp']) && $token->hp > $maxHp) {
                    $data['hp'] = $maxHp;
                }
            }
            $token->update($data);
            $token->refresh();
            $token->setRelation('scene', $scene);

            return ['token' => $this->snapshots->token($token, $scene->campaign->roleFor($user) === 'gm', $user), '_wasVisible' => $wasVisible, '_combatChanged' => array_key_exists('is_hidden', $data)];
        }, $move ? 'token.moved' : 'token.updated');
    }

    public function delete(User $user, Token $token): array
    {
        return $this->transaction->run($token->scene, function ($scene) use ($user, $token) {
            $token = $scene->tokens()->whereKey($token->id)->firstOrFail();
            $token->setRelation('scene', $scene);
            Gate::forUser($user)->authorize('update', $token);
            $combat = Combat::where('scene_id', $scene->id)->whereIn('status', ['preparing', 'active'])->first();
            if ($combat && ($entry = $combat->combatants()->where('token_id', $token->id)->first())) {
                app(CombatActions::class)->remove($combat, (string) $entry->id);
            }
            $token->delete();

            return ['deletedId' => (string) $token->id, '_wasVisible' => ! $token->is_hidden, '_combatChanged' => true];
        }, 'token.removed');
    }
}
