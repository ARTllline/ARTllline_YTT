<?php

namespace App\Http\Controllers;

use App\Items\LootActions;
use App\Models\Campaign;
use App\Models\LootContainer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class LootController extends Controller
{
    public function catalog(Request $r, Campaign $campaign): array
    {
        Gate::authorize('update', $campaign);

        return ['containers' => LootContainer::whereHas('scene', fn ($q) => $q->where('campaign_id', $campaign->id))->orderBy('name')->get(['id', 'name', 'scene_id'])];
    }

    public function show(Request $r, Campaign $campaign, LootActions $a): array
    {
        $data = $r->validate(['containerId' => 'required|integer|min:1']);
        $loot = $a->authorize($r->user(), $campaign, $data);

        return ['loot' => $a->snapshot($loot, $campaign->roleFor($r->user()) === 'gm')];
    }

    public function command(Request $r, Campaign $campaign, LootActions $a): array
    {
        return $a->command($r->user(), $campaign, $r->validate(['clientMutationId' => 'required|uuid', 'action' => 'required|in:configure,open,close,give,remove,take,take-all', 'containerId' => 'required_unless:action,configure|integer|min:1', 'sceneId' => 'required_if:action,configure|integer|min:1', 'kind' => 'required_if:action,configure|in:token,prop', 'objectId' => 'required_if:action,configure|integer|min:1', 'name' => 'sometimes|string|max:80', 'definitionId' => 'required_if:action,give|uuid', 'itemId' => 'required_if:action,take,remove|uuid', 'characterId' => 'required_if:action,take,take-all|integer|min:1', 'quantity' => 'required_if:action,give|integer|between:1,999']));
    }
}
