<?php

namespace App\Http\Controllers;

use App\Actions\CharacterActions;
use App\Models\Campaign;
use App\Services\TokenCheckStats;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class CharacterController extends Controller
{
    public function index(Request $request, Campaign $campaign, CharacterActions $actions): array
    {
        Gate::authorize('view', $campaign);

        return $actions->roster($campaign, $request->user());
    }

    public function save(Request $request, Campaign $campaign, CharacterActions $actions): array
    {
        Gate::authorize('update', $campaign);
        $data = $request->validate([
            'id' => 'sometimes|integer|min:1', 'name' => 'required|string|max:80',
            'portrait_asset_id' => 'sometimes|nullable|integer|min:1',
            'owner_user_id' => 'sometimes|nullable|integer|min:1',
            'kind' => 'sometimes|in:player_character,npc', 'disposition' => 'sometimes|in:friendly,neutral,hostile',
            'hp' => 'sometimes|integer|between:0,9999', 'max_hp' => 'sometimes|integer|between:1,9999',
        ] + TokenCheckStats::rules());

        return $actions->save($request->user(), $campaign, $data);
    }

    public function select(Request $request, Campaign $campaign, CharacterActions $actions): array
    {
        $data = $request->validate(['character_id' => 'present|nullable|integer|min:1']);

        return $actions->select($request->user(), $campaign, $data['character_id']);
    }
}
