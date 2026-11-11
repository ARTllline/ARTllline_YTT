<?php

namespace App\Http\Controllers;

use App\Actions\CharacterActions;
use App\Actions\CompositionMedia;
use App\Actions\CompositionSnapshot;
use App\Actions\PreparationSelection;
use App\Actions\SceneTransaction;
use App\Events\TabletopEvent;
use App\Models\CompositionPreset;
use App\Models\Scene;
use App\Realtime\SafeBroadcast;
use App\Services\SceneSelection;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;

class CompositionPresetController extends Controller
{
    private function notify(CompositionPreset $preset, bool $deleted = false): void
    {
        $channel = 'library.'.$preset->user_id.'.compositions';
        $event = new TabletopEvent($channel, ['type' => 'composition-library.changed',
            'presetId' => (string) $preset->id, 'revision' => $preset->revision ?? 1, 'deleted' => $deleted]);
        DB::afterCommit(fn () => app(SafeBroadcast::class)->send($event));
    }

    public function index(Request $r): array
    {
        $data = $r->validate(['search' => 'nullable|string|max:160', 'page' => 'sometimes|integer|min:1']);
        $query = CompositionPreset::where('user_id', $r->user()->id);
        if ($search = trim($data['search'] ?? '')) {
            $terms = array_unique([$search, mb_strtolower($search), mb_convert_case($search, MB_CASE_TITLE)]);
            $query->where(function ($q) use ($terms) {
                foreach ($terms as $term) {
                    $like = '%'.strtr($term, ['!' => '!!', '%' => '!%', '_' => '!_']).'%';
                    $q->orWhereRaw("name LIKE ? ESCAPE '!'", [$like])->orWhereRaw("description LIKE ? ESCAPE '!'", [$like]);
                }
            });
        }
        $page = $query->with('assets')->orderBy('name')->orderBy('id')->paginate(12);

        return ['presets' => $page->getCollection()->map->projection(), 'pages' => $page->lastPage()];
    }

    public function store(Request $r, Scene $scene): array
    {
        $data = $r->validate(['name' => 'required|string|max:160', 'description' => 'nullable|string|max:2000',
            'expectedRevision' => 'required|integer|min:0', 'tokenIds' => 'present|array|max:200', 'tokenIds.*' => 'integer|min:1|distinct',
            'propIds' => 'present|array|max:200', 'propIds.*' => 'integer|min:1|distinct']);
        $paths = [];
        try {
            return DB::transaction(function () use ($r, $scene, $data, &$paths) {
                $scene->campaign()->lockForUpdate()->firstOrFail();
                $scene = Scene::whereKey($scene->id)->lockForUpdate()->firstOrFail();
                Gate::forUser($r->user())->authorize('update', $scene);
                abort_unless($scene->revision === $data['expectedRevision'], 409, 'Сцена изменилась. Обновите состав перед сохранением пресета.');
                [$tokens, $props] = app(SceneSelection::class)->resolve($scene, $data);
                $snapshot = app(CompositionSnapshot::class)->capture($scene, $tokens, $props);
                [$snapshot, $assets] = app(CompositionMedia::class)->capture($snapshot, $r->user(), $paths);
                app(CompositionSnapshot::class)->limit($snapshot);
                $preset = CompositionPreset::create(['user_id' => $r->user()->id, 'name' => trim($data['name']), 'description' => $data['description'] ?? null, 'snapshot' => $snapshot]);
                $preset->assets()->sync(array_unique($assets));
                $this->notify($preset);

                return ['preset' => $preset->fresh()->projection()];
            });
        } catch (\Throwable $e) {
            Storage::disk('campaigns')->delete($paths);
            throw $e;
        }
    }

    public function command(Request $r, int $composition): array
    {
        $data = $r->validate(['action' => 'required|in:rename,duplicate,delete', 'expectedRevision' => 'required|integer|min:1',
            'name' => 'required_if:action,rename|string|max:160', 'description' => 'nullable|string|max:2000']);

        return DB::transaction(function () use ($r, $composition, $data) {
            $preset = CompositionPreset::where('user_id', $r->user()->id)->lockForUpdate()->findOrFail($composition);
            abort_unless($preset->revision === $data['expectedRevision'], 409, 'Пресет изменился. Обновите каталог.');
            if ($data['action'] === 'delete') {
                $preset->delete();
                $this->notify($preset, true);

                return ['deletedId' => (string) $composition];
            }
            if ($data['action'] === 'duplicate') {
                $assets = $preset->assets->modelKeys();
                $preset = $preset->replicate();
                $preset->name = mb_substr($preset->name, 0, 151).' · копия';
                $preset->revision = 1;
                $preset->save();
                $preset->assets()->sync($assets);
            } else {
                $preset->update(['name' => trim($data['name']), 'description' => $data['description'] ?? $preset->description, 'revision' => $preset->revision + 1]);
            }

            $this->notify($preset);

            return ['preset' => $preset->fresh()->projection()];
        });
    }

    public function place(Request $r, Scene $scene): array
    {
        $data = $r->validate(['presetId' => 'required|integer|min:1', 'expectedRevision' => 'required|integer|min:1',
            'x' => 'required|numeric|between:-1000000,1000000', 'y' => 'required|numeric|between:-1000000,1000000']);

        return app(SceneTransaction::class)->run($scene, function ($scene) use ($r, $data) {
            Gate::forUser($r->user())->authorize('update', $scene);
            $preset = CompositionPreset::where('user_id', $r->user()->id)->lockForUpdate()->findOrFail($data['presetId']);
            abort_unless($preset->revision === $data['expectedRevision'], 409, 'Пресет изменился. Выберите его заново в каталоге.');
            foreach ($preset->assets()->orderBy('assets.id')->lockForUpdate()->get() as $asset) {
                abort_unless($asset->library_user_id === $r->user()->id || $asset->builtin_key, 422, 'Изображение пресета недоступно.');
            }
            [$tokens, $props] = app(CompositionSnapshot::class)->instantiate($preset->snapshot, $scene, $r->user(), (float) $data['x'], (float) $data['y']);

            return app(SceneSelection::class)->result($tokens, $props, $r->user())
                + ['selectionEdit' => app(PreparationSelection::class)->edit($scene, $tokens, $props, true)]
                + ($tokens->contains(fn ($t) => (bool) $t->character_id) ? ['charactersChanged' => true, 'scene' => app(CharacterActions::class)->roster($scene->campaign, $r->user())] : []);
        }, 'objects.changed');
    }
}
