<?php

namespace App\Actions;

use App\Models\Campaign;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class CampaignActions
{
    public function create(User $user, string $name): Campaign
    {
        return DB::transaction(function () use ($user, $name) {
            $campaign = Campaign::create(['name' => $name]);
            $campaign->members()->attach($user->id, ['role' => 'gm']);

            return $campaign;
        });
    }

    public function rename(User $user, Campaign $campaign, string $name): void
    {
        Gate::forUser($user)->authorize('update', $campaign);
        $campaign->update(['name' => $name]);
    }
}
