<?php

namespace App\Policies;

use App\Models\Scene;
use App\Models\User;

class ScenePolicy
{
    public function view(User $user, Scene $scene): bool
    {
        $role = $scene->campaign->roleFor($user);

        return $role === 'gm' || ($role === 'player' && $scene->campaign->active_scene_id === $scene->id);
    }

    public function update(User $user, Scene $scene): bool
    {
        return $scene->campaign->roleFor($user) === 'gm';
    }
}
