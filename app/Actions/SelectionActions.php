<?php

namespace App\Actions;

use App\Models\Scene;
use App\Models\Token;
use App\Models\User;
use App\Services\MovementCollision;
use App\Services\SceneSelection;
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
            if (in_array($data['action'], ['duplicate', 'delete'])) {
                if ($data['action'] === 'duplicate') {
                    $anchor = $tokens->first() ?? $props->first();
                    $data += ['anchorKind' => $tokens->isNotEmpty() ? 'token' : 'prop', 'anchorId' => $anchor->id, 'x' => $anchor->x + 30, 'y' => $anchor->y + 30];
                    if (isset($data['expected'])) app(TranslateSceneSelection::class)->apply($tokens, $props, $data, false);
                }
                return app(PreparationSelection::class)->execute($scene, $user, $tokens, $props, $data);
            }
            if (in_array($data['action'], ['hide', 'show'])) {
                abort_if($tokens->contains('is_locked', true) || $props->contains('is_locked', true), 409, 'Сначала разблокируйте все выбранные объекты.');
                $before = $selection->result($tokens, $props, $user);
                foreach ($tokens->concat($props) as $object) $object->update(['is_hidden' => $data['action'] === 'hide']);
                return $selection->result($tokens, $props, $user) + ['_previousVisibility' => $previous,
                    'selectionVisibilityBefore' => ['tokens' => array_map(fn ($o) => ['id' => $o['id'], 'isHidden' => $o['isHidden']], $before['tokens']),
                        'props' => array_map(fn ($o) => ['id' => $o['id'], 'isHidden' => $o['isHidden']], $before['props'])]];
            }
            $tokenMovements = [];
            if ($data['action'] === 'translate') {
                app(TranslateSceneSelection::class)->apply($tokens, $props, $data);
            } elseif ($data['action'] === 'move') {
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
            }

            return $selection->result($tokens, $props, $user) + ($tokenMovements ? ['tokenMovements' => $tokenMovements] : []) + ['_previousVisibility' => $previous,
                '_combatChanged' => $data['action'] === 'move' && $tokens->isNotEmpty()];
        }, 'objects.changed');
    }
}
