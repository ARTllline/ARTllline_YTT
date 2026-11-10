<?php

namespace App\Actions;

use App\Models\Asset;
use App\Models\LootContainer;
use App\Models\ObjectPreset;
use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\User;
use App\Services\PropCollider;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class PropActions
{
    public function execute(User $user, Scene $scene, array $data): array
    {
        return app(SceneTransaction::class)->run($scene, function ($scene) use ($user, $data) {
            Gate::forUser($user)->authorize('update', $scene);
            $previous = ['tokens' => [], 'props' => []];
            if ($data['action'] === 'create') {
                $preset = isset($data['presetId']) ? ObjectPreset::available($user)->findOrFail($data['presetId']) : null;
                $asset = Asset::where(fn ($q) => $q->available($scene->campaign_id, $user)
                    ->orWhere(fn ($q) => $q->whereNotNull('builtin_key')->where('category', 'props')))
                    ->where('kind', 'prop')->lockForUpdate()
                    ->findOrFail($preset?->asset_id ?? $data['assetId']);
                $settings = $preset?->settings;
                $size = $scene->grid_visible ? $scene->grid_size * 2 : 120;
                $factor = $data['scaleFactor'] ?? 1;
                $scaleX = $settings ? round($settings['scaleX'] * $factor, 4) : $size / max($asset->width, $asset->height);
                $scaleY = $settings ? round($settings['scaleY'] * $factor, 4) : $scaleX;
                if ($settings && (min($scaleX, $scaleY) < .001 || max($scaleX, $scaleY) > 100)) {
                    throw ValidationException::withMessages(['scaleFactor' => 'Масштаб выходит за пределы настроек пресета.']);
                }
                $prop = SceneProp::create(['scene_id' => $scene->id, 'asset_id' => $asset->id, 'name' => $preset?->name ?? mb_substr($asset->name, 0, 160),
                    'x' => $data['x'], 'y' => $data['y'], 'rotation' => $data['rotation'] ?? $settings['rotation'] ?? 0,
                    'scale_x' => $scaleX, 'scale_y' => $scaleY,
                    'preset_snapshot' => $settings ? $settings + ['presetId' => (string) $preset->id, 'category' => $preset->category] : null,
                    'z_index' => (SceneProp::where('scene_id', $scene->id)->max('z_index') ?? -1) + 1]);
                if (($data['purpose'] ?? null) === 'container') {
                    LootContainer::create(['scene_id' => $scene->id, 'prop_id' => $prop->id, 'name' => mb_substr($prop->name, 0, 80), 'kind' => 'container', 'created_by' => $user->id]);
                } elseif (($data['purpose'] ?? null) === 'interaction') {
                    $prop->update(['interactions' => [['id' => (string) Str::uuid(), 'author_id' => $user->id, 'label' => 'Осмотреть', 'icon' => 'eye', 'enabled' => true, 'result_type' => 'nothing']]]);
                }
            } else {
                $prop = SceneProp::where('scene_id', $scene->id)->findOrFail($data['id']);
                if (! $prop->is_hidden) {
                    $previous['props'][] = (string) $prop->id;
                }
                $patch = $data['patch'] ?? [];
                $patch = PropCollider::instancePatch($prop, $patch);
                if (isset($data['order'])) {
                    // Normalize the stack so one-step ordering also works with gaps/ties.
                    $stack = SceneProp::where('scene_id', $scene->id)->with('asset')->orderBy('z_index')->orderBy('id')->get()->all();
                    $index = array_search($prop->id, array_column($stack, 'id'));
                    $target = match ($data['order']) {
                        'front' => count($stack) - 1,
                        'back' => 0,
                        'forward' => min(count($stack) - 1, $index + 1),
                        'backward' => max(0, $index - 1),
                    };
                    array_splice($stack, $index, 1);
                    array_splice($stack, $target, 0, [$prop]);
                    $changed = [];
                    foreach ($stack as $z => $item) {
                        if ($item->id === $prop->id || $item->z_index !== $z) {
                            if (! $item->is_hidden) {
                                $previous['props'][] = (string) $item->id;
                            }
                            $item->update(['z_index' => $z] + ($item->id === $prop->id ? $patch : []));
                            $changed[] = $item->loadMissing('asset')->projection(true);
                        }
                    }

                    return ['props' => $changed, '_previousVisibility' => $previous];
                }
                $prop->update($patch);
            }

            $prop = $prop->fresh('asset');

            return ['props' => [$prop->projection(true)], '_previousVisibility' => $previous,
                'propEdits' => $data['action'] === 'create' ? array_values(array_filter([app(PropEditHistory::class)->capture($prop, true)])) : []];
        }, 'objects.changed');
    }
}
