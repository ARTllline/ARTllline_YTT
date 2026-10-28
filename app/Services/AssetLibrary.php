<?php

namespace App\Services;

use App\Models\Asset;
use App\Models\AssetCollection;
use App\Models\AssetTag;
use App\Models\Campaign;
use App\Models\Handout;
use App\Models\Scene;
use App\Models\Token;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;

class AssetLibrary
{
    public function projection(Asset $asset): array
    {
        return app(SceneSnapshotBuilder::class)->asset($asset) + [
            'name' => $asset->name, 'originalName' => $asset->original_name, 'kind' => $asset->kind,
            'thumbnailUrl' => '/api/assets/'.$asset->id.'/thumbnail', 'mimeType' => $asset->mime_type,
            'fileSize' => $asset->file_size, 'createdAt' => $asset->created_at->toIso8601String(),
            'tags' => $asset->tags->map(fn ($tag) => $this->label($tag))->all(),
            'collections' => $asset->collections->map(fn ($item) => $this->label($item))->all(),
        ];
    }

    public function label($item): array
    {
        return ['id' => (string) $item->id, 'name' => $item->name];
    }

    public function usage(Asset $asset): array
    {
        return array_merge(
            Scene::where('map_asset_id', $asset->id)->get(['id', 'name'])->map(fn ($s) => 'Map · '.$s->name)->all(),
            Token::where('token_image_asset_id', $asset->id)->with('scene:id,name')->get()->map(fn ($t) => 'Token · '.$t->name.' / '.$t->scene->name)->all(),
            Handout::where('asset_id', $asset->id)->get(['title'])->map(fn ($h) => 'Handout · '.$h->title)->all(),
        );
    }

    public function update(Asset $asset, array $data): array
    {
        return DB::transaction(function () use ($asset, $data) {
            $campaign = Campaign::whereKey($asset->campaign_id)->lockForUpdate()->firstOrFail();
            Gate::authorize('update', $campaign);
            $asset = Asset::whereKey($asset->id)->firstOrFail();
            if (isset($data['name'])) {
                $asset->update(['name' => trim($data['name'])]);
            }
            foreach (['tags' => AssetTag::class, 'collections' => AssetCollection::class] as $relation => $model) {
                if (! array_key_exists($relation, $data)) {
                    continue;
                }
                $ids = [];
                foreach ($data[$relation] as $name) {
                    $name = trim(preg_replace('/\s+/u', ' ', $name));
                    if ($name !== '') {
                        $ids[] = $model::firstOrCreate(['campaign_id' => $campaign->id, 'name' => $name])->id;
                    }
                }
                $asset->$relation()->sync($ids);
            }

            return $this->projection($asset->load(['tags', 'collections']));
        }, 3);
    }

    public function delete(Asset $asset): array
    {
        return DB::transaction(function () use ($asset) {
            $campaign = Campaign::whereKey($asset->campaign_id)->lockForUpdate()->firstOrFail();
            Gate::authorize('update', $campaign);
            $asset = Asset::whereKey($asset->id)->firstOrFail();
            abort_if(count($this->usage($asset)) > 0, 409, 'This asset is in use. Remove its map, token or handout references first.');
            $paths = [$asset->storage_path, app(AssetThumbnail::class)->path($asset), $asset->storage_path.'.thumb.lock'];
            $asset->delete();
            DB::afterCommit(fn () => Storage::disk('campaigns')->delete($paths));

            return ['deleted' => true];
        }, 3);
    }
}
