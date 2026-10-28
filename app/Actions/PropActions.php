<?php

namespace App\Actions;

use App\Models\Asset;
use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

class PropActions
{
    public function execute(User $user, Scene $scene, array $data): array
    {
        return app(SceneTransaction::class)->run($scene, function ($scene) use ($user, $data) {
            Gate::forUser($user)->authorize('update', $scene);
            $previous = ['tokens' => [], 'props' => []];
            if ($data['action'] === 'create') {
                $asset = Asset::where('campaign_id', $scene->campaign_id)->where('kind', 'prop')->findOrFail($data['assetId']);
                $size = $scene->grid_visible ? $scene->grid_size * 2 : 120;
                $prop = SceneProp::create(['scene_id' => $scene->id, 'asset_id' => $asset->id, 'name' => mb_substr($asset->name, 0, 160),
                    'x' => $data['x'], 'y' => $data['y'], 'scale_x' => $size / max($asset->width, $asset->height),
                    'scale_y' => $size / max($asset->width, $asset->height), 'z_index' => (SceneProp::where('scene_id', $scene->id)->max('z_index') ?? -1) + 1]);
            } else {
                $prop = SceneProp::where('scene_id', $scene->id)->findOrFail($data['id']);
                if (! $prop->is_hidden) {
                    $previous['props'][] = (string) $prop->id;
                }
                $patch = $data['patch'] ?? [];
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

            return ['props' => [$prop->fresh('asset')->projection(true)], '_previousVisibility' => $previous];
        }, 'objects.changed');
    }
}
