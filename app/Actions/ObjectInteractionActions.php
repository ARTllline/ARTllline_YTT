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
            && ($action['result_type'] === 'handout'
                ? Handout::where('campaign_id', $scene->campaign_id)->whereKey($action['result_target'])->exists()
                : Cue::where('scene_id', $scene->id)->whereKey($action['result_target'])->exists());
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

        return array_values(array_map(fn ($a) => array_intersect_key($a, array_flip(['id', 'label', 'icon'])),
            array_filter($actions, fn ($a) => $this->available($object->scene, $a))));
    }

    public function save(User $user, Scene $scene, array $data): array
    {
        return app(SceneTransaction::class)->run($scene, function ($scene) use ($user, $data) {
            Gate::forUser($user)->authorize('update', $scene);
            $data = Validator::make($data, [
                'kind' => 'required|in:token,prop', 'id' => 'required|integer|min:1',
                'actions' => 'present|array|max:8',
                'actions.*' => 'required|array:id,label,icon,result_type,result_target,enabled',
                'actions.*.id' => 'required|uuid|distinct', 'actions.*.label' => 'required|string|max:48',
                'actions.*.icon' => 'required|in:'.implode(',', self::ICONS),
                'actions.*.result_type' => 'required|in:handout,cue',
                'actions.*.result_target' => 'required|integer|min:1', 'actions.*.enabled' => 'required|boolean',
            ])->validate();
            $object = $this->object($scene, $data['kind'], $data['id']);
            foreach ($data['actions'] as &$action) {
                $valid = $action['result_type'] === 'handout'
                    ? Handout::where('campaign_id', $scene->campaign_id)->whereKey($action['result_target'])->exists()
                    : Cue::where('scene_id', $scene->id)->whereKey($action['result_target'])->exists();
                abort_unless($valid, 422, 'Цель недоступна. Выберите материал кампании или событие этой сцены.');
                $action['author_id'] = $user->id;
                $action['result_target'] = (string) $action['result_target'];
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
