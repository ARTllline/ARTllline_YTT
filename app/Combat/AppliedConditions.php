<?php

namespace App\Combat;

use App\Models\Combat;
use App\Models\Token;
use App\Models\TokenCondition;
use App\Models\User;
use App\Services\CharacterCatalog;
use App\Spells\SpellEffects;

class AppliedConditions
{
    public const DURATIONS = ['until_removed', 'until_start_of_source_turn', 'until_end_of_source_turn', 'until_start_of_target_turn', 'until_end_of_target_turn', 'rounds'];

    public function apply(User $author, Token $target, array $effect, ?Token $source = null, ?string $ability = null, string $visibility = 'public'): ?TokenCondition
    {
        $key = $effect['key'];
        $definition = app(CharacterCatalog::class)->entries('conditions')[$key] ?? null;
        abort_unless($definition, 422, 'Состояние недоступно в локальном компендии.');
        $combat = app(TurnBudget::class)->active($target->scene_id);
        if (in_array($key, app(CombatStats::class)->profile($target)['condition_immunities'] ?? [], true)) {
            app(CombatLog::class)->write($combat, 'condition.immune', ['targetId' => (string) $target->id, 'key' => $key]);

            return null;
        }
        $mode = $effect['duration_mode'] ?? 'until_removed';
        if ($key === 'exhaustion') {
            app(LifeCycle::class)->exhaustion($author, $target, min(6, $target->exhaustion + 1));

            return $target->conditions()->where('key', 'exhaustion')->first();
        }
        abort_if($mode !== 'until_removed' && ! $combat, 422, 'Для длительности по ходам начните бой.');
        abort_if(str_contains($mode, 'source_turn') && (! $source || ! $combat->combatants()->where('token_id', $source->id)->exists()), 422, 'Источник длительности должен участвовать в бою.');
        abort_if($mode !== 'until_removed' && ! $combat->combatants()->where('token_id', $target->id)->exists(), 422, 'Цель длительности должна участвовать в бою.');
        $condition = $target->conditions()->where('key', $key)->where('source_token_id', $source?->id)->where('source_ability_id', $ability)->first() ?? new TokenCondition;
        $condition->fill(['token_id' => $target->id, 'key' => $key, 'label' => $definition['name'], 'normalized_label' => strtolower($definition['name']),
            'compendium_entry_id' => $definition['compendium_entry_id'], 'visibility' => $visibility, 'created_by' => $author->id,
            'source_token_id' => $source?->id, 'source_ability_id' => $ability, 'combat_id' => $combat?->id,
            'duration_mode' => $mode, 'remaining_rounds' => $mode === 'rounds' ? ($effect['rounds'] ?? 1) : null,
            'applied_turn_sequence' => $combat?->turn_sequence, 'metadata' => ['source' => 'ability_or_gm']])->save();
        if (in_array($key, ['incapacitated', 'stunned', 'unconscious', 'paralyzed', 'petrified']) && $target->character_id) {
            app(SpellEffects::class)->stop($target->character, 'incapacitated');
        }
        // SRD Unconscious also leaves the target Prone when it ends.
        if ($key === 'unconscious' && ! $target->conditions()->where('key', 'prone')->exists()) {
            $this->apply($author, $target, ['key' => 'prone'], $source, null, $visibility);
        }
        app(CombatLog::class)->write($combat, 'condition.applied', ['targetId' => (string) $target->id, 'conditionId' => (string) $condition->id, 'key' => $key, 'duration' => $mode, 'remainingRounds' => $condition->remaining_rounds, 'sourceTokenId' => $source?->id, 'sourceAbilityId' => $ability]);

        return $condition;
    }

    public function remove(TokenCondition $condition, string $reason = 'gm'): void
    {
        abort_if($reason === 'gm' && ($condition->metadata['source'] ?? '') === 'zero_hp', 422, 'Это Unconscious связано с жизненным циклом. Используйте лечение, стабилизацию или GM revival.');
        if ($condition->key === 'exhaustion') {
            $token = Token::findOrFail($condition->token_id);
            $owner = app(LifeCycle::class)->owner($token);
            $owner->update(['exhaustion' => 0]);
            if ($token->character_id) {
                TokenCondition::whereIn('token_id', $owner->tokens()->select('id'))->where('key', 'exhaustion')->delete();
            }
        }
        $combat = $condition->combat_id ? Combat::find($condition->combat_id) : null;
        app(CombatLog::class)->write($combat, 'condition.removed', ['targetId' => (string) $condition->token_id, 'conditionId' => (string) $condition->id, 'key' => $condition->key, 'reason' => $reason]);
        $condition->delete();
    }

    public function boundary(Combat $combat, int $tokenId, string $phase): void
    {
        foreach (TokenCondition::where('combat_id', $combat->id)->get() as $c) {
            $source = $c->source_token_id === $tokenId;
            $target = $c->token_id === $tokenId;
            $expire = ($source && $c->duration_mode === 'until_'.$phase.'_of_source_turn') || ($target && $c->duration_mode === 'until_'.$phase.'_of_target_turn');
            if ($target && $phase === 'end' && $c->duration_mode === 'rounds' && $c->applied_turn_sequence !== $combat->turn_sequence) {
                $c->remaining_rounds = max(0, $c->remaining_rounds - 1);
                $c->save();
                $expire = $c->remaining_rounds === 0;
            }
            if ($expire) {
                $this->remove($c, 'duration');
            }
        }
    }

    public function finish(Combat $combat): void
    {
        $linked = app(SpellEffects::class)->active()->get()->flatMap(fn ($e) => $e->payload['conditions'] ?? [])->all();
        foreach (TokenCondition::where('combat_id', $combat->id)->whereNotIn('id', $linked)->where('duration_mode', '!=', 'until_removed')->get() as $c) {
            $this->remove($c, 'combat_ended');
        }
    }

    public function removeActor(Combat $combat, int $tokenId): void
    {
        foreach (TokenCondition::where('combat_id', $combat->id)->get() as $c) {
            if ($c->token_id === $tokenId || ($c->source_token_id === $tokenId && str_contains($c->duration_mode, 'source_turn'))) {
                $this->remove($c, 'combatant_removed');
            }
        }
    }
}
