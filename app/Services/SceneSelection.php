<?php

namespace App\Services;

use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\User;
use Illuminate\Support\Collection;

class SceneSelection
{
    /** Resolve all IDs before writing anything; mixed IDs never cross scene boundaries. */
    public function resolve(Scene $scene, array $selection): array
    {
        $tokenIds = array_values(array_unique($selection['tokenIds'] ?? []));
        $propIds = array_values(array_unique($selection['propIds'] ?? []));
        abort_unless(count($tokenIds) + count($propIds) > 0 && count($tokenIds) + count($propIds) <= 200, 422, 'Выберите от 1 до 200 объектов.');
        $tokens = $scene->tokens()->with(['imageAsset', 'conditions'])->whereIn('id', $tokenIds)->orderBy('id')->get();
        $props = SceneProp::with('asset')->where('scene_id', $scene->id)->whereIn('id', $propIds)->orderBy('z_index')->orderBy('id')->get();
        abort_unless($tokens->count() === count($tokenIds) && $props->count() === count($propIds), 422, 'Выберите объекты из этой сцены.');

        return [$tokens, $props];
    }

    public function visible(Collection $tokens, Collection $props): array
    {
        return ['tokens' => $tokens->where('is_hidden', false)->pluck('id')->map(strval(...))->all(),
            'props' => $props->where('is_hidden', false)->pluck('id')->map(strval(...))->all()];
    }

    public function result(Collection $tokens, Collection $props, User $user): array
    {
        $tokens = new \Illuminate\Database\Eloquent\Collection($tokens->all());
        $props = new \Illuminate\Database\Eloquent\Collection($props->all());
        $tokens->load(['imageAsset', 'conditions']);
        $props->load('asset');

        return ['tokens' => $tokens->map(fn ($t) => app(SceneSnapshotBuilder::class)->token($t, true, $user))->all(),
            'props' => $props->map(fn ($p) => $p->projection(true))->all()];
    }
}
