<?php

namespace App\Services;

use App\Models\Asset;
use App\Models\Campaign;
use App\Models\Scene;
use App\Models\Token;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class SceneSnapshotBuilder
{
    public function build(Scene $scene, User $user): array
    {
        // Shared lock keeps the revision and its entities from different commits from being mixed.
        return DB::transaction(function () use ($scene, $user) {
            $campaign = Campaign::whereKey($scene->campaign_id)->sharedLock()->firstOrFail();
            $scene = Scene::whereKey($scene->id)->sharedLock()->firstOrFail();
            $scene->setRelation('campaign', $campaign);
            Gate::forUser($user)->authorize('view', $scene);
            $gm = $scene->campaign->roleFor($user) === 'gm';
            $tokens = $scene->tokens()->with('imageAsset')->when(! $gm, fn ($query) => $query->where('is_hidden', false))->orderBy('z_index')->orderBy('id')->get();

            return [
                'id' => (string) $scene->id, 'campaignId' => (string) $scene->campaign_id,
                'name' => $scene->name, 'revision' => $scene->revision,
                'width' => $scene->width, 'height' => $scene->height,
                'grid' => $this->grid($scene), 'map' => $this->map($scene),
                'tokens' => $tokens->map(fn ($token) => $this->token($token, $gm, $user))->all(),
            ];
        });
    }

    public function grid(Scene $scene): array
    {
        return ['type' => 'square', 'size' => (float) $scene->grid_size,
            'offset' => ['x' => (float) $scene->grid_offset_x, 'y' => (float) $scene->grid_offset_y],
            'visible' => $scene->grid_visible, 'snap' => $scene->grid_snap];
    }

    public function asset(?Asset $asset): ?array
    {
        return $asset ? ['id' => (string) $asset->id, 'url' => '/api/assets/'.$asset->id,
            'width' => $asset->width, 'height' => $asset->height] : null;
    }

    public function map(Scene $scene): ?array
    {
        return $scene->map_asset_id ? ['asset' => $this->asset($scene->mapAsset),
            'x' => (float) $scene->map_x, 'y' => (float) $scene->map_y,
            'width' => (float) $scene->map_width, 'height' => (float) $scene->map_height] : null;
    }

    public function token(Token $token, bool $gm, User $user): array
    {
        $data = ['id' => (string) $token->id, 'name' => $token->name,
            'x' => (float) $token->x, 'y' => (float) $token->y, 'rotation' => (float) $token->rotation,
            'scale' => (float) $token->scale, 'size' => (float) $token->size,
            'kind' => 'hero', 'color' => 9751480, 'image' => $this->asset($token->imageAsset),
            'canMove' => $gm || ($token->owner_user_id === $user->id && ! $token->is_locked)];
        if ($gm) {
            $data += ['hp' => $token->hp, 'maxHp' => $token->max_hp, 'ac' => $token->ac, 'speed' => $token->speed,
                'isHidden' => $token->is_hidden, 'isLocked' => $token->is_locked,
                'ownerUserId' => $token->owner_user_id ? (string) $token->owner_user_id : null];
        }

        return $data;
    }
}
