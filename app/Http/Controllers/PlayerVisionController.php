<?php

namespace App\Http\Controllers;

use App\Actions\SceneTransaction;
use App\Models\Scene;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class PlayerVisionController extends Controller
{
    public function __invoke(Request $request, Scene $scene, SceneTransaction $transaction): array
    {
        Gate::authorize('update', $scene);
        $data = $request->validate(['enabled' => 'required|boolean', 'observerId' => 'sometimes|integer|min:1',
            'range' => 'required_with:observerId|numeric|between:0,40000', 'memoryPolicy' => 'sometimes|in:player,party',
            'resetMemory' => 'sometimes|boolean']);

        return $transaction->run($scene, function ($scene) use ($data, $request) {
            Gate::authorize('update', $scene);
            if (isset($data['observerId'])) {
                $scene->tokens()->findOrFail($data['observerId'])->update(['vision_range' => $data['range']]);
            }
            $scene->update(['vision_enabled' => $data['enabled']]);
            if (isset($data['memoryPolicy'])) {
                $scene->update(['fog_memory_policy' => $data['memoryPolicy']]);
            }
            if ($data['resetMemory'] ?? false) {
                DB::table('fog_memories')->where('scene_id', $scene->id)->delete();
            }

            return ['scene' => ['vision' => ['enabled' => $data['enabled'], 'polygons' => [], 'memoryPolicy' => $scene->fog_memory_policy]],
                ...isset($data['observerId']) ? ['token' => app(SceneSnapshotBuilder::class)->token($scene->tokens()->findOrFail($data['observerId']), true, $request->user())] : []];
        }, 'vision.updated');
    }
}
