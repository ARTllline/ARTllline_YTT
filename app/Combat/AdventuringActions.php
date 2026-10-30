<?php

namespace App\Combat;

use App\Actions\CharacterActions;
use App\Actions\SceneTransaction;
use App\Models\Character;
use App\Models\Combat;
use App\Models\Scene;
use App\Models\User;
use App\Realtime\CommandContext;
use App\Services\AbilityGeometry;
use App\Services\CharacterRules;
use App\Services\DamageRoller;
use App\Services\SceneSnapshotBuilder;
use App\Services\TokenCheckStats;
use App\Spells\SpellEffects;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class AdventuringActions
{
    public function authorize(User $user, Scene $scene, array $d): void
    {
        Gate::forUser($user)->authorize('view', $scene);
        if (in_array($d['action'], ['death-save', 'spend-die', 'finish-rest', 'stabilize'])) {
            $token = $scene->tokens()->findOrFail($d['tokenId']);
            abort_unless($scene->campaign->roleFor($user) === 'gm' || (! $token->is_hidden && $token->owner_user_id === $user->id), 403);
        } else {
            Gate::forUser($user)->authorize('update', $scene);
        }
    }

    public function execute(User $user, Scene $scene, array $d): array
    {
        return app(SceneTransaction::class)->run($scene, function ($scene) use ($user, $d) {
            $this->authorize($user, $scene, $d);
            $id = app(CommandContext::class)->id();
            $sort = function (array $value) use (&$sort): array {
                ksort($value);

                return array_map(fn ($v) => is_array($v) ? $sort($v) : $v, $value);
            };
            $hash = hash('sha256', json_encode([$scene->id, $sort($d)], JSON_THROW_ON_ERROR));
            $existing = DB::table('lifecycle_commands')->where('user_id', $user->id)->where('mutation_id', $id)->first();
            if ($existing) {
                abort_unless(hash_equals($existing->fingerprint, $hash), 409, 'UUID уже использован другой командой.');

                return json_decode($existing->result, true, flags: JSON_THROW_ON_ERROR);
            }
            $author = $scene->campaign->members()->wherePivot('role', 'gm')->orderBy('users.id')->firstOrFail();
            $result = $this->change($user, $author, $scene, $d);
            $result += ['charactersChanged' => true, '_combatChanged' => true];
            // Publish only touched creatures; ScenePublisher applies viewer redaction.
            $result['tokens'] = $scene->tokens()->whereIn('id', $result['_tokenIds'] ?? [])->get()->map(fn ($t) => app(SceneSnapshotBuilder::class)->token($t, true, $user))->all();
            unset($result['_tokenIds']);
            DB::table('lifecycle_commands')->insert(['campaign_id' => $scene->campaign_id, 'scene_id' => $scene->id, 'user_id' => $user->id,
                'mutation_id' => $id, 'fingerprint' => $hash, 'result' => json_encode($result, JSON_THROW_ON_ERROR), 'created_at' => now()]);

            return $result;
        }, 'lifecycle.updated');
    }

    private function change(User $user, User $author, Scene $scene, array $d): array
    {
        $action = $d['action'];
        $life = app(LifeCycle::class);
        if (in_array($action, ['short-rest', 'long-rest'])) {
            abort_unless($d['confirmWorldTime'] ?? false, 422, 'GM должен подтвердить длительность, сон и отсутствие прерываний.');
            $ids = $d['characterIds'];
            $characters = $scene->campaign->characters()->whereIn('id', $ids)->orderBy('id')->get();
            abort_unless($characters->count() === count($ids), 422, 'Выберите персонажей этой кампании.');
            $summary = [];
            foreach ($characters as $c) {
                $inCombat = Combat::whereIn('scene_id', $scene->campaign->scenes()->select('id'))->where('status', 'active')->whereHas('combatants.token', fn ($q) => $q->where('character_id', $c->id))->exists();
                abort_if(($inCombat || app(TurnBudget::class)->active($scene->id)) && ! ($d['combatOverride'] ?? false), 422, 'Отдых недоступен во время боя.');
                abort_unless($c->hp >= 1 && (! $life->blocked($c) || $life->state($c)['cause'] === 'knocked_out'), 422, $c->name.': для начала отдыха нужен минимум 1 HP и живой персонаж.');
            }
            $effectChanges = app(RestEffects::class)->elapsed($characters, $action === 'short-rest' ? 3600 : 28800);
            foreach ($characters as $c) {
                if ($life->state($c)['cause'] === 'knocked_out') {
                    $life->save($author, $c, array_replace($life->state($c), ['status' => 'alive']), 'knockout_rest_complete');
                }
                $changes = app(ResourceRecovery::class)->recover($c, $action === 'short-rest' ? 'short_rest' : 'long_rest');
                $changes = [...$changes, ...($effectChanges[$c->id] ?? [])];
                if ($action === 'long-rest') {
                    $baseline = $c->recovery_baseline ?? [];
                    if (isset($baseline['max_hp']) && $baseline['max_hp'] !== $c->max_hp) {
                        $changes[] = 'Max HP '.$c->max_hp.' → '.$baseline['max_hp'];
                        $c->max_hp = $baseline['max_hp'];
                    }
                    if (! empty($baseline['scores'])) {
                        $rules = $c->rules;
                        foreach ($baseline['scores'] as $key => $value) {
                            $rules['scores'][$key] = $value;
                        }
                        $c->rules = $rules;
                        $changes[] = 'Reduced ability scores restored';
                    }
                    $c->recovery_baseline = null;
                    $c->save();
                    if ($c->hp < $c->max_hp) {
                        $changes[] = 'HP '.$c->hp.' → '.$c->max_hp;
                    }
                    if ($c->exhaustion) {
                        $changes[] = 'Exhaustion '.$c->exhaustion.' → '.($c->exhaustion - 1);
                    }
                    $dice = $c->hit_point_dice ?? [];
                    $spent = collect($dice)->contains(fn ($p) => $p['current'] < $p['max']);
                    foreach ($dice as &$pool) {
                        $pool['current'] = $pool['max'];
                    }
                    unset($pool);
                    if ($spent) {
                        $changes[] = 'Hit Point Dice restored';
                    }
                    if ($c->temporary_hp) {
                        $changes[] = 'Temporary HP '.$c->temporary_hp.' → 0';
                    }
                    $c->update(['hp' => $c->max_hp, 'temporary_hp' => 0, 'hit_point_dice' => $dice]);
                    $life->exhaustion($author, $c, max(0, $c->exhaustion - 1));
                    // Sleep incapacitates: concentration ends, unrelated effects/conditions persist.
                    app(SpellEffects::class)->stop($c, 'long_rest_sleep');
                }
                $rest = ['id' => app(CommandContext::class)->id(), 'kind' => $action, 'status' => $action === 'short-rest' ? 'spending' : 'complete',
                    'changes' => $changes, 'rolls' => [], 'confirmedBy' => $user->id, 'combatOverride' => $d['combatOverride'] ?? false];
                $c->update(['rest_state' => $rest]);
                $summary[] = ['characterId' => (string) $c->id, 'name' => $c->name, 'changes' => $changes];
                app(CharacterActions::class)->publish($user, $c, $scene->id);
            }

            return ['summary' => $summary, 'message' => $action === 'short-rest' ? 'Short Rest подтверждён' : 'Long Rest завершён',
                '_tokenIds' => $scene->tokens()->whereIn('character_id', $ids)->pluck('id')->all(), 'override' => $d['combatOverride'] ?? false];
        }
        $token = $scene->tokens()->findOrFail($d['tokenId']);
        $owner = $life->owner($token);
        $result = [];
        if ($action === 'death-save') {
            $result = $life->deathSave($author, $token, $scene->campaign->roleFor($user) === 'gm' && ($d['confirmWorldTime'] ?? false));
        } elseif ($action === 'stabilize') {
            $target = $scene->tokens()->findOrFail($d['targetId']);
            abort_if($target->is_hidden && $scene->campaign->roleFor($user) !== 'gm', 404);
            abort_unless(app(AbilityGeometry::class)->distance($scene, $token, $target) <= 5, 422, 'Подойдите к союзнику в пределах 5 ft.');
            $knocked = $life->state($target)['status'] === 'unconscious' && $life->state($target)['cause'] === 'knocked_out';
            abort_unless(($target->hp === 0 && $life->state($target)['status'] !== 'dead') || $knocked, 422, 'Цель нельзя стабилизировать.');
            app(TurnBudget::class)->spend($token, 'action', $scene->id);
            $p = app(TokenCheckStats::class)->resolve($token, ['stat_key' => 'medicine']);
            $ctx = app(ConditionRules::class)->context($token, 'check', 'normal', null, 0, null, false, 'medicine');
            $roll = app(CombatExecution::class)->roll($p, 10, $ctx, false, $token);
            if ($roll['success']) {
                if ($knocked) {
                    $life->save($author, $target, array_replace($life->state($target), ['status' => 'alive']), 'first_aid');
                } else {
                    $life->stabilize($author, $target);
                }
            }
            $result = ['roll' => $roll, 'provenance' => $p, 'message' => $roll['success'] ? 'Союзник стабилизирован' : 'Стабилизация не удалась'];
            if ($target->character_id) {
                app(CharacterActions::class)->publish($user, $target->fresh()->character, $scene->id);
            }
            $result['_tokenIds'] = [$target->id, $token->id];
        } elseif (in_array($action, ['spend-die', 'finish-rest'])) {
            abort_unless($owner instanceof Character && ($owner->rest_state['status'] ?? '') === 'spending', 422, 'GM должен подтвердить Short Rest.');
            abort_if(app(TurnBudget::class)->active($scene->id), 422, 'Отдых недоступен во время боя.');
            abort_if($life->blocked($owner) || $owner->hp <= 0, 422, 'Персонаж не может продолжить отдых.');
            abort_unless(($owner->rest_state['id'] ?? '') === $d['restId'], 409, 'Этот отдых уже сменился.');
            $rest = $owner->rest_state;
            if ($action === 'finish-rest') {
                $rest['status'] = 'complete';
                $result['message'] = $owner->name.' завершает Short Rest · Hit Point Dice: '.collect($rest['rolls'])->pluck('die')->join(' + ').' · восстановлено '.array_sum(array_column($rest['rolls'], 'recovered')).' HP';
            } else {
                $dice = $owner->hit_point_dice ?? [];
                $index = collect($dice)->search(fn ($p) => $p['die'] === $d['die']);
                abort_if($index === false || $dice[$index]['current'] < 1, 422, 'Hit Point Die недоступен.');
                $rules = app(CharacterRules::class)->state($owner);
                abort_unless($rules, 422, 'GM должен настроить Constitution.');
                $con = app(CharacterRules::class)->abilityModifier($rules['scores']['con']);
                $roll = app(DamageRoller::class)->roll('1'.$d['die']);
                $healing = max(1, $roll['total'] + $con);
                $actual = min($healing, $owner->max_hp - $owner->hp);
                $dice[$index]['current']--;
                $owner->update(['hit_point_dice' => $dice, 'hp' => $owner->hp + $actual]);
                $rest['rolls'][] = ['die' => $d['die'], 'roll' => $roll['total'], 'con' => $con, 'recovered' => $actual];
                $result = ['message' => $owner->name.' · '.$d['die'].' + CON '.$con.' → +'.$actual.' HP', 'healing' => $actual];
            }
            $owner->update(['rest_state' => $rest]);
        } else {
            if ($action === 'stable-recovery') {
                abort_unless(($d['confirmWorldTime'] ?? false) && $life->state($owner)['status'] === 'stable', 422);
                abort_if(app(TurnBudget::class)->active($scene->id), 422);
                $owner->update(['hp' => 1]);
                $life->hpChanged($author, $owner, 0);
            } elseif ($action === 'knock-out') {
                $life->knockOut($author, $token);
            } elseif ($action === 'configure-dice') {
                abort_unless($owner instanceof Character, 422);
                foreach ($d['pools'] as $p) {
                    abort_if($p['current'] > $p['max'], 422);
                }
                $owner->update(['hit_point_dice' => $d['pools']]);
            } elseif ($action === 'reduction') {
                abort_unless($owner instanceof Character, 422);
                $baseline = $owner->recovery_baseline ?? [];
                $baseline['max_hp'] ??= $owner->max_hp;
                $loss = $d['maxHpLoss'] ?? 0;
                abort_if($loss > $owner->max_hp, 422, 'Снижение превышает текущий максимум.');
                $rules = $owner->rules;
                foreach ($d['scoreLoss'] ?? [] as $key => $amount) {
                    abort_unless($rules && $rules['scores'][$key] - $amount >= 1, 422, 'Характеристика должна оставаться не ниже 1.');
                    if ($amount) {
                        $baseline['scores'][$key] ??= $rules['scores'][$key];
                    }
                    $rules['scores'][$key] -= $amount;
                }
                $beforeHp = $owner->hp;
                if (! $owner->lifecycle) {
                    $owner->lifecycle = $life->state($owner);
                }
                $owner->update(['max_hp' => $owner->max_hp - $loss, 'hp' => min($owner->hp, $owner->max_hp - $loss), 'rules' => $rules, 'recovery_baseline' => $baseline]);
                $life->hpChanged($author, $token, $beforeHp);
            } elseif ($action === 'exhaustion') {
                $life->exhaustion($author, $token, $d['level']);
            } elseif ($action === 'stable') {
                $life->stabilize($author, $token);
            } elseif ($action === 'revive') {
                abort_unless($d['hp'] > 0 && $owner->max_hp > 0, 422);
                $owner->update(['hp' => min($owner->max_hp, $d['hp']), 'exhaustion' => max(0, $owner->exhaustion - ($life->state($owner)['status'] === 'dead' ? 1 : 0))]);
                $life->save($author, $token, array_replace($life->state($owner), ['status' => 'alive', 'successes' => 0, 'failures' => 0, 'requiredTurn' => null]), 'gm_revive');
                $life->exhaustion($author, $owner, $owner->exhaustion);
            } elseif ($action === 'reset-saves') {
                abort_unless(in_array($life->state($owner)['status'], ['dying', 'stable']), 422, 'Сброс Death Saves доступен для dying / stable.');
                $life->save($author, $token, array_replace($life->state($owner), ['successes' => 0, 'failures' => 0]), 'gm_reset');
            } elseif ($action === 'npc-outcome') {
                abort_if($owner->kind === 'player_character', 422);
                abort_unless($owner->hp === 0, 422);
                $life->save($author, $token, array_replace($life->state($owner), ['status' => $d['outcome']]), 'gm_npc_outcome');
            }
            $result['message'] = 'GM · '.$owner->name.' · '.$action;
        }
        if ($owner instanceof Character) {
            app(CharacterActions::class)->publish($user, $owner->fresh(), $scene->id);
        }

        return $result + ['_tokenIds' => [$token->id]];
    }
}
