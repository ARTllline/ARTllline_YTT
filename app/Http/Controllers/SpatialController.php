<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Models\Scene;
use App\Realtime\CommandContext;
use App\Realtime\ScenePublisher;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class SpatialController extends Controller
{
    public function __invoke(Request $request, Scene $scene, ScenePublisher $publisher): array
    {
        return DB::transaction(function () use ($request, $scene, $publisher) {
            $campaign = Campaign::whereKey($scene->campaign_id)->sharedLock()->firstOrFail();
            $scene = Scene::whereKey($scene->id)->sharedLock()->firstOrFail();
            $scene->setRelation('campaign', $campaign);
            Gate::authorize('view', $scene);
            abort_unless($campaign->active_scene_id === $scene->id, 403, 'Spatial sharing requires the active scene.');
            $data = $request->validate([
                'kind' => 'required|in:ruler,circle,cone,rectangle,ping', 'sessionId' => 'required|uuid',
                'sequence' => 'required|integer|between:1,1000000', 'phase' => 'required|in:update,end,cancel',
                'epoch' => 'required|integer|min:0', 'startedAt' => 'required|integer|min:0|max:9999999999999',
                'start' => 'required|array:x,y', 'end' => 'required|array:x,y',
                'start.x' => 'required|numeric|between:-20000,40000', 'start.y' => 'required|numeric|between:-20000,40000',
                'end.x' => 'required|numeric|between:-20000,40000', 'end.y' => 'required|numeric|between:-20000,40000',
            ]);
            abort_unless((int) $data['epoch'] === $campaign->live_revision, 409, 'The active scene changed.');
            $socket = $request->header('X-Socket-ID');
            app(CommandContext::class)->socketId = is_string($socket) && preg_match('/^\d+\.\d+$/', $socket) ? $socket : null;
            $publisher->spatial($scene, $data + ['participant' => ['id' => (string) $request->user()->id, 'name' => $request->user()->name]]);

            return ['accepted' => true];
        });
    }
}
