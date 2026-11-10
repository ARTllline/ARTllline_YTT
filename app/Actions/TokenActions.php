<?php

namespace App\Actions;

use App\Combat\LifeCycle;
use App\Models\Asset;
use App\Models\CampaignMember;
use App\Models\Combat;
use App\Models\LootContainer;
use App\Models\Scene;
use App\Models\Token;
use App\Models\User;
use App\Services\SceneSnapshotBuilder;
use App\Services\TokenMovement;
use App\Services\TriggerEvents;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class TokenActions
{
    public function __construct(private SceneTransaction $transaction, private SceneSnapshotBuilder $snapshots) {}

    public function create(User $user, Scene $scene, array $data): array
    {
        return $this->transaction->run($scene, function ($scene) use ($user, $data) {
            Gate::forUser($user)->authorize('update', $scene);
            $character = null;
            $newCharacter = false;
            if (! empty($data['character_id'])) {
                $character = $scene->campaign->characters()->findOrFail($data['character_id']);
                if ($scene->tokens()->where('character_id', $character->id)->exists()) {
                    throw ValidationException::withMessages(['character_id' => 'Этот персонаж уже представлен на сцене.']);
                }
                // Placement accepts only spatial data: identity and vitals always come from Character.
                $data = array_diff_key($data, Token::CHARACTER_FIELDS);
                $data['name'] = $character->name;
            } elseif (($data['kind'] ?? null) === 'player_character') {
                $identity = [];
                foreach (Token::CHARACTER_FIELDS as $field => $target) {
                    if (array_key_exists($field, $data)) {
                        $identity[$target] = $data[$field];
                    }
                }
                app(CharacterActions::class)->validate($scene->campaign, $identity);
                $character = $scene->campaign->characters()->create($identity)->refresh();
                $newCharacter = true;
                $data['character_id'] = $character->id;
            }
            if (! empty($data['owner_user_id']) && ! CampaignMember::where('campaign_id', $scene->campaign_id)->where('user_id', $data['owner_user_id'])->exists()) {
                throw ValidationException::withMessages(['owner_user_id' => 'The controller must be a member of this campaign.']);
            }
            if (! empty($data['token_image_asset_id'])) {
                $asset = Asset::whereKey($data['token_image_asset_id'])->available($scene->campaign_id)->where('kind', 'token')->first();
                if (! $asset) {
                    throw ValidationException::withMessages(['token_image_asset_id' => 'Choose a token image belonging to this campaign.']);
                }
            }
            if (($data['hp'] ?? 10) > ($data['max_hp'] ?? 10)) {
                throw ValidationException::withMessages(['hp' => 'HP cannot exceed maximum HP.']);
            }
            $data['size'] = $scene->grid_visible ? max(20, min(300, $scene->grid_size)) : 60;
            $token = $scene->tokens()->create($data);
            $token->refresh();
            if ($newCharacter) {
                app(CharacterActions::class)->publish($user, $character, $scene->id);
            }

            return ['token' => $this->snapshots->token($token, true, $user), 'charactersChanged' => $character !== null];
        }, 'token.created');
    }

    public function update(User $user, Token $token, array $data, bool $move = false): array
    {
        return $this->transaction->run($token->scene, function ($scene) use ($user, $token, $data, $move) {
            $token = $scene->tokens()->whereKey($token->id)->firstOrFail();
            $token->setRelation('scene', $scene);
            Gate::forUser($user)->authorize($move ? 'move' : 'update', $token);
            $wasVisible = ! $token->is_hidden;
            $before = clone $token;
            $path = [];
            $acceptedPath = [];
            $control = $data['_directControl'] ?? null;
            $instant = $data['instant'] ?? false;
            $routeStep = $data['routeStep'] ?? false;
            unset($data['_directControl'], $data['instant'], $data['routeStep']);
            if ($control) {
                $data['direct_control'] = app(\App\Services\DirectControl::class)->step($user, $token, $control);
            }
            if ($move || array_key_exists('x', $data) || array_key_exists('y', $data)) {
                $intent = $data['intent'] ?? ($move ? TokenMovement::NORMAL : TokenMovement::EDIT);
                $movement = app(TokenMovement::class)->resolve($user, $token,
                    ['x' => $data['x'] ?? $token->x, 'y' => $data['y'] ?? $token->y], $data['waypoints'] ?? [], $intent,
                    $scene->vision_enabled && $scene->mapWorld ? app(\App\Services\SceneVisibility::class)->compiledGeometry($scene)['shapes'] : null);
                unset($data['intent'], $data['waypoints']);
                $data = $movement['position'] + $data;
                $acceptedPath = $movement['path'];
                if ($move) {
                    $path = $movement['path'];
                }
            }
            if (! $move) {
                if ($token->character_id) {
                    $identity = [];
                    foreach (Token::CHARACTER_FIELDS as $field => $target) {
                        if (array_key_exists($field, $data)) {
                            $identity[$target] = $data[$field];
                            unset($data[$field]);
                        }
                    }
                    if (isset($identity['max_hp']) && ! isset($identity['hp']) && $token->hp > $identity['max_hp']) {
                        $identity['hp'] = $identity['max_hp'];
                    }
                    if ($identity) {
                        app(CharacterActions::class)->updateLinked($user, $token, $identity);
                    }
                }
                if (! empty($data['owner_user_id']) && ! CampaignMember::where('campaign_id', $scene->campaign_id)->where('user_id', $data['owner_user_id'])->exists()) {
                    throw ValidationException::withMessages(['owner_user_id' => 'The controller must be a member of this campaign.']);
                }
                if (! empty($data['token_image_asset_id']) && ! Asset::whereKey($data['token_image_asset_id'])->available($scene->campaign_id)->where('kind', 'token')->exists()) {
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
            if (! $move && ! $token->character_id && array_key_exists('hp', $data)) {
                $life = app(LifeCycle::class);
                if (! $token->lifecycle) {
                    $token->update(['lifecycle' => $life->state($before)]);
                }
                abort_if($data['hp'] > 0 && $life->state($token)['status'] === 'dead', 422, 'Используйте GM revival.');
            }
            $token->update($data);
            if (! $move && ! $token->character_id && array_key_exists('hp', $data)) {
                app(LifeCycle::class)->hpChanged($user, $token, (int) $before->hp);
            }
            $token->refresh();
            $token->setRelation('scene', $scene);

            if (array_key_exists('x', $data) || array_key_exists('y', $data)) {
                app(TriggerEvents::class)->movement($scene, [[$before, $token, $acceptedPath]]);
            }

            $presentation = [];
            if ($routeStep && $path) {
                $length = 0;
                foreach (array_slice($path, 1) as $i => $point) {
                    $length += hypot($point['x'] - $path[$i]['x'], $point['y'] - $path[$i]['y']);
                }
                $presentation = ['continuous' => true, 'duration' => max(1, min(600, $length / 360 * 1000))];
            }
            return ($path ? ['tokenMovements' => [['tokenId' => (string) $token->id, 'path' => $path, 'instant' => $instant] + ($control ? ['continuous' => true, 'duration' => $data['direct_control']['duration']] : $presentation)]] : [])
                + ['token' => $this->snapshots->token($token, $scene->campaign->roleFor($user) === 'gm', $user), 'charactersChanged' => $token->character_id !== null && ! $move, '_wasVisible' => $wasVisible, '_combatChanged' => (! $control && $move) || array_key_exists('is_hidden', $data) || Combat::where('scene_id', $scene->id)->where('status', 'active')->exists()];
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
            abort_if(LootContainer::where('token_id', $token->id)->whereHas('items', fn ($q) => $q->where('quantity', '>', 0))->exists(), 422, 'Сначала переместите содержимое добычи.');
            $token->delete();

            return ['deletedId' => (string) $token->id, 'tokens' => $scene->tokens()->get()->map(fn ($t) => $this->snapshots->token($t, true, $user))->all(), '_wasVisible' => ! $token->is_hidden, '_combatChanged' => true];
        }, 'token.removed');
    }
}
