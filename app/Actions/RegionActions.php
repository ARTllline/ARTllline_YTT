<?php

namespace App\Actions;

use App\Models\Scene;
use App\Models\SceneRegion;
use App\Models\User;
use App\Services\RegionGeometry;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;

class RegionActions
{
    public function execute(User $user, Scene $scene, array $input): array
    {
        return app(SceneTransaction::class)->run($scene, function ($scene) use ($user, $input) {
            Gate::forUser($user)->authorize('update', $scene);
            $action = Validator::make($input, ['action' => 'required|in:create,update,delete', 'id' => 'required_unless:action,create|integer|min:1'])->validate();
            $region = $action['action'] === 'create' ? null : SceneRegion::where('scene_id', $scene->id)->findOrFail($action['id']);
            if ($action['action'] === 'delete') {
                $region->delete();

                return ['deletedRegionId' => (string) $region->id];
            }
            $data = RegionGeometry::validate($input);
            if ($region) {
                $region->update($data);
            } else {
                abort_if(SceneRegion::where('scene_id', $scene->id)->count() >= 100, 422, 'В сцене можно создать до 100 областей.');
                $region = SceneRegion::create($data + ['scene_id' => $scene->id]);
            }

            return ['region' => $region->fresh()->projection()];
        }, 'region.changed');
    }
}
