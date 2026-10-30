<?php

namespace App\Services;

use App\Combat\TurnBudget;
use App\Models\Combat;
use App\Models\Scene;
use App\Models\User;
use App\Spells\SpellEffects;
use App\Support\RequestPerformance;

class CombatView
{
    public function build(Scene $scene, bool $gm, ?User $viewer = null): ?array
    {
        return app(RequestPerformance::class)->measure('combat_dto', fn () => app(SpellEffects::class)->project(fn () => $this->buildMeasured($scene, $gm, $viewer)));
    }

    private function buildMeasured(Scene $scene, bool $gm, ?User $viewer = null): ?array
    {
        $combat = app(SpellEffects::class)->read('combat-view:'.$scene->id, fn () => Combat::where('scene_id', $scene->id)->whereIn('status', ['preparing', 'active'])->with('combatants.token.character.inventory.definition')->first());
        if (! $combat || (! $gm && ($combat->status !== 'active' || $scene->campaign->active_scene_id !== $scene->id))) {
            return null;
        }
        $visible = $combat->combatants->filter(fn ($entry) => $entry->token && ($gm || ! $entry->token->is_hidden));
        $current = $combat->current_combatant_id;

        return ['id' => (string) $combat->id, 'status' => $combat->status, 'round' => $combat->round,
            'currentTurn' => $current === null ? null : ($visible->contains('id', $current)
                ? ['combatantId' => (string) $current] : ['gmHiddenTurn' => true]),
            // Array order conveys only the visible relative order. No original positions/counts leak.
            'combatants' => $visible->values()->map(fn ($entry) => [
                'id' => (string) $entry->id, 'tokenId' => (string) $entry->token_id,
                'initiative' => $entry->initiative === null ? null : (float) $entry->initiative,
                ...(($gm || ($viewer && $entry->token->owner_user_id === $viewer->id)) && $combat->status === 'active' ? ['budget' => app(TurnBudget::class)->status($combat, $entry)] : []),
            ])->all()];
    }
}
