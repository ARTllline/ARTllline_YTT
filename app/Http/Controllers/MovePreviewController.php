<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Models\Scene;
use App\Models\Token;
use App\Realtime\CommandContext;
use App\Realtime\ScenePublisher;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class MovePreviewController extends Controller
{
    public function __invoke(Request $request, Token $token, ScenePublisher $publisher): array
    {
        $data = $request->validate(['x' => 'required|numeric|between:-1000000,1000000', 'y' => 'required|numeric|between:-1000000,1000000',
            'dragSessionId' => 'required|uuid', 'sequence' => 'required|integer|between:1,1000000', 'baseRevision' => 'required|integer|min:0', 'cancelled' => 'sometimes|boolean']);
        $data['x'] = (float) $data['x'];
        $data['y'] = (float) $data['y'];
        $data['sequence'] = (int) $data['sequence'];
        $socket = $request->header('X-Socket-ID');
        app(CommandContext::class)->socketId = is_string($socket) && preg_match('/^\d+\.\d+$/', $socket) ? $socket : null;

        return DB::transaction(function () use ($request, $token, $publisher, $data) {
            $campaign = Campaign::whereKey($token->scene->campaign_id)->sharedLock()->firstOrFail();
            $scene = Scene::whereKey($token->scene_id)->sharedLock()->firstOrFail();
            $scene->setRelation('campaign', $campaign);
            $current = $scene->tokens()->findOrFail($token->id);
            $current->setRelation('scene', $scene);
            Gate::forUser($request->user())->authorize('move', $current);
            if ((int) $data['baseRevision'] !== $scene->revision) {
                return ['accepted' => false];
            }
            unset($data['baseRevision']);
            $publisher->preview($scene, $current, $data);

            return ['accepted' => true];
        });
    }
}
