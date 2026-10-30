<?php

namespace App\Actions;

use App\Models\Cue;
use App\Models\Handout;
use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\Token;
use App\Models\User;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;

/** Stored targets stay private; player commands contain only object + action IDs. */
class ObjectInteractionActions
{
    public const ICONS = ['book', 'eye', 'hand', 'search', 'door', 'sparkles', 'message', 'play'];

    public function object(Scene $scene, string $kind, string|int $id): Token|SceneProp
    {
        return $kind === 'token' ? $scene->tokens()->findOrFail($id)
            : SceneProp::where('scene_id', $scene->id)->findOrFail($id);
    }

    public function available(Scene $scene, array $action): bool
    {
        $author = User::find($action['author_id']);

        return $action['enabled'] && $author && Gate::forUser($author)->allows('update', $scene)
            && (($action['check']['enabled'] ?? false)
                ? $this->validResult($scene, $action['check']['success']) && $this->validResult($scene, $action['check']['failure'])
                : $this->validResult($scene, $action));
    }

    private function validResult(Scene $scene, array $result): bool
    {
        return match ($result['result_type']) {
            'nothing' => true,
            'handout' => Handout::where('campaign_id', $scene->campaign_id)->whereKey($result['result_target'] ?? null)->exists(),
            'cue' => Cue::where('scene_id', $scene->id)->whereKey($result['result_target'] ?? null)->exists(),
            default => false,
        };
    }

    public function projection(Token|SceneProp $object, bool $gm): array
    {
        $actions = $object->interactions ?? [];
        if ($gm) {
            return array_map(fn ($a) => array_diff_key($a, ['author_id' => true]), $actions);
        }
        if ($object->is_hidden) {
            return [];
        }

        return array_values(array_map(function ($a) {
            $safe = array_intersect_key($a, array_flip(['id', 'label', 'icon']));
            if ($a['check']['enabled'] ?? false) {
                $safe['check'] = ['enabled' => true, 'label' => $a['check']['label']]
                    + (! empty($a['check']['stat_key']) ? ['stat_key' => $a['check']['stat_key']] : [])
                    + (($a['check']['dc_visible'] ?? false) ? ['dc' => $a['check']['dc']] : []);
            }

            return $safe;
        },
            array_filter($actions, fn ($a) => $this->available($object->scene, $a))));
    }

    public function save(User $user, Scene $scene, array $data): array
    {
        return app(SceneTransaction::class)->run($scene, function ($scene) use ($user, $data) {
            Gate::forUser($user)->authorize('update', $scene);
            $data = Validator::make($data, [
                'kind' => 'required|in:token,prop', 'id' => 'required|integer|min:1',
                'actions' => 'present|array|max:8',
                'actions.*' => 'required|array:id,label,icon,result_type,result_target,enabled,check',
                'actions.*.id' => 'required|uuid|distinct', 'actions.*.label' => 'required|string|max:48',
                'actions.*.icon' => 'required|in:'.implode(',', self::ICONS),
                'actions.*.result_type' => 'required|in:handout,cue,nothing',
                'actions.*.result_target' => 'nullable|integer|min:1', 'actions.*.enabled' => 'required|boolean',
                'actions.*.check' => 'sometimes|array:enabled,label,ability_key,stat_key,dc,dc_visible,modifier,retry,success,failure,requires_sight',
                'actions.*.check.enabled' => 'required_with:actions.*.check|boolean',
            ])->validate();
            $object = $this->object($scene, $data['kind'], $data['id']);
            foreach ($data['actions'] as &$action) {
                if ($action['check']['enabled'] ?? false) {
                    $action['check'] = Validator::make($action['check'], [
                        'enabled' => 'required|boolean', 'label' => 'required|string|max:80',
                        'ability_key' => 'nullable|string|max:48|regex:/^[a-zA-Z0-9_-]+$/',
                        'dc' => 'required|integer|min:1|max:100', 'dc_visible' => 'sometimes|boolean', 'requires_sight' => 'sometimes|boolean',
                        'modifier' => 'required_without:stat_key|integer|min:-100|max:100',
                        'stat_key' => 'nullable|string|max:48|regex:/^[a-z][a-z0-9_]*$/',
                        'retry' => 'required|in:once,once_per_player,repeatable',
                        'success' => 'required|array:result_type,result_target', 'failure' => 'required|array:result_type,result_target',
                        'success.result_type' => 'required|in:nothing,handout,cue', 'failure.result_type' => 'required|in:nothing,handout,cue',
                        'success.result_target' => 'nullable|integer|min:1', 'failure.result_target' => 'nullable|integer|min:1',
                    ])->validate();
                    $action['check']['dc_visible'] ??= false;
                    if (! empty($action['check']['stat_key'])) {
                        unset($action['check']['modifier'], $action['check']['ability_key']);
                    }
                    foreach (array_intersect(['dc', 'modifier'], array_keys($action['check'])) as $number) {
                        $action['check'][$number] = (int) $action['check'][$number];
                    }
                    $valid = $this->validResult($scene, $action['check']['success']) && $this->validResult($scene, $action['check']['failure']);
                } else {
                    $valid = $this->validResult($scene, $action);
                }
                abort_unless($valid, 422, 'Цель недоступна. Выберите материал кампании или событие этой сцены.');
                $action['author_id'] = $user->id;
                $action['result_target'] = isset($action['result_target']) ? (string) $action['result_target'] : null;
                $action['enabled'] = (bool) $action['enabled'];
            }
            unset($action);
            $object->update(['interactions' => $data['actions']]);
            $object->setRelation('scene', $scene);

            return $object instanceof Token
                ? ['tokens' => [app(SceneSnapshotBuilder::class)->token($object, true, $user)], '_previousVisibility' => ['tokens' => $object->is_hidden ? [] : [(string) $object->id], 'props' => []]]
                : ['props' => [$object->projection(true)], '_previousVisibility' => ['tokens' => [], 'props' => $object->is_hidden ? [] : [(string) $object->id]]];
        }, 'objects.changed');
    }
}
