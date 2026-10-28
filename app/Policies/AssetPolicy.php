<?php

namespace App\Policies;

use App\Models\Asset;
use App\Models\Handout;
use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\Token;
use App\Models\User;
use App\Services\LiveMedia;

class AssetPolicy
{
    public function view(User $user, Asset $asset): bool
    {
        $campaign = $asset->campaign;
        $role = $campaign->roleFor($user);
        if ($role === 'gm') {
            return true;
        }
        if ($role !== 'player') {
            return false;
        }
        if ($asset->duration_ms !== null) {
            return app(LiveMedia::class)->authorized($campaign, $asset);
        }

        if (Handout::where('campaign_id', $campaign->id)->where('asset_id', $asset->id)->whereHas('reveals', fn ($q) => $q->where('user_id', $user->id))->exists()) {
            return true;
        }
        if (! $campaign->active_scene_id) {
            return false;
        }

        return Scene::whereKey($campaign->active_scene_id)->where('campaign_id', $campaign->id)->where('map_asset_id', $asset->id)->exists()
            || SceneProp::where('scene_id', $campaign->active_scene_id)->where('is_hidden', false)->where('asset_id', $asset->id)->exists()
            || Token::where('scene_id', $campaign->active_scene_id)->where('is_hidden', false)->where('token_image_asset_id', $asset->id)->exists();
    }
}
