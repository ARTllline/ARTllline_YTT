<?php

namespace App\Spells;

use App\Actions\CharacterActions;
use App\Actions\SceneTransaction;
use App\Combat\AppliedConditions;
use App\Combat\CombatExecution;
use App\Combat\CombatLog;
use App\Combat\CombatStats;
use App\Combat\ConditionRules;
use App\Combat\TurnBudget;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\Combat;
use App\Models\Scene;
use App\Models\SpellEffect;
use App\Models\Token;
use App\Models\TokenCondition;
use App\Models\User;
use App\Services\DamageRoller;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SpellEffects
{
    private bool $projecting = false;

    private array $projectionEffects = [];

    private array $projectionTokens = [];

    /** Reuse reads only while assembling one immutable DTO, never across mutations. */
    public function project(callable $read): mixed
    {
        if ($this->projecting) {
            return $read();
        }
        $this->projecting = true;
        try {
            return $read();
        } finally {
            $this->projecting = false;
            $this->projectionEffects = [];
            $this->projectionTokens = [];
        }
    }

    private function campaignEffects(int $campaignId): array
    {
        $load = fn () => $this->active()->whereIn('scene_id', Scene::where('campaign_id', $campaignId)->select('id'))->get()->all();

        return $this->projecting ? ($this->projectionEffects[$campaignId] ??= $load()) : $load();
    }

    private function tokenIds(Token|Character $subject): array
    {
        if ($subject instanceof Token) {
            return [(string) $subject->id];
        }
        $load = fn () => $subject->tokens()->pluck('id')->map(fn ($id) => (string) $id)->all();

        return $this->projecting ? ($this->projectionTokens[$subject->id] ??= $load()) : $load();
    }

    public function active()
    {
        return SpellEffect::whereNull('ended_at')->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()));
    }

    public function forSubject(Token|Character $subject): array
    {
        $campaignId = $subject instanceof Character ? $subject->campaign_id : $subject->scene->campaign_id;
        $effects = $this->campaignEffects($campaignId);
        if (! $effects) {
            return [];
        }
        $ids = $this->tokenIds($subject);

        return array_values(array_filter($effects, fn ($e) => (bool) array_intersect($ids, $e->targets)));
    }

    public function flat(Token|Character $subject, string $key): array
    {
        $parts = [];
        $bySpell = [];
        foreach ($this->forSubject($subject) as $e) {
            foreach ($e->payload['effects'] ?? [] as $node) {
                $ids = $this->tokenIds($subject);
                if (isset($node['_targets']) && ! array_intersect($ids, $node['_targets'])) {
                    continue;
                }
                if ($node['type'] !== 'modifier' || $node['key'] !== $key || ! empty($node['dice'])) {
                    continue;
                }
                // Same named spell effects do not stack; use the strongest applicable bonus.
                $v = (int) ($node['value'] ?? 0);
                if (! isset($bySpell[$e->name]) || abs($v) > abs($bySpell[$e->name]['value'])) {
                    $bySpell[$e->name] = ['source' => 'spell_effect', 'label' => $e->name, 'value' => $v, 'effectId' => $e->id];
                }
            }
        }

        return array_values($bySpell);
    }

    public function rollBonus(?Token $subject, string $kind): array
    {
        if (! $subject) {
            return [];
        }
        $rolled = [];
        $seen = [];
        foreach ($this->forSubject($subject) as $e) {
            foreach ($e->payload['effects'] ?? [] as $node) {
                if (isset($node['_targets']) && ! in_array((string) $subject->id, $node['_targets'])) {
                    continue;
                }
                if ($node['type'] !== 'modifier' || $node['key'] !== $kind || (empty($node['dice']) && empty($node['value'])) || isset($seen[$e->name])) {
                    continue;
                }
                $seen[$e->name] = true;
                $rolled[] = ['source' => 'spell_effect', 'label' => $e->name, 'effectId' => $e->id, 'roll' => ! empty($node['dice']) ? app(DamageRoller::class)->roll($node['dice']) : ['expression' => (string) $node['value'], 'rawDice' => [], 'modifier' => $node['value'], 'total' => $node['value']]];
            }
        }

        return $rolled;
    }

    public function stop(Character $c, string $cause): void
    {
        foreach ($this->active()->where('character_id', $c->id)->where('concentration', true)->get() as $e) {
            $this->end($e, $cause);
        }
    }

    public function start(User $author, Character $c, ?Token $actor, Scene $scene, array $a, array $victims, array $resolved): ?SpellEffect
    {
        $s = $a['spell'];
        $duration = $s['duration'] ?? ['mode' => 'instantaneous', 'amount' => 0];
        $nodes = $s['effects'] ?? [];
        $conditionIds = [];
        foreach ($resolved['outcomes'] as $outcome) {
            $conditionIds = [...$conditionIds, ...($outcome['conditionsApplied'] ?? [])];
        }
        foreach ($nodes as &$node) {
            $node['_targets'] = [];
            foreach ($victims as $target) {
                $outcome = collect($resolved['outcomes'])->firstWhere('tokenId', (string) $target->id);
                $when = $node['when'];
                $apply = $when === 'always' || ($when === 'hit' && $resolved['success'] && empty($a['save'])) || ($when === 'failed_save' && isset($outcome['save']) && ! $outcome['save']['success']) || ($when === 'successful_save' && ($outcome['save']['success'] ?? false));
                if (! $apply) {
                    continue;
                }
                $node['_targets'][] = (string) $target->id;
                if ($node['type'] === 'temporary_hp') {
                    $value = isset($node['dice']) ? app(DamageRoller::class)->roll($node['dice'])['total'] : ($node['value'] ?? 0);
                    $owner = $target->character_id ? $target->character : $target;
                    $owner->update(['temporary_hp' => max($owner->temporary_hp ?? 0, $value)]);
                }
                if ($node['type'] === 'remove_condition') {
                    $key = isset($node['choices']) ? ($a['_effectChoice'] ?? null) : ($node['key'] ?? null);
                    abort_unless($key && (! isset($node['choices']) || in_array($key, $node['choices'])), 422, 'Выберите состояние для снятия.');
                    foreach ($target->conditions()->where('key', $key)->get() as $cond) {
                        app(AppliedConditions::class)->remove($cond, 'spell');
                    }
                }
            }
        } unset($node);
        if ($duration['mode'] === 'instantaneous' && ! $s['concentration'] && ! $conditionIds && ! array_filter($nodes, fn ($n) => $n['type'] === 'modifier')) {
            return null;
        }
        $combat = app(TurnBudget::class)->active($scene->id);
        $seconds = $duration['mode'] === 'seconds' ? $duration['amount'] : ($duration['mode'] === 'rounds' ? $duration['amount'] * 6 : ($duration['mode'] === 'source_start' ? 6 : null));
        $rounds = $duration['mode'] === 'rounds' ? $duration['amount'] : ($duration['mode'] === 'seconds' && $duration['amount'] <= 600 ? (int) ceil($duration['amount'] / 6) : null);
        $effect = SpellEffect::create(['id' => (string) Str::uuid(), 'scene_id' => $scene->id, 'character_id' => $c->id, 'source_token_id' => $actor?->id, 'ability_id' => $a['id'], 'name' => $a['name'], 'concentration' => $s['concentration'], 'targets' => array_map(fn ($t) => (string) $t->id, $victims),
            'payload' => ['effects' => array_values(array_filter($nodes, fn ($n) => ! isset($n['_targets']) || $n['_targets'])), 'conditions' => $conditionIds, 'duration' => $duration, 'combat_id' => $combat?->id, 'manual' => ($s['coverage'] ?? '') !== 'FULL'], 'expires_at' => (! $combat || $rounds === null) && $seconds ? now()->addSeconds($seconds) : null,
            'remaining_rounds' => $combat ? ($duration['mode'] === 'source_start' ? 1 : $rounds) : null, 'started_sequence' => $combat?->turn_sequence]);
        $this->publish($effect);

        return $effect;
    }

    public function end(SpellEffect $e, string $reason): void
    {
        if ($e->ended_at) {
            return;
        }
        foreach (TokenCondition::whereIn('id', $e->payload['conditions'] ?? [])->get() as $condition) {
            app(AppliedConditions::class)->remove($condition, 'spell_'.$reason);
        }
        $e->update(['ended_at' => now(), 'end_reason' => $reason]);
        app(CombatLog::class)->write(app(TurnBudget::class)->active($e->scene_id), 'spell.effect.ended', ['effectId' => $e->id, 'spell' => $e->name, 'cause' => $reason]);
        $this->publish($e);
    }

    private function publish(SpellEffect $e): void
    {
        $scene = Scene::find($e->scene_id);
        if (! $scene) {
            return;
        }
        $author = $scene->campaign->members()->wherePivot('role', 'gm')->first();
        if (! $author) {
            return;
        }
        foreach (Character::where('id', $e->character_id)->orWhereIn('id', Token::whereIn('id', $e->targets)->whereNotNull('character_id')->select('character_id'))->get() as $character) {
            app(CharacterActions::class)->publish($author, $character, $scene->id);
        }
        app(SceneTransaction::class)->run($scene, fn ($locked) => ['charactersChanged' => true, '_combatChanged' => true, 'tokens' => $locked->tokens()->get()->map(fn ($t) => app(SceneSnapshotBuilder::class)->token($t, true, $author))->all()], 'objects.changed');
    }

    public function damage(User $author, Token $target, int $damage): void
    {
        if (! $target->character_id || $damage <= 0) {
            return;
        }
        $effects = $this->active()->where('character_id', $target->character_id)->where('concentration', true)->get();
        if ($effects->isEmpty()) {
            return;
        }
        if ($target->fresh()->hp <= 0 || app(ConditionRules::class)->inactive($target)) {
            $this->stop($target->character, 'incapacitated_or_zero_hp');

            return;
        }
        $dc = min(30, max(10, (int) floor($damage / 2)));
        $p = app(CombatStats::class)->save($target, 'con');
        $ctx = app(ConditionRules::class)->context($target, 'save', 'normal', null, 0, 'con');
        $roll = app(CombatExecution::class)->roll($p, $dc, $ctx, false, $target, 'save');
        app(CombatLog::class)->write(app(TurnBudget::class)->active($target->scene_id), 'concentration.save', ['targetId' => (string) $target->id, 'spell' => $effects[0]->name, 'effectId' => $effects[0]->id, 'damage' => $damage, 'dc' => $dc, 'roll' => $roll, 'provenance' => $p, 'cause' => 'damage']);
        if (! $roll['success']) {
            $this->stop($target->character, 'damage_save_failed');
        }
    }

    public function boundary(Combat $combat, int $tokenId): void
    {
        foreach ($this->active()->where('scene_id', $combat->scene_id)->where('source_token_id', $tokenId)->get() as $e) {
            if ($e->remaining_rounds === null || $e->started_sequence === $combat->turn_sequence) {
                continue;
            }
            $e->decrement('remaining_rounds');
            if ($e->remaining_rounds <= 0) {
                $this->end($e, 'duration');
            }
        }
    }

    public function finish(Combat $combat): void
    {
        // Combat ending does not restore slots or arbitrarily end long-lived spells.
        foreach ($this->active()->where('scene_id', $combat->scene_id)->whereNotNull('remaining_rounds')->get() as $e) {
            $e->update(['expires_at' => now()->addSeconds(max(1, $e->remaining_rounds) * 6), 'remaining_rounds' => null]);
        }
    }

    public function expire(?Scene $scene = null): int
    {
        $count = 0;
        foreach (SpellEffect::whereNull('ended_at')->where('expires_at', '<=', now())->when($scene, fn ($q) => $q->where('scene_id', $scene->id))->get() as $effect) {
            DB::transaction(function () use ($effect, &$count) {
                $campaignId = Scene::whereKey($effect->scene_id)->value('campaign_id');
                if (! $campaignId) {
                    return;
                }
                Campaign::whereKey($campaignId)->lockForUpdate()->firstOrFail();
                $locked = SpellEffect::whereKey($effect->id)->lockForUpdate()->first();
                if ($locked && ! $locked->ended_at) {
                    $this->end($locked, 'duration');
                    $count++;
                }
            }, 3);
        }

        return $count;
    }

    public function projection(Character $c): array
    {
        return $this->active()->where('character_id', $c->id)->get()->map(fn ($e) => ['id' => $e->id, 'name' => $e->name, 'concentration' => $e->concentration, 'remainingRounds' => $e->remaining_rounds, 'expiresAt' => $e->expires_at?->toIso8601String(), 'startedAt' => $e->created_at->toIso8601String()])->all();
    }
}
