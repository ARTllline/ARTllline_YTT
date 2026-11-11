<?php

namespace App\Actions;

use App\Models\Scene;
use App\Models\SceneEncounter;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;

class EncounterActions
{
    public function execute(User $user, Scene $scene, array $input): array
    {
        return app(SceneTransaction::class)->run($scene, function ($scene) use ($user, $input) {
            Gate::forUser($user)->authorize('update', $scene);
            $data = Validator::make($input, ['id' => 'required|uuid', 'expected' => 'present|nullable|array', 'value' => 'present|nullable|array'])->validate();
            $current = SceneEncounter::projections($scene, [$data['id']])[0] ?? null;
            abort_unless($current == $data['expected'], 409, 'Столкновение изменилось. Загружено сохранённое состояние.');
            // A UUID belonging to another scene must never be overwritten or restored here.
            abort_if(! $current && SceneEncounter::whereKey($data['id'])->exists(), 422);
            if ($data['value'] === null) {
                abort_unless($current, 409);
                SceneEncounter::whereKey($data['id'])->delete();

                return ['deletedEncounterId' => $data['id']];
            }
            $value = $this->validateValue($scene, $data['value']);
            abort_if(! $current && SceneEncounter::where('scene_id', $scene->id)->count() >= 50, 422, 'В сцене уже 50 столкновений.');
            SceneEncounter::updateOrCreate(['id' => $data['id']], ['scene_id' => $scene->id, 'name' => $value['name'], 'status' => $value['status'],
                'groups' => array_map(fn ($g) => ['id' => $g['id'], 'name' => $g['name']], $value['groups'])]);
            DB::table('scene_encounter_members')->where('encounter_id', $data['id'])->delete();
            foreach ($value['groups'] as $group) {
                foreach ($group['tokenIds'] as $id) {
                    DB::table('scene_encounter_members')->insert(['encounter_id' => $data['id'], 'token_id' => $id, 'group_id' => $group['id']]);
                }
            }

            return ['encounters' => SceneEncounter::projections($scene, [$data['id']]), 'encounterRuns' => \App\Services\EncounterRuntime::projections($scene)];
        }, 'encounter.changed');
    }

    private function validateValue(Scene $scene, array $value): array
    {
        $data = Validator::make($value, ['name' => 'required|string|max:120', 'status' => 'required|in:draft,ready', 'groups' => 'required|array|list|min:1|max:10',
            'groups.*' => 'required|array:id,name,tokenIds', 'groups.*.id' => 'required|string|max:40|distinct|regex:/^[a-zA-Z0-9-]+$/',
            'groups.*.name' => 'required|string|max:80', 'groups.*.tokenIds' => 'present|array|list|max:200', 'groups.*.tokenIds.*' => 'required|integer|min:1'])->validate();
        abort_unless($data['groups'][0]['id'] === 'main', 422, 'Первая группа должна быть основной.');
        $ids = array_merge(...array_column($data['groups'], 'tokenIds'));
        abort_if(count($ids) > 200 || count(array_unique($ids)) !== count($ids), 422, 'Не более 200 уникальных участников в столкновении.');
        abort_unless($scene->tokens()->whereIn('id', $ids)->count() === count($ids), 422, 'Участники должны находиться в этой сцене.');
        abort_if($data['status'] === 'ready' && ! $data['groups'][0]['tokenIds'], 422, 'Добавьте участников в основную группу.');

        return $data;
    }

    /** Called inside TokenActions' existing placement transaction, before publishing. */
    public function attach(Scene $scene, string $id, string $group, int $token): array
    {
        $encounter = SceneEncounter::where('scene_id', $scene->id)->findOrFail($id);
        abort_unless(collect($encounter->groups)->contains('id', $group), 409, 'Группа удалена. Выберите группу заново.');
        abort_if(DB::table('scene_encounter_members')->where('encounter_id', $id)->count() >= 200, 422, 'В столкновении уже 200 участников.');
        DB::table('scene_encounter_members')->insert(['encounter_id' => $id, 'token_id' => $token, 'group_id' => $group]);

        return ['encounters' => SceneEncounter::projections($scene, [$id])];
    }
}
