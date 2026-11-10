<?php

namespace App\Policies;

use App\Models\Asset;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\Handout;
use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\Token;
use App\Models\User;
use App\Services\LiveMedia;
use App\Services\SceneVisibility;
use Illuminate\Support\Facades\DB;

class AssetPolicy
{
    public function view(User $user, Asset $asset): bool
    {
        if ($asset->builtin_key || $asset->library_user_id === $user->id) {
            return true;
        }
        foreach (Campaign::whereHas('members', fn ($q) => $q->where('users.id', $user->id))->get() as $campaign) {
            if ($this->inCampaign($user, $asset, $campaign)) {
                return true;
            }
        }

        return false;
    }

    private function inCampaign(User $user, Asset $asset, Campaign $campaign): bool
    {
        $role = $campaign->roleFor($user);
        if (in_array($role, ['gm', 'player'], true) && DB::table('terrain_masks')
            ->join('terrain_chunks', 'terrain_chunks.id', '=', 'terrain_masks.terrain_chunk_id')
            ->join('map_worlds', 'map_worlds.id', '=', 'terrain_chunks.map_world_id')
            ->join('scenes', 'scenes.id', '=', 'map_worlds.scene_id')
            ->join('map_material_versions', 'map_material_versions.id', '=', 'terrain_masks.map_material_version_id')
            ->where('scenes.campaign_id', $campaign->id)->where('map_material_versions.asset_id', $asset->id)
            ->when($role === 'player', fn ($q) => $q->where('scenes.id', $campaign->active_scene_id ?? 0))->exists()) {
            return true;
        }
        if (in_array($role, ['gm', 'player'], true) && DB::table('map_structure_materials')
            ->join('map_worlds', 'map_worlds.id', '=', 'map_structure_materials.map_world_id')
            ->join('scenes', 'scenes.id', '=', 'map_worlds.scene_id')
            ->join('map_material_versions', 'map_material_versions.id', '=', 'map_structure_materials.map_material_version_id')
            ->where('scenes.campaign_id', $campaign->id)->where('map_material_versions.asset_id', $asset->id)
            ->when($role === 'player', fn ($q) => $q->where('scenes.id', $campaign->active_scene_id ?? 0))->exists()) {
            return true;
        }
        if ($role === 'gm') {
            return $asset->campaign_id === $campaign->id || $this->characterUse($asset, $campaign, $user, true)
                || Scene::where('campaign_id', $campaign->id)->where('map_asset_id', $asset->id)->exists()
                || SceneProp::whereHas('scene', fn ($q) => $q->where('campaign_id', $campaign->id))->where('asset_id', $asset->id)->exists()
                || Token::whereHas('scene', fn ($q) => $q->where('campaign_id', $campaign->id))->where('token_image_asset_id', $asset->id)->exists()
                || Handout::where('campaign_id', $campaign->id)->where('asset_id', $asset->id)->exists()
                || ($asset->duration_ms !== null && app(LiveMedia::class)->authorized($campaign, $asset));
        }
        if ($role !== 'player') {
            return false;
        }
        if ($this->characterUse($asset, $campaign, $user, false)) {
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
            || SceneProp::where('scene_id', $campaign->active_scene_id)->where('is_hidden', false)->where('asset_id', $asset->id)->get()->contains(fn ($p) => app(SceneVisibility::class)->allows($p, $user))
            || Token::where('scene_id', $campaign->active_scene_id)->where('is_hidden', false)->where(function ($q) use ($asset) {
                $q->where(fn ($q) => $q->whereNull('character_id')->where('token_image_asset_id', $asset->id))
                    ->orWhereHas('character', fn ($q) => $q->where('portrait_asset_id', $asset->id));
            })->get()->contains(fn ($t) => app(SceneVisibility::class)->allows($t, $user));
    }

    private function characterUse(Asset $asset, Campaign $campaign, User $user, bool $gm): bool
    {
        $icon = 'asset:'.$asset->id;

        return Character::where('campaign_id', $campaign->id)
            ->when(! $gm, fn ($q) => $q->where('owner_user_id', $user->id))
            ->where(fn ($q) => $q->where('portrait_asset_id', $asset->id)
                ->orWhere('abilities', 'like', '%"'.$icon.'"%')
                ->orWhereHas('inventory', fn ($q) => $q->where('quantity', '>', 0)->whereHas('definition', fn ($q) => $q->where('icon', $icon)->orWhere('gameplay', 'like', '%"'.$icon.'"%'))))
            ->exists();
    }
}
