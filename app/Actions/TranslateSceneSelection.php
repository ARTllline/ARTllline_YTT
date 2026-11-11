<?php

namespace App\Actions;

use Illuminate\Support\Collection;

/** GM authoring only: one rigid translation, without gameplay movement or triggers. */
class TranslateSceneSelection
{
    // Called after GM authorization and selection resolution under SceneTransaction locks.
    public function apply(Collection $tokens, Collection $props, array $data, bool $write = true): void
    {
        $all = $tokens->mapWithKeys(fn ($t) => ['token:'.$t->id => $t])
            ->union($props->mapWithKeys(fn ($p) => ['prop:'.$p->id => $p]));
        $expected = collect($data['expected']);
        $keys = $expected->map(fn ($p) => $p['kind'].':'.$p['id']);
        abort_unless($keys->unique()->count() === $all->count() && $keys->count() === $all->count()
            && $keys->diff($all->keys())->isEmpty(), 422, 'Проверьте состав выделения.');
        $anchor = $all->get($data['anchorKind'].':'.$data['anchorId']);
        abort_unless($anchor, 422, 'Опорный объект должен входить в выделение.');
        $dx = round((float) $data['x'] - $anchor->x, 3);
        $dy = round((float) $data['y'] - $anchor->y, 3);
        // Validate every member before writing. SceneSelection has already rejected cross-scene IDs.
        foreach ($expected as $point) {
            $object = $all->get($point['kind'].':'.$point['id']);
            abort_if($object->is_locked, 409, 'Сначала разблокируйте все выбранные объекты.');
            abort_unless(abs($object->x - $point['x']) < 0.0005 && abs($object->y - $point['y']) < 0.0005,
                409, 'Группа изменилась во время перемещения. Повторите жест.');
            abort_if(abs($object->x + $dx) > 1000000 || abs($object->y + $dy) > 1000000,
                422, 'Группа выходит за допустимые границы координат.');
        }
        if (! $write) return;
        foreach ($all as $object) {
            $object->update(['x' => round($object->x + $dx, 3), 'y' => round($object->y + $dy, 3)]);
        }
    }
}
