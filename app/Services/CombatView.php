<?php

namespace App\Services;

use App\Models\Combat;
use App\Models\Scene;

class CombatView
{
    public function build(Scene $scene, bool $gm): ?array
    {
        $combat = Combat::where('scene_id', $scene->id)->whereIn('status', ['preparing', 'active'])->with('combatants.token')->first();
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
            ])->all()];
    }
}
