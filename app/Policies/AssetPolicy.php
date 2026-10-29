<?php

namespace App\Policies;

use App\Models\Asset;
use App\Models\Character;
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
        if (Character::where('campaign_id', $campaign->id)->where('owner_user_id', $user->id)->where('portrait_asset_id', $asset->id)->exists()) {
            return true;
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
            || Token::where('scene_id', $campaign->active_scene_id)->where('is_hidden', false)->where(function ($q) use ($asset) {
                $q->where(fn ($q) => $q->whereNull('character_id')->where('token_image_asset_id', $asset->id))
                    ->orWhereHas('character', fn ($q) => $q->where('portrait_asset_id', $asset->id));
            })->exists();
    }
}
