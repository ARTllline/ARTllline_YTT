<?php

namespace App\Actions;

use App\Models\Combat;
use App\Models\LootContainer;
use App\Models\Scene;
use App\Models\Token;
use App\Models\User;
use App\Services\SceneSelection;
use App\Services\MovementCollision;
use App\Services\StructuralGeometry;
use App\Services\TokenMovement;
use App\Services\TriggerEvents;
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
                abort_if(LootContainer::where(fn ($q) => $q->whereIn('token_id', $tokens->modelKeys())->orWhereIn('prop_id', $props->modelKeys()))->whereHas('items', fn ($q) => $q->where('quantity', '>', 0))->exists(), 422, 'Сначала переместите содержимое добычи.');
                $deleted = ['deletedIds' => $tokens->pluck('id')->map(strval(...))->all(), 'deletedPropIds' => $props->pluck('id')->map(strval(...))->all()];
                $edits = $tokens->isEmpty() ? $props->map(fn ($p) => app(PropEditHistory::class)->capture($p, false))->all() : [];
                $deleted['propEdits'] = in_array(null, $edits, true) ? [] : $edits;
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
            $tokenMovements = [];
            if ($data['action'] === 'move') {
                // Absolute client anchor is converted to one shared delta; preserve relative layout.
                $anchor = $data['anchorKind'] === 'token' ? $tokens->firstWhere('id', $data['anchorId']) : $props->firstWhere('id', $data['anchorId']);
                abort_unless($anchor, 422, 'Опорный объект должен входить в выделение.');
                abort_if($tokens->contains('is_locked', true) || $props->contains('is_locked', true), 409, 'Сначала разблокируйте все выбранные объекты.');
                $dx = $data['x'] - $anchor->x;
                $dy = $data['y'] - $anchor->y;
                $moves = [];
                $shapes = $scene->mapWorld && $tokens->isNotEmpty() ? StructuralGeometry::forScene($scene)['shapes'] : [];
                $movingPropIds = array_map(strval(...), $props->modelKeys());
                $movingShapes = array_filter($shapes, fn ($shape) => in_array($shape['propId'] ?? null, $movingPropIds, true));
                $shapes = array_diff_key($shapes, $movingShapes);
                foreach ($tokens->concat($props) as $object) {
                    abort_if(abs($object->x + $dx) > 1000000 || abs($object->y + $dy) > 1000000, 422, 'Объекты выходят за допустимые границы.');
                    $before = clone $object;
                    $position = ['x' => $object->x + $dx, 'y' => $object->y + $dy];
                    if ($object instanceof Token) {
                        $object->setRelation('scene', $scene);
                        $origin = ['x' => (float) $object->x, 'y' => (float) $object->y];
                        // A selected prop shares the same translation as this token.
                        abort_if(($dx != 0 || $dy != 0) && app(MovementCollision::class)->blocks(
                            $origin, $origin, TokenMovement::radius($object), $movingShapes), 422, 'Перемещение недоступно.');
                        $movement = app(TokenMovement::class)->resolve($user, $object, $position, shapes: $shapes);
                        $position = $movement['position'];
                        if ($movement['path']) {
                            $tokenMovements[] = ['tokenId' => (string) $object->id, 'path' => $movement['path'], 'instant' => true];
                        }
                    }
                    $object->update($position);
                    $object->refresh();
                    if ($object instanceof Token) {
                        $moves[] = [$before, $object, $movement['path']];
                    }
                }
                app(TriggerEvents::class)->movement($scene, $moves);
            } else {
                $duplicate = function ($object) {
                    abort_if($object instanceof Token && $object->character_id, 422, 'Персонаж уже представлен на сцене. Разместите его в другой сцене через «Персонажи».');
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

            $edits = $data['action'] === 'duplicate' && $tokens->isEmpty() ? $props->map(fn ($p) => app(PropEditHistory::class)->capture($p, true))->all() : [];

            return $selection->result($tokens, $props, $user) + ($tokenMovements ? ['tokenMovements' => $tokenMovements] : []) + ['_previousVisibility' => $previous, 'propEdits' => in_array(null, $edits, true) ? [] : $edits,
                '_combatChanged' => $data['action'] === 'move' && $tokens->isNotEmpty()];
        }, 'objects.changed');
    }
}
