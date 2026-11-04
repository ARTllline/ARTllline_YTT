<?php

namespace App\Http\Controllers;

use App\Models\Asset;
use App\Models\MapMaterial;
use App\Models\MapMaterialVersion;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class MapMaterialController extends Controller
{
    public function index(Request $request): array
    {
        $data = $request->validate(['type' => 'nullable|in:terrain,floor,wall', 'search' => 'nullable|string|max:120', 'page' => 'nullable|integer|min:1']);
        $query = MapMaterialVersion::with('asset')->whereHas('material', fn ($q) => $q->where('user_id', $request->user()->id))
            ->whereColumn('version', DB::raw('(select version from map_materials where map_materials.id = map_material_versions.map_material_id)'));
        if ($data['type'] ?? null) {
            $query->where('type', $data['type']);
        }
        if ($data['search'] ?? null) {
            $query->where('name', 'like', '%'.addcslashes($data['search'], '%_\\').'%');
        }
        $page = $query->latest('id')->paginate(40);

        return ['materials' => $page->getCollection()->map->projection()->all(), 'pages' => $page->lastPage()];
    }

    public function store(Request $request): array
    {
        return $this->save($request);
    }

    public function update(Request $request, MapMaterial $material): array
    {
        abort_unless($material->user_id === $request->user()->id, 403);

        return $this->save($request, $material);
    }

    private function save(Request $request, ?MapMaterial $material = null): array
    {
        $data = $request->validate(['name' => 'required|string|max:120', 'type' => 'required|in:terrain,floor,wall',
            'assetId' => 'required|integer', 'repeatSize' => 'required|numeric|between:1,20000', 'rotation' => 'required|numeric|between:0,360',
            'variation' => 'required|array:offset,quarterTurns', 'variation.offset' => 'required|boolean', 'variation.quarterTurns' => 'required|boolean',
            'version' => ($material ? 'required' : 'sometimes').'|integer|min:1']);
        abort_if(trim($data['name']) === '', 422, 'Укажите название материала.');

        return DB::transaction(function () use ($request, $material, $data) {
            // Match personal library ownership. Copy campaign assets into personal Assets first.
            $asset = Asset::where('library_user_id', $request->user()->id)->whereNull('duration_ms')->lockForUpdate()->findOrFail($data['assetId']);
            if ($material) {
                $material = MapMaterial::whereKey($material->id)->lockForUpdate()->firstOrFail();
                abort_unless($material->version === (int) $data['version'], 409, 'Материал изменён. Обновите библиотеку перед сохранением.');
                $material->increment('version');
            } else {
                $material = MapMaterial::create(['user_id' => $request->user()->id, 'version' => 1]);
            }
            $version = $material->versions()->create(['version' => $material->version, 'asset_id' => $asset->id,
                'name' => trim($data['name']), 'type' => $data['type'], 'repeat_size' => $data['repeatSize'],
                'rotation' => $data['rotation'], 'variation' => $data['variation'], 'created_at' => now()]);

            return $version->load('asset')->projection();
        }, 3);
    }

    public function duplicate(Request $request, MapMaterial $material): array
    {
        abort_unless($material->user_id === $request->user()->id, 403);

        return DB::transaction(function () use ($request, $material) {
            $material = MapMaterial::whereKey($material->id)->lockForUpdate()->firstOrFail();
            $source = $material->versions()->where('version', $material->version)->firstOrFail();
            $copy = MapMaterial::create(['user_id' => $request->user()->id, 'version' => 1]);
            $version = $source->replicate();
            $version->fill(['map_material_id' => $copy->id, 'version' => 1, 'name' => mb_substr($source->name, 0, 110).' · копия', 'created_at' => now()])->save();

            return $version->load('asset')->projection();
        }, 3);
    }

    public function destroy(Request $request, MapMaterial $material): array
    {
        abort_unless($material->user_id === $request->user()->id, 403);
        try {
            DB::transaction(function () use ($material) {
                MapMaterial::whereKey($material->id)->lockForUpdate()->firstOrFail()->delete();
            });
        } catch (QueryException $e) {
            // Future coverage/structure FKs must RESTRICT deletion of the immutable version.
            if (in_array((string) $e->getCode(), ['23000', '23503'])) {
                abort(409, 'Материал используется на карте. Сначала удалите его размещения.');
            }
            throw $e;
        }

        return ['deleted' => true];
    }
}
