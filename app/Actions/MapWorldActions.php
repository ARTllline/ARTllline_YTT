<?php

namespace App\Actions;

use App\Models\Asset;
use App\Models\Scene;
use App\Models\User;
use App\Services\SceneBounds;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

class MapWorldActions
{
    /** A small settings snapshot for compare-and-set/Undo, independent of token revisions. */
    public function state(Scene $scene): array
    {
        $snapshot = app(SceneSnapshotBuilder::class);
        $map = $snapshot->map($scene);
        if ($map) {
            $map = ['assetId' => $map['asset']['id'], 'x' => $map['x'], 'y' => $map['y'],
                'width' => $map['width'], 'height' => $map['height'], 'crop' => $map['crop'] ?? null];
        }

        return ['enabled' => $scene->mapWorld !== null, 'width' => $scene->width, 'height' => $scene->height,
            'map' => $map, 'grid' => $snapshot->grid($scene)];
    }

    public function execute(User $user, Scene $scene, array $value, array $expected, bool $history = false): array
    {
        return app(SceneTransaction::class)->run($scene, function ($scene) use ($user, $value, $expected, $history) {
            Gate::forUser($user)->authorize('update', $scene);
            abort_if($scene->mapWorld && $scene->mapWorld->schema_version !== 1, 409, 'Формат карты изменился. Обновите приложение.');
            abort_unless($this->state($scene) == $expected, 409, 'Настройки карты изменились в другом окне. Закройте редактор и откройте его заново.');
            $data = Validator::make($value, [
                'enabled' => 'required|boolean', 'width' => 'required|integer|between:120,20000', 'height' => 'required|integer|between:120,20000',
                'grid' => 'required|array:type,size,offset,visible,snap,distancePerCell,distanceUnit', 'grid.type' => 'sometimes|in:square',
                'grid.size' => 'required|numeric|between:20,160', 'grid.offset' => 'required|array:x,y',
                'grid.offset.x' => 'required|numeric|between:-1000000,1000000', 'grid.offset.y' => 'required|numeric|between:-1000000,1000000',
                'grid.visible' => 'required|boolean', 'grid.snap' => 'required|boolean',
                'grid.distancePerCell' => 'required|numeric|between:0.1,1000', 'grid.distanceUnit' => 'required|in:ft,m,squares',
                'map' => 'present|nullable|array:assetId,x,y,width,height,crop', 'map.assetId' => 'required_with:map|integer|min:1',
                'map.x' => 'required_with:map|numeric|between:-1000000,1000000', 'map.y' => 'required_with:map|numeric|between:-1000000,1000000',
                'map.width' => 'required_with:map|numeric|between:1,20000', 'map.height' => 'required_with:map|numeric|between:1,20000',
                'map.crop' => 'nullable|array:x,y,width,height', 'map.crop.x' => 'required_with:map.crop|numeric|between:0,1',
                'map.crop.y' => 'required_with:map.crop|numeric|between:0,1', 'map.crop.width' => 'required_with:map.crop|numeric|between:0.001,1',
                'map.crop.height' => 'required_with:map.crop|numeric|between:0.001,1',
            ])->validate();
            abort_unless($data['enabled'] || $history, 422);
            $crop = $data['map']['crop'] ?? null;
            if ($crop && ($crop['x'] + $crop['width'] > 1.000001 || $crop['y'] + $crop['height'] > 1.000001)) {
                throw ValidationException::withMessages(['map.crop' => 'Область кадра должна находиться внутри изображения.']);
            }
            SceneBounds::validateResize($scene, $data['width'], $data['height']);
            if ($data['enabled']) {
                $scene->mapWorld()->updateOrCreate([], ['reference_crop' => $crop]);
            } else {
                abort_if(app(\App\Services\TerrainData::class)->chunks($scene)->exists(), 409, 'Сначала удалите покрытие карты.');
                abort_if(\App\Services\StructureData::graph($scene)['edges'], 409, 'Сначала удалите стены карты.');
                $scene->mapWorld()->delete();
            }
            $scene->unsetRelation('mapWorld');
            // Write existing Scene fields together: one revision/event for the entire settings edit.
            $map = $data['map'];
            if ($map && ! Asset::whereKey($map['assetId'])->available($scene->campaign_id)->where('kind', 'map')->exists()) {
                throw ValidationException::withMessages(['map' => 'Выберите доступное изображение карты из Assets.']);
            }
            $grid = $data['grid'];
            $scene->update(['width' => $data['width'], 'height' => $data['height'],
                'map_asset_id' => $map['assetId'] ?? null, 'map_x' => $map['x'] ?? 0, 'map_y' => $map['y'] ?? 0,
                'map_width' => $map['width'] ?? 1440, 'map_height' => $map['height'] ?? 1080,
                'grid_size' => $grid['size'], 'grid_offset_x' => $grid['offset']['x'], 'grid_offset_y' => $grid['offset']['y'],
                'grid_visible' => $grid['visible'], 'grid_snap' => $grid['snap'], 'distance_per_cell' => $grid['distancePerCell'], 'distance_unit' => $grid['distanceUnit']]);
            $scene->refresh();
            $snapshot = app(SceneSnapshotBuilder::class);

            return ['scene' => ['width' => $scene->width, 'height' => $scene->height],
                'mapWorld' => $snapshot->mapWorld($scene, true), 'map' => $snapshot->map($scene), 'grid' => $snapshot->grid($scene)];
        }, 'map-world.updated');
    }
}
