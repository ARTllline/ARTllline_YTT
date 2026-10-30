<?php

namespace App\Combat;

use App\Models\Combat;
use App\Models\Combatant;
use App\Models\Token;

class TurnBudget
{
    public function active(int $sceneId): ?Combat
    {
        return Combat::where('scene_id', $sceneId)->where('status', 'active')->first();
    }

    public function status(Combat $combat, Combatant $entry): array
    {
        $t = $entry->token;
        $speed = app(ConditionRules::class)->speed($t);
        $inactive = app(ConditionRules::class)->inactive($t);

        return ['incapacitated' => $inactive, 'ownTurn' => $combat->current_combatant_id === $entry->id, 'action' => $entry->action_available && ! $inactive,
            'bonus_action' => $entry->bonus_available && ! $inactive, 'reaction' => $entry->reaction_available && ! $inactive,
            'movementSpent' => (float) $entry->movement_spent, 'speed' => $speed, 'movementRemaining' => max(0, $speed - $entry->movement_spent), 'unit' => 'ft'];
    }

    public function start(Combat $combat, int $id): void
    {
        $entry = $combat->combatants()->findOrFail($id);
        $combat->increment('turn_sequence');
        app(AppliedConditions::class)->boundary($combat, $entry->token_id, 'start');
        $entry->update(['action_available' => true, 'bonus_available' => true, 'reaction_available' => true, 'movement_spent' => 0]);
        app(CombatLog::class)->write($combat, 'turn.started', ['combatantId' => (string) $entry->id, 'tokenId' => (string) $entry->token_id, 'round' => $combat->round]);
    }

    public function end(Combat $combat): void
    {
        $entry = $combat->combatants()->find($combat->current_combatant_id);
        if ($entry) {
            app(AppliedConditions::class)->boundary($combat, $entry->token_id, 'end');
        }
    }

    public function spend(?Token $actor, string $cost, int $sceneId): void
    {
        if ($actor) {
            abort_if(app(ConditionRules::class)->inactive($actor), 422, 'Персонаж недееспособен и не может действовать.');
        }
        $combat = $this->active($sceneId);
        if (! $combat) {
            return;
        }
        $entry = $actor ? $combat->combatants()->where('token_id', $actor->id)->first() : null;
        abort_unless($entry, 422, 'Добавьте действующий токен в бой.');
        if ($cost === 'free') {
            return;
        }
        abort_if($cost !== 'reaction' && $combat->current_combatant_id !== $entry->id, 422, 'Сейчас ход другого участника.');
        $field = ['action' => 'action_available', 'bonus_action' => 'bonus_available', 'reaction' => 'reaction_available'][$cost];
        abort_unless($entry->$field, 422, match ($cost) {
            'action' => 'Действие уже потрачено.','bonus_action' => 'Бонусное действие уже потрачено.',default => 'Реакция недоступна до начала следующего хода.'
        });
        $entry->update([$field => false]);
        app(CombatLog::class)->write($combat, $cost.'.spent', ['tokenId' => (string) $actor->id]);
    }

    public function move(Token $actor, float $x, float $y): void
    {
        $combat = $this->active($actor->scene_id);
        if (! $combat) {
            return;
        }
        $entry = $combat->combatants()->where('token_id', $actor->id)->first();
        abort_unless($entry && $combat->current_combatant_id === $entry->id, 422, 'Перемещение доступно в свой ход участника боя.');
        $distance = hypot($x - $actor->x, $y - $actor->y) * (float) $actor->scene->distance_per_cell / (float) $actor->scene->grid_size;
        $cost = round($distance * (app(ConditionRules::class)->prone($actor) ? 2 : 1), 4);
        if ($cost <= 0) {
            return;
        }
        $remaining = $this->status($combat, $entry)['movementRemaining'];
        abort_if($cost > $remaining + 0.00005, 422, 'Недостаточно перемещения: осталось '.round($remaining, 2).' ft.');
        $entry->update(['movement_spent' => $entry->movement_spent + $cost]);
        app(CombatLog::class)->write($combat, 'movement.spent', ['tokenId' => (string) $actor->id, 'distance' => $distance, 'spent' => $cost, 'remaining' => max(0, $remaining - $cost)]);
    }

    public function stand(Token $actor): void
    {
        abort_unless(app(ConditionRules::class)->has($actor, ['prone']), 422, 'Токен не сбит с ног.');
        $speed = app(ConditionRules::class)->speed($actor);
        abort_if($speed <= 0, 422, 'При скорости 0 нельзя встать.');
        $combat = $this->active($actor->scene_id);
        if ($combat) {
            $entry = $combat->combatants()->where('token_id', $actor->id)->first();
            abort_unless($entry && $combat->current_combatant_id === $entry->id, 422, 'Встать можно в свой ход.');
            $cost = floor($speed / 2);
            abort_if($this->status($combat, $entry)['movementRemaining'] < $cost, 422, 'Недостаточно перемещения, чтобы встать.');
            $entry->update(['movement_spent' => $entry->movement_spent + $cost]);
            app(CombatLog::class)->write($combat, 'movement.spent', ['tokenId' => (string) $actor->id, 'spent' => $cost, 'reason' => 'stand_up']);
        }
        foreach ($actor->conditions()->where('key', 'prone')->get() as $c) {
            app(AppliedConditions::class)->remove($c, 'stand_up');
        }
    }
}
