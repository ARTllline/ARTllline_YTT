<?php

namespace App\Http\Controllers;

use App\Actions\SceneActions;
use App\Actions\ScenePreparation;
use App\Models\Campaign;
use App\Models\Scene;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class SceneController extends Controller
{
    public function index(Campaign $campaign): array
    {
        Gate::authorize('update', $campaign);

        return ['scenes' => $campaign->scenes()->with('mapAsset')->withCount(['tokens', 'props'])->orderBy('sort_order')->orderBy('id')->get()->map(fn ($scene) => [
            'id' => (string) $scene->id, 'name' => $scene->name, 'width' => $scene->width, 'height' => $scene->height,
            'tokenCount' => $scene->tokens_count, 'propCount' => $scene->props_count,
            'thumbnailUrl' => $scene->map_asset_id ? '/api/assets/'.$scene->map_asset_id.'/thumbnail' : null,
        ])->all()];
    }

    public function duplicate(Request $request, Scene $scene, ScenePreparation $preparation): array
    {
        $data = $request->validate(['name' => 'required|string|max:120']);
        $copy = $preparation->duplicate($request->user(), $scene, $data['name']);

        return ['id' => (string) $copy->id, 'name' => $copy->name];
    }

    public function character(Request $request, Scene $scene, ScenePreparation $preparation): array
    {
        $data = $request->validate(['characterId' => 'required|integer|min:1', 'x' => 'required|numeric|between:-1000000,1000000', 'y' => 'required|numeric|between:-1000000,1000000']);

        return $preparation->place($request->user(), $scene, $data['characterId'], $data['x'], $data['y']);
    }

    public function prepare(Request $request, Campaign $campaign, SceneActions $actions): array
    {
        Gate::authorize('update', $campaign);
        $data = $request->validate([
            'sceneId' => 'nullable|integer|min:1', 'name' => 'required|string|max:120',
            'width' => 'required|integer|between:120,20000', 'height' => 'required|integer|between:120,20000',
            'grid' => 'required|array', 'grid.size' => 'required|numeric|between:20,160',
            'grid.offset.x' => 'required|numeric|between:-1000000,1000000', 'grid.offset.y' => 'required|numeric|between:-1000000,1000000',
            'grid.visible' => 'required|boolean', 'grid.snap' => 'required|boolean',
            'grid.distancePerCell' => 'required|numeric|between:0.1,1000', 'grid.distanceUnit' => 'required|in:ft,m,squares',
            'map' => 'sometimes|nullable|array', 'map.assetId' => 'required_with:map|integer|min:1',
            'map.x' => 'required_with:map|numeric|between:-1000000,1000000', 'map.y' => 'required_with:map|numeric|between:-1000000,1000000',
            'map.width' => 'required_with:map|numeric|between:1,20000', 'map.height' => 'required_with:map|numeric|between:1,20000',
        ]);

        return DB::transaction(function () use ($request, $campaign, $actions, $data) {
            $scene = ! empty($data['sceneId']) ? $campaign->scenes()->findOrFail($data['sceneId']) : $actions->create($request->user(), $campaign, $data['name']);
            $actions->update($request->user(), $scene, array_intersect_key($data, array_flip(['name', 'width', 'height'])));
            $actions->grid($request->user(), $scene, $data['grid']);
            if (array_key_exists('map', $data)) {
                $actions->map($request->user(), $scene, $data['map'] ?? ['assetId' => null, 'x' => 0, 'y' => 0, 'width' => 1440, 'height' => 1080]);
            }

            return ['id' => (string) $scene->id];
        }, 3);
    }

    public function snapshot(Request $request, Scene $scene, SceneSnapshotBuilder $builder): array
    {
        return $builder->build($scene, $request->user());
    }

    public function store(Request $request, Campaign $campaign, SceneActions $actions): array
    {
        Gate::authorize('update', $campaign);
        $data = $request->validate(['name' => 'required|string|max:120', 'mapAssetId' => 'sometimes|nullable|integer|min:1']);
        $scene = $actions->create($request->user(), $campaign, $data['name'], $data['mapAssetId'] ?? null);

        return ['id' => (string) $scene->id, 'name' => $scene->name, 'revision' => 0];
    }

    public function update(Request $request, Scene $scene, SceneActions $actions): array
    {
        Gate::authorize('update', $scene);

        return $actions->update($request->user(), $scene, $request->validate(['name' => 'sometimes|required|string|max:120', 'width' => 'sometimes|integer|between:120,20000', 'height' => 'sometimes|integer|between:120,20000']));
    }

    public function grid(Request $request, Scene $scene, SceneActions $actions): array
    {
        Gate::authorize('update', $scene);

        return $actions->grid($request->user(), $scene, $request->validate(['distancePerCell' => 'sometimes|numeric|between:0.1,1000', 'distanceUnit' => 'sometimes|in:ft,m,squares', 'size' => 'required|numeric|between:20,160', 'offset' => 'required|array:x,y', 'offset.x' => 'required|numeric|between:-1000000,1000000', 'offset.y' => 'required|numeric|between:-1000000,1000000', 'visible' => 'required|boolean', 'snap' => 'required|boolean']));
    }

    public function map(Request $request, Scene $scene, SceneActions $actions): array
    {
        Gate::authorize('update', $scene);

        return $actions->map($request->user(), $scene, $request->validate(['assetId' => 'present|nullable|integer|min:1', 'x' => 'required|numeric|between:-1000000,1000000', 'y' => 'required|numeric|between:-1000000,1000000', 'width' => 'required|numeric|between:1,20000', 'height' => 'required|numeric|between:1,20000']));
    }

    public function destroy(Request $request, Scene $scene, SceneActions $actions): array
    {
        $actions->delete($request->user(), $scene);

        return ['deleted' => true];
    }
}
