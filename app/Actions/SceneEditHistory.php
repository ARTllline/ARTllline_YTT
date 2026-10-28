<?php

namespace App\Actions;

use App\Models\Scene;
use App\Models\SceneNote;
use App\Models\SceneProp;
use App\Models\SceneRegion;
use App\Models\Token;
use App\Models\User;
use App\Services\RegionGeometry;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;

/** Safe inverse editing commands. Never replays live game actions or trigger detection. */
class SceneEditHistory
{
    public function execute(User $user, Scene $scene, array $input): array
    {
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
                abort_if($model->is_locked ?? false, 409, 'Отмена недоступна: объект заблокирован.');
                $current = $kind === 'token' ? app(SceneSnapshotBuilder::class)->token($model, true, $user) : $model->projection(true);
                $allowed = match ($kind) {
                    'token', 'note' => ['x', 'y'],
                    'prop' => ['x', 'y', 'rotation', 'scaleX', 'scaleY'],
                    'region' => ['name', 'shape', 'geometry', 'enabled'],
                };
                $keys = array_keys($change['value']);
                abort_if(array_diff($keys, $allowed) || array_diff($keys, array_keys($change['expected'])) || array_diff(array_keys($change['expected']), $keys), 422);
                foreach ($keys as $key) {
                    abort_unless($current[$key] == $change['expected'][$key], 409, 'Отмена недоступна: объект изменён другим действием. Сцена будет обновлена.');
                }
                if ($kind === 'region') {
                    $patch = RegionGeometry::validate(array_replace($current, $change['value']));
                } else {
                    $rules = ['x' => 'sometimes|numeric|between:-1000000,1000000', 'y' => 'sometimes|numeric|between:-1000000,1000000'];
                    if ($kind === 'prop') {
                        $rules += ['rotation' => 'sometimes|numeric|between:0,360', 'scaleX' => 'sometimes|numeric|between:0.001,100', 'scaleY' => 'sometimes|numeric|between:0.001,100'];
                    }
                    $patch = Validator::make($change['value'], $rules)->validate();
                    foreach (['scaleX' => 'scale_x', 'scaleY' => 'scale_y'] as $from => $to) {
                        if (isset($patch[$from])) {
                            $patch[$to] = $patch[$from];
                            unset($patch[$from]);
                        }
                    }
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
