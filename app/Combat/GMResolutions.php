<?php

namespace App\Combat;

use App\Models\AbilityExecution;
use App\Models\Scene;
use App\Models\User;

/** Manual work belongs to the durable cast receipt; coverage remains unchanged. */
class GMResolutions
{
    public function pending(Scene $scene): array
    {
        return AbilityExecution::where('campaign_id', $scene->campaign_id)->where('context->sceneId', (string) $scene->id)
            ->where('result->manualResolution', 'pending')->orderBy('created_at')->get()->map(fn ($e) => $this->present($e))->all();
    }

    public function present(AbilityExecution $e): array
    {
        return ['id' => $e->id, 'characterId' => $e->character_id ? (string) $e->character_id : null,
            'createdAt' => $e->created_at, 'result' => $e->result];
    }

    public function resolve(User $user, Scene $scene, string $id, string $status, string $note): void
    {
        $cast = AbilityExecution::where('campaign_id', $scene->campaign_id)->where('context->sceneId', (string) $scene->id)->findOrFail($id);
        $result = $cast->result;
        abort_unless(($result['manualResolution'] ?? null) === 'pending', 409, 'Этот ручной шаг уже закрыт.');
        $result['manualResolution'] = $status === 'dismissed' ? 'dismissed_by_gm' : 'resolved_by_gm';
        $result['resolution'] = ['status' => $status, 'note' => $note, 'userId' => $user->id, 'resolvedAt' => now()->toIso8601String()];
        $cast->update(['result' => $result]);
        app(CombatLog::class)->write(app(TurnBudget::class)->active($scene->id), 'manual.resolved', ['executionId' => $cast->id, 'abilityName' => $result['abilityName'], 'status' => $status, 'note' => $note, 'userId' => $user->id]);
    }
}
