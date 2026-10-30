<?php

namespace App\Combat;

use App\Models\Character;
use App\Models\Combat;
use App\Models\Token;
use App\Models\User;
use App\Realtime\CommandContext;
use App\Services\CharacterCatalog;
use App\Services\DamageRoller;
use App\Spells\SpellEffects;

/** Persistent creature lifecycle; callers hold campaign then scene writer locks. */
class LifeCycle
{
    public function owner(Token|Character $s): Token|Character
    {
        return $s instanceof Token && $s->character_id ? $s->character : $s;
    }

    public function policy(Token|Character $s): string
    {
        return $s->combat_profile['zero_hp_policy'] ?? ($s->kind === 'player_character' ? 'death_saves' : 'immediate_death');
    }

    public function state(Token|Character $s): array
    {
        $s = $this->owner($s);

        return ($s->lifecycle ?? []) + ['status' => $s->hp > 0 ? 'alive' : ($this->policy($s) === 'immediate_death' ? 'dead' : 'dying'), 'successes' => 0, 'failures' => 0, 'requiredTurn' => null, 'resolvedTurn' => null, 'cause' => null];
    }

    public function blocked(Token|Character $s): bool
    {
        return $this->state($s)['status'] !== 'alive';
    }

    public function exhaustion(User $user, Token|Character $s, int $level): void
    {
        $owner = $this->owner($s);
        if (! $owner->lifecycle) {
            $owner->update(['lifecycle' => $this->state($owner)]);
        }
        $owner->update(['exhaustion' => $level]);
        $tokens = $owner instanceof Character ? $owner->tokens()->get() : collect([$owner]);
        $definition = app(CharacterCatalog::class)->entries('conditions')['exhaustion'] ?? null;
        foreach ($tokens as $t) {
            $t->conditions()->where('key', 'exhaustion')->delete();
            if ($level && $definition) {
                $t->conditions()->create(['key' => 'exhaustion', 'label' => $definition['name'], 'normalized_label' => strtolower($definition['name']), 'compendium_entry_id' => $definition['compendium_entry_id'], 'visibility' => 'public', 'created_by' => $user->id, 'duration_mode' => 'until_removed', 'metadata' => ['source' => 'persistent_exhaustion', 'level' => $level]]);
            }
        }
        if ($level === 6) {
            $owner->update(['hp' => 0]);
            $this->save($user, $s, array_replace($this->state($owner), ['status' => 'dead']), 'exhaustion');
        }
    }

    public function save(User $user, Token|Character $s, array $state, string $cause, array $detail = []): void
    {
        $owner = $this->owner($s);
        $before = $this->state($owner);
        if ($state['status'] === 'stable' && $before['status'] !== 'stable') {
            $state['recoveryHours'] = app(DamageRoller::class)->roll('1d4')['total'];
        }
        $state['cause'] = $cause;
        $owner->update(['lifecycle' => $state]);
        $tokens = $owner instanceof Character ? $owner->tokens()->with('scene')->get() : collect([$owner]);
        foreach ($tokens as $t) {
            // Only this lifecycle's Unconscious instance is removed on healing.
            if (in_array($state['status'], ['dying', 'stable', 'unconscious'])) {
                if (! $t->conditions()->where('metadata->source', 'zero_hp')->exists()) {
                    $c = app(AppliedConditions::class)->apply($user, $t, ['key' => 'unconscious'], null, 'lifecycle');
                    $c?->update(['combat_id' => null, 'metadata' => ['source' => 'zero_hp']]);
                }
            } else {
                foreach ($t->conditions()->where('metadata->source', 'zero_hp')->get() as $c) {
                    app(AppliedConditions::class)->remove($c, $cause);
                }
            }
            $combat = app(TurnBudget::class)->active($t->scene_id);
            app(CombatLog::class)->write($combat, 'lifecycle.changed', ['tokenId' => (string) $t->id, 'name' => $t->name, 'before' => $before, 'after' => $state, 'cause' => $cause] + $detail);
            $sourceScene = $s instanceof Token ? $s->scene_id : $owner->campaign->active_scene_id;
            if ($owner->kind !== 'player_character' && $t->scene_id === $sourceScene) {
                app(NpcConsequences::class)->transition($user, $t, $before, $state, $cause);
            }
        }
        if ($owner instanceof Character && $state['status'] !== 'alive') {
            app(SpellEffects::class)->stop($owner, $state['status']);
        }
    }

