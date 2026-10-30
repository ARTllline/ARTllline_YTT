<?php

namespace App\Combat;

use App\Models\AbilityExecution;
use App\Models\Token;
use App\Models\User;
use Illuminate\Support\Str;

/** Explicit prepared text only. Unknown prose is never executed as rules. */
class NpcConsequences
{
    public function transition(User $user, Token $token, array $before, array $after, string $cause): void
    {
        $triggers = [];
        if ($before['status'] === 'alive' && $after['status'] !== 'alive') {
            $triggers = ['on_defeat'];
            if ($token->hp === 0) {
                $triggers[] = 'on_zero_hp';
            }
        }
        if ($before['status'] !== 'dead' && $after['status'] === 'dead') {
            $triggers[] = 'on_death';
        }
        foreach ($token->combat_profile['lifecycle_consequences'] ?? [] as $index => $effect) {
            if (! in_array($effect['trigger'], $triggers, true)) {
                continue;
            }
            $id = (string) Str::uuid();
            $label = ['on_zero_hp' => 'При 0 HP', 'on_defeat' => 'При поражении', 'on_death' => 'При смерти'][$effect['trigger']];
            $outcome = ['dead' => 'смерть', 'defeated' => 'поражение', 'dying' => 'без сознания', 'unconscious' => 'без сознания', 'stable' => 'стабилен'][$after['status']] ?? $after['status'];
            AbilityExecution::create(['id' => $id, 'campaign_id' => $token->scene->campaign_id, 'character_id' => $token->character_id,
                'token_id' => $token->character_id ? null : $token->id, 'user_id' => $user->id, 'mutation_id' => (string) Str::uuid(),
                'ability_key' => 'lifecycle:'.$index, 'context' => ['sceneId' => (string) $token->scene_id, 'trigger' => $effect['trigger']],
                'result' => ['id' => $id, 'abilityName' => $effect['name'], 'actorName' => $token->name, 'category' => 'utility', 'coverage' => 'MANUAL', 'manualResolution' => 'pending',
                    'roll' => null, 'outcomes' => [], 'success' => true, 'reference' => $effect['reference'] ?? '', 'gmContext' => ['description' => $effect['description'], 'remaining' => $label.' · '.$token->name.' · разрешите подготовленное последствие.', 'activation' => 'lifecycle', 'appliedSummary' => $token->name.': '.$token->hp.' HP · '.$outcome, 'slotSpent' => 0, 'sourceTokenId' => (string) $token->id, 'reference' => $effect['reference'] ?? '',
                        'reasons' => [$effect['trigger'].' · '.$token->name, 'Автоматически: '.$after['status'].'. GM: разрешите подготовленное последствие.', $effect['reference'] ?? '']],
                    'lifecycleTrigger' => $effect['trigger'], 'cause' => $cause], 'created_at' => now()]);
            app(CombatLog::class)->write(app(TurnBudget::class)->active($token->scene_id), 'lifecycle.consequence', ['tokenId' => (string) $token->id, 'abilityName' => $effect['name'], 'executionId' => $id, 'trigger' => $effect['trigger']]);
        }
    }
}
