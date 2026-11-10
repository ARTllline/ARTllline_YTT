<?php

namespace App\Actions;

use App\Models\Scene;
use App\Models\User;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;

class FogActions
{
    public function __construct(private SceneTransaction $transaction) {}

    public static function strokeRules(string $prefix = ''): array
    {
        return [
            $prefix.'operation' => 'required|in:reveal,cover,explore',
            $prefix.'shape' => 'required|in:brush,rectangle',
            $prefix.'geometry' => 'required|array:points,radius',
            $prefix.'geometry.points' => 'required|array|list|min:1|max:512',
            $prefix.'geometry.points.*' => 'required|array:x,y',
            $prefix.'geometry.points.*.x' => 'required|numeric|between:-20000,40000',
            $prefix.'geometry.points.*.y' => 'required|numeric|between:-20000,40000',
            $prefix.'geometry.radius' => 'required_if:'.$prefix.'shape,brush|prohibited_if:'.$prefix.'shape,rectangle|numeric|between:5,600',
        ];
    }

    public static function checkShape(array $stroke): void
    {
        abort_if($stroke['shape'] === 'rectangle' && count($stroke['geometry']['points']) !== 2, 422);
    }

    public function append(User $user, Scene $scene, array $data): array
    {
        return $this->transaction->run($scene, function (Scene $scene) use ($user, $data) {
            Gate::forUser($user)->authorize('update', $scene);
            $previous = $this->head($scene);
            // Scene duplication preserves fog order but starts a fresh scene revision.
            $sequence = max($scene->revision, $previous['sequence']) + 1;
            $action = $scene->fogActions()->create($data + ['sequence' => $sequence, 'created_by' => $user->id]);

            return ['fogAction' => $action->projection(), 'fogPrevious' => $previous];
        }, 'fog.action');
    }

    public function reset(User $user, Scene $scene, string $base): array
    {
        return $this->transaction->run($scene, function (Scene $scene) use ($user, $base) {
            Gate::forUser($user)->authorize('update', $scene);
            $previous = $this->head($scene) + ['actions' => $scene->fogActions()->get()->map->projection()->all()];
            $scene->update(['fog_base' => $base]);
            $scene->fogActions()->delete();

            return ['fog' => ['base' => $base, 'actions' => []], 'fogPrevious' => $previous];
        }, 'fog.reset');
    }

    public function history(User $user, Scene $scene, array $input): array
    {
        Gate::forUser($user)->authorize('update', $scene);
        $data = Validator::make($input, [
            'changes' => 'required|array|list|size:1',
            'changes.0.id' => 'required|integer',
            'changes.0.expected' => 'required|array',
            'changes.0.expected.base' => 'required|in:clear,covered',
            'changes.0.expected.sequence' => 'required|integer|between:0,9007199254740990',
            'changes.0.value' => 'required|array:base,sequence,append,actions',
            'changes.0.value.base' => 'required|in:clear,covered',
            'changes.0.value.sequence' => 'required|integer|between:0,9007199254740990',
            'changes.0.value.append' => 'sometimes|array:operation,shape,geometry',
            'changes.0.value.actions' => 'sometimes|array|list',
        ])->validate()['changes'][0];
        abort_unless((int) $data['id'] === $scene->id, 422);

        return $this->transaction->run($scene, function (Scene $scene) use ($user, $data) {
            Gate::forUser($user)->authorize('update', $scene);
            $head = $this->head($scene);
            $value = $data['value'];
            $sequence = (int) $value['sequence'];
            abort_unless($head['base'] === $data['expected']['base'] && $head['sequence'] === (int) $data['expected']['sequence'], 409);
            if (array_key_exists('actions', $value)) {
                abort_if(isset($value['append']), 422);
                $last = 0;
                $rows = [];
                foreach ($value['actions'] as $action) {
                    $row = Validator::make((array) $action, self::strokeRules() + ['sequence' => 'required|integer|min:1'])->validate();
                    self::checkShape($row);
                    abort_if($row['sequence'] <= $last || $row['sequence'] > $sequence, 422);
                    $last = (int) $row['sequence'];
                    $rows[] = $row;
                }
                abort_unless($last === $sequence, 422);
                $scene->fogActions()->delete();
                $scene->update(['fog_base' => $value['base']]);
                $actions = $scene->fogActions()->createMany($rows)->map->projection()->all();

                return ['fog' => ['base' => $value['base'], 'actions' => $actions]];
            }
            abort_unless($value['base'] === $head['base'], 422);
            if (isset($value['append'])) {
                abort_unless($sequence > $head['sequence'], 422);
                $stroke = Validator::make($value['append'], self::strokeRules())->validate();
                self::checkShape($stroke);
                $action = $scene->fogActions()->create($stroke + ['sequence' => $sequence, 'created_by' => $user->id]);

                return ['fogAction' => $action->projection()];
            }
            $tail = $scene->fogActions()->reorder('sequence', 'desc')->limit(2)->pluck('sequence');
            abort_unless($head['sequence'] > 0 && (int) ($tail[1] ?? 0) === $sequence, 409);
            $scene->fogActions()->where('sequence', $head['sequence'])->delete();

            return ['fogRemovedSequence' => $head['sequence']];
        }, 'fog.history');
    }

    private function head(Scene $scene): array
    {
        return ['base' => $scene->fog_base, 'sequence' => (int) $scene->fogActions()->reorder()->max('sequence')];
    }
}
