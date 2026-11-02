<?php

namespace App\Combat;

use App\Models\Combat;
use App\Realtime\CommandContext;
use Illuminate\Support\Facades\DB;

class CombatLog
{
    public function write(?Combat $combat, string $type, array $data, ?int $sceneId = null): void
    {
        $sceneId ??= $combat?->scene_id;
        if (! $sceneId) {
            return;
        }
        // Freeze identity at the outcome, so renaming/deleting a token cannot rewrite history.
        $ids = array_filter([$data['tokenId'] ?? null, $data['targetId'] ?? null, $data['sourceId'] ?? null,
            ($data['result']['target']['kind'] ?? null) === 'token' ? $data['result']['target']['id'] : null,
            ...array_column($data['result']['outcomes'] ?? [], 'tokenId')]);
        if ($ids && ! in_array($type, ['movement.spent', 'action.spent', 'bonus_action.spent', 'reaction.spent', 'attack.roll', 'check.roll', 'save.roll', 'damage'])) {
            $data['names'] = DB::table('tokens')->where('scene_id', $sceneId)->whereIn('id', $ids)->pluck('name', 'id')->all();
        }
        DB::table('combat_events')->insert(['scene_id' => $sceneId, 'combat_id' => $combat?->id, 'turn_sequence' => $combat?->turn_sequence ?? 0, 'type' => $type,
            'data' => json_encode($data, JSON_THROW_ON_ERROR), 'mutation_id' => app(CommandContext::class)->id(), 'created_at' => now()]);
    }
}
