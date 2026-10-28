<?php

namespace App\Realtime;

use App\Models\Campaign;
use App\Models\Scene;
use App\Models\User;

class ChannelAccess
{
    public static function gm(int|string $campaign, int|string $scene): string
    {
        return "campaign.$campaign.scene.$scene.gm";
    }

    public static function player(int|string $campaign, int|string $scene, int|string $epoch, int|string $user): string
    {
        return "campaign.$campaign.scene.$scene.epoch.$epoch.user.$user";
    }

    public function presence(User $user, string $id): array|false
    {
        $role = Campaign::find($id)?->roleFor($user);

        return $role ? ['id' => (string) $user->id, 'name' => $user->name, 'role' => $role] : false;
    }

    public function scene(User $user, string $campaignId, string $sceneId, ?string $epoch = null, ?string $userId = null): bool
    {
        $campaign = Campaign::find($campaignId);
        if (! $campaign || ! Scene::whereKey($sceneId)->where('campaign_id', $campaignId)->exists()) {
            return false;
        }
        $role = $campaign->roleFor($user);
        if ($epoch === null) {
            return $role === 'gm';
        }

        return $role === 'player' && (string) $user->id === $userId
            && (string) $campaign->active_scene_id === $sceneId && (string) $campaign->live_revision === $epoch;
    }
}
