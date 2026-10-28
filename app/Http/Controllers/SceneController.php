<?php

namespace App\Http\Controllers;

use App\Actions\SceneActions;
use App\Models\Campaign;
use App\Models\Scene;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class SceneController extends Controller
{
    public function snapshot(Request $request, Scene $scene, SceneSnapshotBuilder $builder): array
    {
        return $builder->build($scene, $request->user());
    }

    public function store(Request $request, Campaign $campaign, SceneActions $actions): array
    {
        Gate::authorize('update', $campaign);
        $scene = $actions->create($request->user(), $campaign, $request->validate(['name' => 'required|string|max:120'])['name']);

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

        return $actions->grid($request->user(), $scene, $request->validate(['size' => 'required|numeric|between:20,160', 'offset' => 'required|array:x,y', 'offset.x' => 'required|numeric|between:-1000000,1000000', 'offset.y' => 'required|numeric|between:-1000000,1000000', 'visible' => 'required|boolean', 'snap' => 'required|boolean']));
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
