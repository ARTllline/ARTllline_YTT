<?php

namespace App\Actions;

use App\Models\Cue;
use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\SceneRegion;
use App\Models\SceneTrigger;
use App\Models\User;
use App\Services\TriggerEvents;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

class TriggerActions
{
    public function execute(User $user, Scene $scene, array $input): array
    {
        return app(SceneTransaction::class)->run($scene, function ($scene) use ($user, $input) {
            Gate::forUser($user)->authorize('update', $scene);
            $action = Validator::make($input, ['action' => 'required|in:save,toggle,reset,delete', 'id' => 'nullable|integer|min:1'])->validate();
            $trigger = empty($action['id']) ? null : SceneTrigger::where('scene_id', $scene->id)->findOrFail($action['id']);
            if ($action['action'] !== 'save') {
                abort_unless($trigger, 422, 'Выберите триггер.');
                if ($action['action'] === 'delete') {
                    $trigger->delete();
                } elseif ($action['action'] === 'reset') {
                    $trigger->update(['fire_count' => 0, 'last_fired_at' => null]);
                } else {
                    $trigger->update(Validator::make($input, ['enabled' => 'required|boolean'])->validate());
                }

                return [];
            }
            $d = Validator::make($input, [
                'name' => 'required|string|max:160', 'eventType' => ['required', Rule::in(TriggerEvents::TYPES)],
                'cueId' => 'required|integer|min:1', 'regionId' => 'nullable|integer|min:1',
                'objectType' => 'nullable|in:token,prop', 'objectId' => 'nullable|integer|min:1',
                'actorFilter' => 'required|in:player,token,any', 'actorTokenId' => 'nullable|integer|min:1',
                'enabled' => 'required|boolean', 'once' => 'required|boolean', 'cooldownMs' => 'required|integer|between:0,300000',
                'minimumRound' => 'required|integer|between:1,9999',
            ])->validate();
            abort_unless(Cue::where('scene_id', $scene->id)->whereKey($d['cueId'])->exists(), 422, 'Выберите событие этой сцены.');
            $region = str_starts_with($d['eventType'], 'region.');
            $interaction = $d['eventType'] === 'object.interact';
            if ($region) {
                abort_unless(! empty($d['regionId']) && SceneRegion::where('scene_id', $scene->id)->whereKey($d['regionId'])->exists(), 422, 'Выберите область этой сцены.');
                if ($d['actorFilter'] === 'token') {
                    abort_unless(! empty($d['actorTokenId']) && $scene->tokens()->whereKey($d['actorTokenId'])->exists(), 422, 'Выберите токен этой сцены.');
                }
            }
            if ($interaction) {
                abort_unless(! empty($d['objectId']) && ! empty($d['objectType']), 422, 'Выберите объект взаимодействия.');
                $q = $d['objectType'] === 'token' ? $scene->tokens() : SceneProp::where('scene_id', $scene->id);
                abort_unless($q->whereKey($d['objectId'])->exists(), 422, 'Выберите объект этой сцены.');
            }
            $data = ['name' => $d['name'], 'event_type' => $d['eventType'], 'cue_id' => $d['cueId'],
                'region_id' => $region ? $d['regionId'] : null, 'actor_filter' => $region ? $d['actorFilter'] : 'player',
                'actor_token_id' => $region && $d['actorFilter'] === 'token' ? $d['actorTokenId'] : null,
                'token_id' => $interaction && $d['objectType'] === 'token' ? $d['objectId'] : null,
                'prop_id' => $interaction && $d['objectType'] === 'prop' ? $d['objectId'] : null,
                'enabled' => $d['enabled'], 'once' => $d['once'], 'cooldown_ms' => $d['cooldownMs'],
                'minimum_round' => $d['eventType'] === 'combat.round' ? $d['minimumRound'] : 1, 'created_by' => $user->id];
            if ($trigger) {
                $trigger->update($data);
            } else {
                abort_if(SceneTrigger::where('scene_id', $scene->id)->count() >= 100, 422, 'В сцене можно создать до 100 триггеров.');
                $trigger = SceneTrigger::create($data + ['scene_id' => $scene->id]);
            }

            return [];
        }, 'trigger.changed');
    }
}
