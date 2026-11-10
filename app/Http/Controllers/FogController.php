<?php

namespace App\Http\Controllers;

use App\Actions\FogActions;
use App\Models\Campaign;
use App\Models\Scene;
use App\Services\SceneVisibility;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class FogController extends Controller
{
    public function preview(Request $request, Scene $scene, SceneVisibility $visibility): array
    {
        Gate::authorize('update', $scene);
        $data = $request->validate(['player' => 'sometimes|integer|min:1']);

        return DB::transaction(function () use ($scene, $data, $visibility) {
            $campaign = Campaign::whereKey($scene->campaign_id)->sharedLock()->firstOrFail();
            $scene = Scene::whereKey($scene->id)->sharedLock()->firstOrFail();
            $scene->setRelation('campaign', $campaign);
            Gate::authorize('update', $scene);
            $players = $campaign->members()->wherePivot('role', 'player')->orderBy('users.id')->get();
            $player = isset($data['player']) ? $players->find($data['player']) : $players->first();

            return [
                'revision' => $scene->revision,
                'players' => $players->map(fn ($user) => ['id' => (string) $user->id, 'name' => $user->name])->all(),
                'player' => $player ? (string) $player->id : null,
                'vision' => $player ? $visibility->mask($scene, $player) : null,
            ];
        });
    }

    public function store(Request $request, Scene $scene, FogActions $actions): array
    {
        Gate::authorize('update', $scene);
        $data = $request->validate(FogActions::strokeRules());
        FogActions::checkShape($data);

        return $actions->append($request->user(), $scene, $data);
    }

    public function reset(Request $request, Scene $scene, FogActions $actions): array
    {
        Gate::authorize('update', $scene);

        return $actions->reset($request->user(), $scene, $request->validate(['base' => 'required|in:clear,covered'])['base']);
    }
}
