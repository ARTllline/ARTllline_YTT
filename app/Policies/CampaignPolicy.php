<?php

namespace App\Policies;

use App\Models\Campaign;
use App\Models\User;

class CampaignPolicy
{
    public function view(User $user, Campaign $campaign): bool
    {
        return $campaign->roleFor($user) !== null;
    }

    public function update(User $user, Campaign $campaign): bool
    {
        return $campaign->roleFor($user) === 'gm';
    }
}
