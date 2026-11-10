<?php

namespace App\Actions;

use App\Models\Scene;
use App\Models\SceneNote;
use App\Models\SceneProp;
use App\Models\SceneRegion;
use App\Models\Token;
use App\Models\User;
use App\Services\RegionGeometry;
use App\Services\PropCollider;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;

/** Safe inverse editing commands. Never replays live game actions or trigger detection. */
class SceneEditHistory
{
    public function execute(User $user, Scene $scene, array $input): array
    {
        if (($input['changes'][0]['kind'] ?? null) === 'fog') {
            return app(FogActions::class)->history($user, $scene, $input);
        }
        if (($input['changes'][0]['kind'] ?? null) === 'structure') {
            $data = Validator::make($input, ['changes' => 'required|array|size:1',
                'changes.0.id' => 'required|integer', 'changes.0.expected.hash' => 'required|string|size:64',
                'changes.0.value.snapshot' => 'required|string'])->validate()['changes'][0];
            abort_unless((int) $data['id'] === $scene->id, 422);

            return app(StructureActions::class)->execute($user, $scene, [
                'expected' => $data['expected']['hash'], 'value' => $data['value'],
            ], true);
        }
        if (($input['changes'][0]['kind'] ?? null) === 'terrain') {
            Gate::forUser($user)->authorize('update', $scene);
            $data = Validator::make($input, ['changes' => 'required|array|size:1',
                'changes.0.id' => 'required|integer', 'changes.0.expected' => 'required|array', 'changes.0.value' => 'required|array'])->validate();
            abort_unless((int) $data['changes'][0]['id'] === $scene->id, 422);
            return app(TerrainActions::class)->execute($user, $scene, $data['changes'][0], true);
        }
        if (($input['changes'][0]['kind'] ?? null) === 'propPresence') {
            return app(SceneTransaction::class)->run($scene, function ($scene) use ($user, $input) {
                Gate::forUser($user)->authorize('update', $scene);
                $data = Validator::make($input, ['changes' => 'required|array|min:1|max:200',
                    'changes.*.kind' => 'required|in:propPresence', 'changes.*.id' => 'required|integer|min:1',
                    'changes.*.expected' => 'required|array:present,snapshot', 'changes.*.value' => 'required|array:present,snapshot',
                    'changes.*.expected.present' => 'required|boolean', 'changes.*.value.present' => 'required|boolean',
                    'changes.*.expected.snapshot' => 'required|string|max:8192', 'changes.*.value.snapshot' => 'required|string|max:8192'])->validate();

                return app(PropEditHistory::class)->apply($scene, $data['changes']);
            }, 'objects.changed');
        }
        if (($input['changes'][0]['kind'] ?? null) === 'mapWorld') {
            Gate::forUser($user)->authorize('update', $scene);
            $data = Validator::make($input, ['changes' => 'required|array|size:1',
                'changes.0.id' => 'required|integer', 'changes.0.expected' => 'required|array', 'changes.0.value' => 'required|array'])->validate();
            abort_unless((int) $data['changes'][0]['id'] === $scene->id, 422);

            return app(MapWorldActions::class)->execute($user, $scene, $data['changes'][0]['value'], $data['changes'][0]['expected'], true);
        }

        return app(SceneTransaction::class)->run($scene, function ($scene) use ($user, $input) {
            Gate::forUser($user)->authorize('update', $scene);
            $data = Validator::make($input, [
                'changes' => 'required|array|min:1|max:200', 'changes.*.kind' => 'required|in:token,prop,note,region',
                'changes.*.id' => 'required|integer|min:1', 'changes.*.expected' => 'required|array|min:1', 'changes.*.value' => 'required|array|min:1',
            ])->validate();
            $result = ['tokens' => [], 'props' => [], '_previousVisibility' => ['tokens' => [], 'props' => []]];
            $seen = [];
            foreach ($data['changes'] as $change) {
                $kind = $change['kind'];
                $identity = $kind.':'.$change['id'];
                abort_if(isset($seen[$identity]) || (in_array($kind, ['note', 'region']) && count($data['changes']) !== 1), 422);
                $seen[$identity] = true;
                $class = match ($kind) {
                    'token' => Token::class, 'prop' => SceneProp::class, 'note' => SceneNote::class, 'region' => SceneRegion::class
                };
                $model = $class::where('scene_id', $scene->id)->find($change['id']);
                abort_unless($model, 409, 'Отмена недоступна: объект удалён. Сцена будет обновлена.');
                abort_if(($model->is_locked ?? false) && ! ($kind === 'prop' && array_key_exists('isLocked', $change['value'])), 409, 'Отмена недоступна: объект заблокирован.');
                $current = $kind === 'token' ? app(SceneSnapshotBuilder::class)->token($model, true, $user) : $model->projection(true);
                $allowed = match ($kind) {
                    'token', 'note' => ['x', 'y'],
                    'prop' => ['name', 'x', 'y', 'rotation', 'scaleX', 'scaleY', 'zIndex', 'isHidden', 'isLocked', 'collider'],
                    'region' => ['name', 'shape', 'geometry', 'enabled'],
                };
                $keys = array_keys($change['value']);
                abort_if(array_diff($keys, $allowed) || array_diff($keys, array_keys($change['expected'])) || array_diff(array_keys($change['expected']), $keys), 422);
                foreach ($keys as $key) {
                    abort_unless(array_key_exists($key, $current) && $current[$key] == $change['expected'][$key], 409, 'Отмена недоступна: объект изменён другим действием. Сцена будет обновлена.');
                }
                if ($kind === 'region') {
                    $patch = RegionGeometry::validate(array_replace($current, $change['value']));
                } else {
                    $rules = ['x' => 'sometimes|numeric|between:-1000000,1000000', 'y' => 'sometimes|numeric|between:-1000000,1000000'];
                    if ($kind === 'prop') {
                        $rules += ['name' => 'sometimes|nullable|string|max:160', 'rotation' => 'sometimes|numeric|between:-360,360', 'scaleX' => 'sometimes|numeric|between:0.001,100', 'scaleY' => 'sometimes|numeric|between:0.001,100', 'zIndex' => 'sometimes|integer|between:-1000000,1000000', 'isHidden' => 'sometimes|boolean', 'isLocked' => 'sometimes|boolean', 'collider' => 'sometimes|array'];
                    }
                    $patch = Validator::make($change['value'], $rules)->validate();
                    if ($model instanceof SceneProp) {
                        $patch = PropCollider::instancePatch($model, $patch);
                    }
                    foreach (['scaleX' => 'scale_x', 'scaleY' => 'scale_y', 'zIndex' => 'z_index', 'isHidden' => 'is_hidden', 'isLocked' => 'is_locked'] as $from => $to) {
                        if (isset($patch[$from])) {
                            $patch[$to] = $patch[$from];
                            unset($patch[$from]);
                        }
                    }
                }
                if ($kind === 'prop' && ! $model->is_hidden) {
                    $result['_previousVisibility']['props'][] = (string) $model->id;
                }
                $model->update($patch);
                $model = $model->fresh();
                if ($kind === 'token') {
                    $result['tokens'][] = app(SceneSnapshotBuilder::class)->token($model, true, $user);
                } elseif ($kind === 'prop') {
                    $result['props'][] = $model->load('asset')->projection(true);
                } else {
                    $result[$kind] = $model->projection();
                }
                if (in_array($kind, ['token', 'prop']) && ! $model->is_hidden) {
                    $result['_previousVisibility'][$kind === 'token' ? 'tokens' : 'props'][] = (string) $model->id;
                }
            }

            return $result;
        }, 'objects.changed');
    }
}
