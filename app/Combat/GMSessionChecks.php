<?php

namespace App\Combat;

use App\Models\Scene;
use App\Services\TokenCheckStats;

class GMSessionChecks
{
    public function run(Scene $scene, array $d): array
    {
        $tokens = $scene->tokens()->whereIn('id', $d['tokenIds'])->get();
        abort_unless($tokens->count() === count($d['tokenIds']), 422, 'Выберите участников этой сцены.');
        $outcomes = [];
        foreach ($tokens as $token) {
            $save = str_starts_with($d['stat'], 'save_');
            $p = $save ? app(CombatStats::class)->save($token, substr($d['stat'], 5)) : app(TokenCheckStats::class)->resolve($token, ['stat_key' => $d['stat']]);
            $context = app(ConditionRules::class)->context($token, $save ? 'save' : 'check', $d['rollMode'] ?? 'normal', null, 0, $save ? substr($d['stat'], 5) : null, false, $d['stat']);
            $roll = app(CombatExecution::class)->roll($p, $d['dc'] ?? 0, $context, false, $token, $save ? 'save' : 'check');
            if (! isset($d['dc'])) {
                unset($roll['dc'], $roll['success']);
            }
            $outcomes[] = ['tokenId' => (string) $token->id, 'name' => $token->name, 'roll' => $roll, 'provenance' => $p];
        }
        app(CombatLog::class)->write(app(TurnBudget::class)->active($scene->id), 'gm.check', ['stat' => $d['stat'], 'outcomes' => $outcomes, 'visibility' => $d['visibility'], 'dcVisible' => $d['dcVisible'] ?? false]);
        $feedback = $d['visibility'] === 'public' ? array_map(fn ($o) => ['tokenId' => $o['tokenId'], 'tone' => 'heal', 'text' => strtoupper($d['stat']).': '.$o['roll']['total'].(($d['dcVisible'] ?? false) && isset($d['dc']) ? ' / Сл '.$d['dc'] : '')], $outcomes) : [];

        return ['outcomes' => $outcomes, 'gameplayFeedbacks' => $feedback];
    }
}
