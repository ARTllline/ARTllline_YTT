<?php

namespace App\Http\Controllers;

use App\Models\Asset;
use App\Models\ObjectPreset;
use App\Services\PropCollider;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ObjectPresetController extends Controller
{
    public function index(Request $request): array
    {
        $data = $request->validate(['search' => 'nullable|string|max:120', 'page' => 'nullable|integer|min:1',
            'source' => 'nullable|in:builtin,personal', 'category' => 'nullable|string|max:80']);
        $query = ObjectPreset::available($request->user())->with('asset');
        if (($data['source'] ?? null) === 'builtin') {
            $query->whereNotNull('builtin_key');
        } elseif (($data['source'] ?? null) === 'personal') {
            $query->whereNull('builtin_key');
        }
        if (isset($data['category'])) {
            $query->where('category', $data['category']);
        }
        $search = trim($data['search'] ?? '');
        if ($search !== '') {
            // SQLite LIKE folds ASCII only. Cover lowercase queries and title-case names there too.
            $terms = array_unique([$search, mb_strtolower($search), mb_convert_case($search, MB_CASE_TITLE)]);
            $query->where(function ($q) use ($terms) {
                foreach ($terms as $term) {
                    $like = '%'.strtr($term, ['!' => '!!', '%' => '!%', '_' => '!_']).'%';
                    $q->orWhereRaw("name LIKE ? ESCAPE '!'", [$like])->orWhereRaw("category LIKE ? ESCAPE '!'", [$like])
                        ->orWhereHas('asset', fn ($assets) => $assets->whereRaw("name LIKE ? ESCAPE '!'", [$like])
                            ->orWhereRaw("original_name LIKE ? ESCAPE '!'", [$like]));
                }
            });
        }
        $page = $query->orderByRaw('builtin_key IS NULL')->orderBy('name')->orderBy('id')->paginate(24);

        return ['presets' => $page->getCollection()->map->projection(), 'pages' => $page->lastPage()];
    }

    public function store(Request $request): array
    {
        return $this->save($request, new ObjectPreset(['library_user_id' => $request->user()->id]));
    }

    public function update(Request $request, ObjectPreset $preset): array
    {
        $this->authorizeOwner($request, $preset);

        return $this->save($request, $preset);
    }

    public function duplicate(Request $request, ObjectPreset $preset): array
    {
        abort_unless($preset->builtin_key || $preset->library_user_id === $request->user()->id, 404);
        $copy = $preset->replicate(['builtin_key']);
        $copy->library_user_id = $request->user()->id;
        $copy->name = mb_substr($preset->name, 0, 152).' · копия';
        $copy->save();

        return $copy->projection();
    }

    public function destroy(Request $request, ObjectPreset $preset)
    {
        $this->authorizeOwner($request, $preset);
        $preset->delete();

        return response()->noContent();
    }

    private function authorizeOwner(Request $request, ObjectPreset $preset): void
    {
        abort_unless(! $preset->builtin_key && $preset->library_user_id === $request->user()->id, 404);
    }

    private function save(Request $request, ObjectPreset $preset): array
    {
        $data = $request->validate([
            'name' => 'required|string|max:160', 'category' => 'required|string|max:80', 'assetId' => 'required|integer',
            'settings' => 'required|array:width,height,pivotX,pivotY,scaleX,scaleY,rotation,collider,tags',
            'settings.width' => 'required|numeric|between:1,8192', 'settings.height' => 'required|numeric|between:1,8192',
            'settings.pivotX' => 'required|numeric|between:0,1', 'settings.pivotY' => 'required|numeric|between:0,1',
            'settings.scaleX' => 'required|numeric|between:0.001,100', 'settings.scaleY' => 'required|numeric|between:0.001,100',
            'settings.rotation' => 'required|numeric|between:-360,360', 'settings.collider' => 'required|array',
            'settings.tags' => 'sometimes|array|list|max:12', 'settings.tags.*' => 'required|string|max:32|distinct',
        ]);
        $settings = $data['settings'];
        $settings['tags'] ??= [];
        $settings['collider'] = PropCollider::validate($settings['collider']);
        foreach (['width', 'height', 'pivotX', 'pivotY', 'scaleX', 'scaleY', 'rotation'] as $field) {
            $settings[$field] = round((float) $settings[$field], 4);
        }

        return DB::transaction(function () use ($preset, $data, $settings) {
            $asset = Asset::where(fn ($q) => $q->where('library_user_id', $preset->library_user_id)
                ->orWhere(fn ($q) => $q->whereNotNull('builtin_key')->where('category', 'props')))
                ->where('kind', 'prop')->whereNull('duration_ms')->lockForUpdate()->findOrFail($data['assetId']);
            if ($preset->asset_id === $asset->id && isset($preset->settings['light'])) {
                $settings['light'] = $preset->settings['light'];
            }
            $preset->fill(['asset_id' => $asset->id, 'name' => $data['name'], 'category' => $data['category'],
                'settings' => $settings])->save();

            return $preset->setRelation('asset', $asset)->projection();
        });
    }
}
