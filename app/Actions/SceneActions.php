<?php

namespace App\Actions;

use App\Models\Asset;
use App\Models\Campaign;
use App\Models\Scene;
use App\Models\User;
use App\Realtime\ScenePublisher;
use App\Services\LiveMedia;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class SceneActions
{
    public function __construct(private SceneTransaction $transaction, private SceneSnapshotBuilder $snapshots) {}

    public function create(User $user, Campaign $campaign, string $name): Scene
    {
        return DB::transaction(function () use ($user, $campaign, $name) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($user)->authorize('update', $campaign);

            $scene = $campaign->scenes()->create(['name' => $name, 'sort_order' => ($campaign->scenes()->max('sort_order') ?? -1) + 1]);
            app(ScenePublisher::class)->campaign($campaign);

            return $scene;
        });
    }

    public function update(User $user, Scene $scene, array $data): array
    {
        return $this->transaction->run($scene, function ($scene) use ($user, $data) {
            Gate::forUser($user)->authorize('update', $scene);
            $scene->update($data);
            app(ScenePublisher::class)->campaign($scene->campaign);

            return ['scene' => ['id' => (string) $scene->id, 'name' => $scene->name, 'width' => $scene->width, 'height' => $scene->height]];
        });
    }

    public function grid(User $user, Scene $scene, array $data): array
    {
        return $this->transaction->run($scene, function ($scene) use ($user, $data) {
            Gate::forUser($user)->authorize('update', $scene);
            $scene->update(['distance_per_cell' => $data['distancePerCell'] ?? $scene->distance_per_cell, 'distance_unit' => $data['distanceUnit'] ?? $scene->distance_unit, 'grid_size' => $data['size'], 'grid_offset_x' => $data['offset']['x'],
                'grid_offset_y' => $data['offset']['y'], 'grid_visible' => $data['visible'], 'grid_snap' => $data['snap']]);
            $scene->refresh();

            return ['grid' => $this->snapshots->grid($scene)];
        }, 'grid.updated');
    }

    public function map(User $user, Scene $scene, array $data): array
    {
        return $this->transaction->run($scene, function ($scene) use ($user, $data) {
            Gate::forUser($user)->authorize('update', $scene);
            if (! empty($data['assetId']) && ! Asset::whereKey($data['assetId'])->where('campaign_id', $scene->campaign_id)->where('kind', 'map')->exists()) {
                throw ValidationException::withMessages(['assetId' => 'Choose a map belonging to this campaign.']);
            }
            $scene->update(['map_asset_id' => $data['assetId'], 'map_x' => $data['x'], 'map_y' => $data['y'],
                'map_width' => $data['width'], 'map_height' => $data['height']]);
            $scene->refresh();

            return ['map' => $this->snapshots->map($scene)];
        }, 'map.updated');
    }

    public function activate(User $user, Campaign $campaign, ?int $sceneId): void
    {
        DB::transaction(function () use ($user, $campaign, $sceneId) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($user)->authorize('update', $campaign);
            if ($sceneId && ! $campaign->scenes()->whereKey($sceneId)->exists()) {
                throw ValidationException::withMessages(['sceneId' => 'Choose a scene belonging to this campaign.']);
            }
            app(CueRunner::class)->cancelCampaign($campaign);
            $campaign->active_scene_id = $sceneId;
            $campaign->live_revision++;
            $campaign->save();
            app(LiveMedia::class)->sceneChanged($campaign);
            app(ScenePublisher::class)->campaign($campaign, 'scene.activated');
        });
    }

    public function delete(User $user, Scene $scene): void
    {
        DB::transaction(function () use ($user, $scene) {
            $campaign = Campaign::whereKey($scene->campaign_id)->lockForUpdate()->firstOrFail();
            $scene = Scene::whereKey($scene->id)->lockForUpdate()->firstOrFail();
            $scene->setRelation('campaign', $campaign);
            Gate::forUser($user)->authorize('update', $scene);
            if ($campaign->active_scene_id === $scene->id) {
                throw ValidationException::withMessages(['scene' => 'Deactivate this scene or activate another scene before deleting it.']);
            }
            $scene->delete();
            app(ScenePublisher::class)->campaign($campaign);
        });
    }
}
