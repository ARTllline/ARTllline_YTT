<?php

namespace App\Services;

use App\Models\Asset;
use App\Models\AssetCollection;
use App\Models\AssetTag;
use App\Models\Campaign;
use App\Models\ContentTemplate;
use App\Models\Handout;
use App\Models\Scene;
use App\Models\SceneProp;
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
            'duration' => $asset->duration_ms === null ? null : (int) $asset->duration_ms,
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
        if ($asset->duration_ms !== null) {
            $live = app(LiveMedia::class)->authorized($asset->campaign, $asset);
            $cue = DB::table('cue_steps')->join('cues', 'cue_steps.cue_id', '=', 'cues.id')->join('scenes', 'cues.scene_id', '=', 'scenes.id')
                ->where('scenes.campaign_id', $asset->campaign_id)->where(fn ($q) => $q->where('config->assetId', (string) $asset->id)->orWhere('config->assetId', $asset->id))->exists();

            return array_values(array_filter([$live ? 'Сейчас звучит или завершается воспроизведение' : null, $cue ? 'Используется в событии' : null]));
        }

        return array_merge(
            SceneProp::where('asset_id', $asset->id)->with('scene:id,name')->get()->map(fn ($p) => 'Объект · '.$p->name.' / '.$p->scene->name)->all(),
            ContentTemplate::whereHas('items', fn ($q) => $q->where('asset_id', $asset->id))->get()->map(fn ($t) => ($t->kind === 'prefab' ? 'Заготовка · ' : 'Столкновение · ').$t->name)->all(),
            Scene::where('map_asset_id', $asset->id)->get(['id', 'name'])->map(fn ($s) => 'Карта · '.$s->name)->all(),
            Token::where('token_image_asset_id', $asset->id)->with('scene:id,name')->get()->map(fn ($t) => 'Токен · '.$t->name.' / '.$t->scene->name)->all(),
            Handout::where('asset_id', $asset->id)->get(['title'])->map(fn ($h) => 'Раздаточный материал · '.$h->title)->all(),
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