    public function hpChanged(User $user, Token|Character $s, int $beforeHp, int $damage = 0, int $hpDamage = 0, bool $critical = false): void
    {
        $owner = $this->owner($s);
        $state = $this->state($owner);
        if ($state['status'] === 'dead') {
            return;
        }
        if ($owner->hp > 0) {
            if ($state['status'] === 'unconscious' && $state['cause'] === 'knocked_out' && $owner->hp <= $beforeHp) {
                return;
            }
            if ($state['status'] !== 'alive') {
                $this->save($user, $s, array_replace($state, ['status' => 'alive', 'successes' => 0, 'failures' => 0, 'requiredTurn' => null]), 'healing');
            }

            return;
        }
        if ($beforeHp === 0 && $damage === 0 && $owner->max_hp > 0) {
            return;
        }
        $cause = 'zero_hp';
        if ($owner->max_hp <= 0 || ($damage > 0 && (($beforeHp === 0 && $damage >= $owner->max_hp) || ($beforeHp > 0 && $hpDamage - $beforeHp >= $owner->max_hp)))) {
            $state['status'] = 'dead';
            $cause = $owner->max_hp <= 0 ? 'zero_hp_maximum' : 'massive_damage';
        } elseif ($this->policy($owner) === 'immediate_death') {
            $state['status'] = 'dead';
            $cause = 'monster_death';
        } elseif ($this->policy($owner) === 'manual') {
            $state['status'] = 'defeated';
        } elseif ($beforeHp === 0 && $damage > 0) {
            $state['status'] = 'dying';
            $state['failures'] = min(3, $state['failures'] + ($critical ? 2 : 1));
            if ($state['failures'] === 3) {
                $state['status'] = 'dead';
            }
            $cause = 'damage_at_zero';
        } else {
            $state['status'] = 'dying';
        }
        $this->save($user, $s, $state, $cause, ['damage' => $damage, 'hpDamage' => $hpDamage, 'hpBefore' => $beforeHp, 'maxHp' => $owner->max_hp, 'critical' => $critical]);
    }

    public function requireSave(Combat $combat, Token $token): void
    {
        $owner = $this->owner($token);
        $state = $this->state($owner);
        if ($owner->hp === 0 && $state['status'] === 'dying') {
            $state['requiredTurn'] = $combat->id.':'.$combat->turn_sequence;
            $owner->update(['lifecycle' => $state]);
        }
    }

    public function deathSave(User $user, Token $token, bool $manualTurn = false): array
    {
        $combat = app(TurnBudget::class)->active($token->scene_id);
        $state = $this->state($token);
        $turn = $combat ? $combat->id.':'.$combat->turn_sequence : 'gm:'.app(CommandContext::class)->id();
        $ownTurn = $combat && $combat->combatants()->whereKey($combat->current_combatant_id)->where('token_id', $token->id)->exists();
        abort_unless($state['status'] === 'dying' && (($ownTurn && $state['requiredTurn'] === $turn && $state['resolvedTurn'] !== $turn) || (! $combat && $manualTurn)), 422, 'Death Save сейчас не требуется.');
        // Death saves have no ability/proficiency, but are saves (D20 Tests).
        $ctx = ['mode' => 'normal', 'advantage' => [], 'disadvantage' => [], 'automaticFailure' => []];
        $roll = app(CombatExecution::class)->roll(['finalModifier' => array_sum(array_column(app(ExhaustionRules::class)->parts($token), 'value'))], 10, $ctx, false, $token, 'save');
        $state['resolvedTurn'] = $turn;
        if ($roll['natural'] === 20) {
            $roll['success'] = true;
            $this->owner($token)->update(['hp' => 1]);
            $state = array_replace($state, ['status' => 'alive', 'successes' => 0, 'failures' => 0, 'requiredTurn' => null]);
        } elseif ($roll['natural'] === 1) {
            $roll['success'] = false;
            $state['failures'] = min(3, $state['failures'] + 2);
        } else {
            $field = $roll['success'] ? 'successes' : 'failures';
            $state[$field] = min(3, $state[$field] + 1);
        }
        if ($state['failures'] >= 3) {
            $state['status'] = 'dead';
        }
        if ($state['successes'] >= 3) {
            $state = array_replace($state, ['status' => 'stable', 'successes' => 0, 'failures' => 0, 'requiredTurn' => null]);
        }
        $this->save($user, $token, $state, 'death_save', ['roll' => $roll]);

        return ['roll' => $roll, 'lifecycle' => $state, 'message' => $token->name.' · Death Save '.$roll['natural'].' → '.$state['status'].' · '.$state['successes'].' / '.$state['failures']];
    }

    public function stabilize(User $user, Token $t): void
    {
        abort_unless($t->hp === 0 && $this->state($t)['status'] !== 'dead', 422, 'Стабилизация требует живую цель при 0 HP.');
        $this->save($user, $t, array_replace($this->state($t), ['status' => 'stable', 'successes' => 0, 'failures' => 0, 'requiredTurn' => null]), 'stabilized');
    }

    public function knockOut(User $user, Token $t): void
    {
        $owner = $this->owner($t);
        $owner->update(['hp' => 1]);
        $this->save($user, $t, array_replace($this->state($owner), ['status' => 'unconscious', 'successes' => 0, 'failures' => 0, 'requiredTurn' => null]), 'knocked_out');
    }
}
