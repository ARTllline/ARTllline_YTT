<?php

namespace App\Actions;

use App\Models\Combat;
use App\Models\Scene;
use App\Models\Token;
use App\Models\User;
use App\Services\SceneSelection;
use Illuminate\Support\Facades\Gate;

class SelectionActions
{
    public function execute(User $user, Scene $scene, array $data): array
    {
        return app(SceneTransaction::class)->run($scene, function ($scene) use ($user, $data) {
            Gate::forUser($user)->authorize('update', $scene);
            $selection = app(SceneSelection::class);
            [$tokens, $props] = $selection->resolve($scene, $data);
            $previous = $selection->visible($tokens, $props);
            if ($data['action'] === 'delete') {
                $deleted = ['deletedIds' => $tokens->pluck('id')->map(strval(...))->all(), 'deletedPropIds' => $props->pluck('id')->map(strval(...))->all()];
                $combat = Combat::where('scene_id', $scene->id)->whereIn('status', ['preparing', 'active'])->first();
                foreach ($tokens as $token) {
                    if ($combat && ($entry = $combat->combatants()->where('token_id', $token->id)->first())) {
                        app(CombatActions::class)->remove($combat, (string) $entry->id);
                    }
                    $token->delete();
                }
                foreach ($props as $prop) {
                    $prop->delete();
                }

                return $deleted + ['_previousVisibility' => $previous, '_combatChanged' => $tokens->isNotEmpty()];
            }
            if ($data['action'] === 'move') {
                // Absolute client anchor is converted to one shared delta; preserve relative layout.
                $anchor = $data['anchorKind'] === 'token' ? $tokens->firstWhere('id', $data['anchorId']) : $props->firstWhere('id', $data['anchorId']);
                abort_unless($anchor, 422, 'Опорный объект должен входить в выделение.');
                abort_if($tokens->contains('is_locked', true) || $props->contains('is_locked', true), 409, 'Сначала разблокируйте все выбранные объекты.');
                $dx = $data['x'] - $anchor->x;
                $dy = $data['y'] - $anchor->y;
                foreach ($tokens->concat($props) as $object) {
                    abort_if(abs($object->x + $dx) > 1000000 || abs($object->y + $dy) > 1000000, 422, 'Объекты выходят за допустимые границы.');
                    $object->update(['x' => $object->x + $dx, 'y' => $object->y + $dy]);
                    $object->refresh();
                }
            } else {
                $duplicate = function ($object) {
                    abort_if(abs($object->x + 30) > 1000000 || abs($object->y + 30) > 1000000, 422, 'Объекты выходят за допустимые границы.');
                    $copy = $object->replicate();
                    $copy->x += 30;
                    $copy->y += 30;
                    $copy->save();
                    if ($object instanceof Token) {
                        foreach ($object->conditions as $condition) {
                            $copy->conditions()->create($condition->only(['key', 'label', 'normalized_label', 'visibility', 'created_by']));
                        }
                    }

                    return $copy;
                };
                $tokens = $tokens->map($duplicate);
                $props = $props->map($duplicate);
                $previous = ['tokens' => [], 'props' => []];
            }

            return $selection->result($tokens, $props, $user) + ['_previousVisibility' => $previous];
        }, 'objects.changed');
    }
}
