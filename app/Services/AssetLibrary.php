<?php

namespace App\Services;

use App\Models\Asset;
use App\Models\AssetCollection;
use App\Models\AssetTag;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\CompendiumEntry;
use App\Models\ContentTemplate;
use App\Models\Handout;
use App\Models\ItemDefinition;
use App\Models\LibraryItem;
use App\Models\MapMaterialVersion;
use App\Models\ObjectPreset;
use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\Token;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class AssetLibrary
{
    public function projection(Asset $asset): array
    {
        return app(SceneSnapshotBuilder::class)->asset($asset) + [
            'name' => $asset->name, 'originalName' => $asset->original_name, 'kind' => $asset->kind,
            'category' => $asset->category ?? match ($asset->kind) {
                'map' => 'maps', 'token' => 'tokens', 'handout' => 'handouts', 'prop' => 'props', default => 'audio'
            },
            'duration' => $asset->duration_ms === null ? null : (int) $asset->duration_ms,
            'thumbnailUrl' => '/api/assets/'.$asset->id.'/thumbnail', 'mimeType' => $asset->mime_type,
            'fileSize' => $asset->file_size, 'createdAt' => $asset->created_at->toIso8601String(),
            ...($asset->builtin_key ? ['builtin' => true, 'displayName' => Str::after($asset->name, ' · ')] : []),
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
            $live = Campaign::all()->contains(fn ($c) => app(LiveMedia::class)->authorized($c, $asset));
            $cue = DB::table('cue_steps')->join('cues', 'cue_steps.cue_id', '=', 'cues.id')->join('scenes', 'cues.scene_id', '=', 'scenes.id')
                ->where(fn ($q) => $q->where('config->assetId', (string) $asset->id)->orWhere('config->assetId', $asset->id))->exists();
            $pending = DB::table('cue_run_steps')->join('cue_runs', 'cue_run_steps.cue_run_id', '=', 'cue_runs.id')
                ->whereIn('cue_runs.status', ['queued', 'running', 'failed'])
                ->where(fn ($q) => $q->where('cue_run_steps.config->assetId', (string) $asset->id)->orWhere('cue_run_steps.config->assetId', $asset->id))->exists();

            return array_values(array_filter([$live ? 'Сейчас звучит или завершается воспроизведение' : null, $cue ? 'Используется в событии' : null, $pending ? 'Ожидает выполнения в запущенном событии' : null]));
        }

        return array_merge(
            ObjectPreset::where('asset_id', $asset->id)->get()->map(fn ($preset) => $preset->library_user_id === auth()->id()
                ? 'Пресет объекта · '.$preset->name : 'Используется в другой библиотеке')->all(),
            MapMaterialVersion::with('material')->where('asset_id', $asset->id)->get()->map(fn ($m) => $this->reference((object) ['library_user_id' => $m->material->user_id, 'user_id' => null, 'campaign_id' => null], 'Материал · '.$m->name.' / v'.$m->version))->all(),
            $this->iconUsage($asset),
            Character::where('portrait_asset_id', $asset->id)->get()->map(fn ($c) => $this->reference($c, 'Персонаж · '.$c->name))->all(),
            SceneProp::where('asset_id', $asset->id)->with('scene:id,name,campaign_id')->get()->map(fn ($p) => $this->reference($p->scene, 'Объект · '.$p->name.' / '.$p->scene->name))->all(),
            ContentTemplate::whereHas('items', fn ($q) => $q->where('asset_id', $asset->id))->get()->map(fn ($t) => $this->reference($t, ($t->kind === 'prefab' ? 'Заготовка · ' : 'Столкновение · ').$t->name))->all(),
            Scene::where('map_asset_id', $asset->id)->get()->map(fn ($s) => $this->reference($s, 'Карта · '.$s->name))->all(),
            Token::where('token_image_asset_id', $asset->id)->with('scene:id,name,campaign_id')->get()->map(fn ($t) => $this->reference($t->scene, 'Токен · '.$t->name.' / '.$t->scene->name))->all(),
            Handout::where('asset_id', $asset->id)->get()->map(fn ($h) => $this->reference($h, 'Раздаточный материал · '.$h->title))->all(),
        );
    }

    private function iconUsage(Asset $asset): array
    {
        $needle = '%"asset:'.$asset->id.'"%';

        return array_merge(
            Character::where('abilities', 'like', $needle)->get()->map(fn ($c) => $this->reference($c, 'Способности персонажа · '.$c->name))->all(),
            LibraryItem::where('definition', 'like', $needle)->get()->map(fn ($i) => $this->reference($i, 'Item Library · '.($i->definition['name'] ?? $i->id)))->all(),
            ItemDefinition::where(fn ($q) => $q->where('icon', 'asset:'.$asset->id)->orWhere('gameplay', 'like', $needle))->get()->map(fn ($i) => $this->reference($i, 'Предмет · '.$i->name))->all(),
            CompendiumEntry::whereNotNull('library_user_id')->where('normalized_data', 'like', $needle)->get()->map(fn ($e) => $this->reference($e, 'Spell Library · '.$e->name))->all(),
        );
    }

    private function reference($model, string $label): string
    {
        $user = auth()->user();
        $owned = $user && ($model->library_user_id === $user->id || $model->user_id === $user->id);
        $gm = $user && $model->campaign_id && Campaign::find($model->campaign_id)?->roleFor($user) === 'gm';
        if ($model instanceof ItemDefinition && $user && ! $gm) {
            $owned = Character::where('library_user_id', $user->id)->whereHas('inventory', fn ($q) => $q->where('item_definition_id', $model->id))->exists();
        }

        return $owned || $gm ? $label : 'Используется в другой библиотеке или кампании';
    }

    public function authorizeEdit(Asset $asset): void
    {
        abort_unless(! $asset->builtin_key && ($asset->library_user_id === auth()->id()
            || ($asset->campaign && $asset->campaign->roleFor(auth()->user()) === 'gm')), 403);
    }

    public function update(Asset $asset, array $data): array
    {
        return DB::transaction(function () use ($asset, $data) {
            $this->authorizeEdit($asset);
            $asset = Asset::whereKey($asset->id)->lockForUpdate()->firstOrFail();
            if (isset($data['name'])) {
                $asset->update(['name' => trim($data['name'])]);
            }
            if (isset($data['category'])) {
                $asset->update(['category' => $data['category']]);
            }
            foreach (['tags' => AssetTag::class, 'collections' => AssetCollection::class] as $relation => $model) {
                if (! array_key_exists($relation, $data)) {
                    continue;
                }
                $ids = [];
                foreach ($data[$relation] as $name) {
                    $name = trim(preg_replace('/\s+/u', ' ', $name));
                    if ($name !== '') {
                        $scope = $asset->campaign_id ? ['campaign_id' => $asset->campaign_id] : ['library_user_id' => $asset->library_user_id ?? auth()->id(), 'campaign_id' => null];
                        $ids[] = $model::firstOrCreate($scope + ['name' => $name])->id;
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
            $this->authorizeEdit($asset);
            $asset = Asset::whereKey($asset->id)->lockForUpdate()->firstOrFail();
            abort_if(count($this->usage($asset)) > 0, 409, 'This asset is in use. Remove its map, token or handout references first.');
            $paths = [$asset->storage_path, app(AssetThumbnail::class)->path($asset), $asset->storage_path.'.thumb.lock'];
            $asset->delete();
            DB::afterCommit(fn () => Storage::disk('campaigns')->delete($paths));

            return ['deleted' => true];
        }, 3);
    }
}
