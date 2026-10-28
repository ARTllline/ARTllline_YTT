<?php

namespace App\Policies;

use App\Models\Token;
use App\Models\User;

class TokenPolicy
{
    public function update(User $user, Token $token): bool
    {
        return $token->scene->campaign->roleFor($user) === 'gm';
    }

    public function move(User $user, Token $token): bool
    {
        $campaign = $token->scene->campaign;
        $role = $campaign->roleFor($user);

        return $role === 'gm' || ($role === 'player'
            && $campaign->active_scene_id === $token->scene_id
            && $token->owner_user_id === $user->id && ! $token->is_hidden && ! $token->is_locked);
    }
}
