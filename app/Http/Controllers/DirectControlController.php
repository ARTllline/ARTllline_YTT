<?php

namespace App\Http\Controllers;

use App\Actions\TokenActions;
use App\Models\Scene;
use App\Models\Token;
use App\Services\DirectControl;
use Illuminate\Http\Request;

class DirectControlController extends Controller
{
    public function start(Request $request, Token $token, DirectControl $control): array
    {
        $data = $request->validate(['streamId' => 'required|uuid']);
        // IdempotentMutation already owns the campaign lock and transaction.
        $scene = Scene::whereKey($token->scene_id)->lockForUpdate()->firstOrFail();
        $token = $scene->tokens()->whereKey($token->id)->firstOrFail();
        $token->setRelation('scene', $scene);

        return $control->start($request->user(), $token, $data['streamId']);
    }

    public function step(Request $request, Token $token, TokenActions $actions): array
    {
        $data = $request->validate([
            'streamId' => 'required|uuid', 'sequence' => 'required|integer|min:1|max:1000000',
            'origin' => 'required|array:x,y', 'origin.x' => 'required|numeric', 'origin.y' => 'required|numeric',
            'waypoints' => 'sometimes|array|list|max:16', 'waypoints.*' => 'required|array:x,y',
            'waypoints.*.x' => 'required|numeric|between:-1000000,1000000', 'waypoints.*.y' => 'required|numeric|between:-1000000,1000000',
            'x' => 'required|numeric|between:-1000000,1000000', 'y' => 'required|numeric|between:-1000000,1000000',
        ]);

        return $actions->update($request->user(), $token, ['x' => $data['x'], 'y' => $data['y'], 'waypoints' => $data['waypoints'] ?? [], '_directControl' => $data], true);
    }
}
