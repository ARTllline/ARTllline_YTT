<?php

namespace App\Http\Controllers;

use App\Actions\InviteActions;
use App\Models\Campaign;
use App\Models\CampaignInvite;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class InviteController extends Controller
{
    public function index(Campaign $campaign, InviteActions $actions): array
    {
        Gate::authorize('update', $campaign);

        return ['invites' => CampaignInvite::where('campaign_id', $campaign->id)->latest()->limit(30)->get()->map(fn ($invite) => $actions->describe($invite))->all()];
    }

    public function store(Request $request, Campaign $campaign, InviteActions $actions): array
    {
        return $actions->create($request->user(), $campaign, $request->validate(['expiresInDays' => 'sometimes|integer|between:1,30', 'maxUses' => 'sometimes|nullable|integer|between:1,100']));
    }

    public function show(string $inviteToken, InviteActions $actions): array
    {
        $invite = $actions->inspect($inviteToken);

        return ['name' => $invite->campaign->name, 'exhausted' => $invite->max_uses !== null && $invite->uses_count >= $invite->max_uses];
    }

    public function join(Request $request, string $inviteToken, InviteActions $actions): array
    {
        $campaign = $actions->join($request->user(), $inviteToken);

        return ['campaignId' => (string) $campaign->id, 'role' => $campaign->roleFor($request->user())];
    }

    public function revoke(Request $request, CampaignInvite $invite, InviteActions $actions): array
    {
        $actions->revoke($request->user(), $invite);

        return ['revoked' => true];
    }
}
