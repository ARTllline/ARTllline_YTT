<?php

namespace App\Actions;

use App\Models\Combat;
use App\Models\Scene;
use App\Models\SceneEncounter;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;

class EncounterCombatActions
{
    public function execute(User $user, Scene $scene, array $input): array
    {
        return app(SceneTransaction::class)->run($scene, function (Scene $scene) use ($user, $input) {
            Gate::forUser($user)->authorize('update', $scene);
            $data = Validator::make($input, [
                'id' => 'required|uuid', 'action' => 'required|in:start,reinforce',
                'expected' => 'required|array', 'expectedCombatId' => 'present|nullable|string',
                'playerTokenIds' => 'sometimes|array|list|max:200', 'playerTokenIds.*' => 'required|string|distinct',
                'tokenIds' => 'sometimes|array|list|min:1|max:200', 'tokenIds.*' => 'required|string|distinct',
            ])->validate();
            $encounter = SceneEncounter::projections($scene, [$data['id']])[0] ?? null;
            abort_unless($encounter, 404);
            $run = DB::table('scene_encounter_runs')->where('encounter_id', $data['id'])->first();
            $engine = app(CombatActions::class);
            // A launch is durable, including after combat end and receipt expiry.
            // Never turn a late launch retry into a new combat or resurrect removed actors.
            if ($data['action'] === 'start' && $run) {
                return ['_combatChanged' => true, '_encounterRunsChanged' => true];
            }
            abort_unless($encounter == $data['expected'], 409, 'Состав столкновения изменился. Проверьте участников.');
            $combat = Combat::where('scene_id', $scene->id)->whereIn('status', ['preparing', 'active'])->first();
            abort_unless(($combat ? (string) $combat->id : null) === $data['expectedCombatId'], 409,
                'Бой изменился. Проверьте текущий бой и подтвердите добавление участников.');

            if ($data['action'] === 'start') {
                $main = $encounter['groups'][0]['tokenIds'];
                abort_unless($main, 422, 'Добавьте основную группу в подготовке.');
                $players = $data['playerTokenIds'] ?? [];
                abort_unless($scene->tokens()->with('character')->whereIn('id', $players)->get()->filter(fn ($token) => $token->kind === 'player_character')->count() === count($players), 422,
                    'Выберите игровые персонажи этой сцены.');
                $ids = array_values(array_unique([...$main, ...$players]));
                $newCombat = $combat === null;
                if ($newCombat) {
                    $engine->apply($user, $scene, 'prepare', []);
                    $combat = Combat::where('scene_id', $scene->id)->where('status', 'preparing')->firstOrFail();
                }
                $result = $engine->apply($user, $scene, 'add', ['combatId' => (string) $combat->id, 'tokenIds' => $ids]);
                // An existing preparing combat stays in its normal initiative lifecycle.
                if ($newCombat) {
                    $result = $engine->apply($user, $scene, 'begin', ['combatId' => (string) $combat->id]);
                }
                DB::table('scene_encounter_runs')->insert(['encounter_id' => $data['id'], 'scene_id' => $scene->id,
                    'combat_id' => $combat->id, 'activated_token_ids' => json_encode($ids)]);

                return array_replace($result, ['_encounterRunsChanged' => true]);
            }

            abort_unless($run && $combat && (int) $run->combat_id === $combat->id, 409, 'Сначала запустите столкновение в текущем бою.');
            $reserveIds = array_merge([], ...array_column(array_slice($encounter['groups'], 1), 'tokenIds'));
            $ids = $data['tokenIds'] ?? [];
            abort_unless($ids && ! array_diff($ids, $reserveIds), 422, 'Выберите участников резервных групп.');
            $activated = json_decode($run->activated_token_ids, true);
            $pending = array_values(array_diff($ids, $activated));
            // Actors removed from Combat remain activated: reinforcement retry never re-adds them.
            $result = $pending ? $engine->apply($user, $scene, 'add', ['combatId' => (string) $combat->id, 'tokenIds' => $pending]) : ['_combatChanged' => true];
            DB::table('scene_encounter_runs')->where('encounter_id', $data['id'])->update([
                'activated_token_ids' => json_encode(array_values(array_unique([...$activated, ...$ids]))),
            ]);

            return array_replace($result, ['_encounterRunsChanged' => true]);
        }, 'encounter.combat');
    }
}
