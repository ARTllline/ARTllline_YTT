<?php

namespace App\Policies;

use App\Models\Asset;
use App\Models\Scene;
use App\Models\Token;
use App\Models\User;

class AssetPolicy
{
    public function view(User $user, Asset $asset): bool
    {
        $campaign = $asset->campaign;
        $role = $campaign->roleFor($user);
        if ($role === 'gm') {
            return true;
        }
        if ($role !== 'player' || ! $campaign->active_scene_id) {
            return false;
        }

        return Scene::whereKey($campaign->active_scene_id)->where('campaign_id', $campaign->id)->where('map_asset_id', $asset->id)->exists()
            || Token::where('scene_id', $campaign->active_scene_id)->where('is_hidden', false)->where('token_image_asset_id', $asset->id)->exists();
    }
}
