<?php

namespace App\Combat;

use App\Models\Token;
use App\Services\DamageRoller;

class TypedDamage
{
    public function roll(array $components, bool $critical = false): array
    {
        return array_map(function ($c) use ($critical) {
            $roll = app(DamageRoller::class)->roll($c['dice'], $critical);
            $roll['modifier'] += ($c['flat_bonus'] ?? 0);
            $roll['total'] = max(0, $roll['total'] + ($c['flat_bonus'] ?? 0));

            return ['type' => $c['type'] ?? null, 'roll' => $roll, 'amount' => $roll['total']];
        }, $components);
    }

    public function apply(array $rolled, Token $target, string $saveEffect = 'full'): array
    {
        $groups = [];
        foreach ($rolled as $c) {
            $key = $c['type'] ?? 'untyped';
            $groups[$key] = ($groups[$key] ?? 0) + $c['amount'];
        }
        $profile = app(CombatStats::class)->profile($target);
        $result = [];
        foreach ($groups as $type => $raw) {
            $amount = match ($saveEffect) {
                'negates','none' => 0,'half' => (int) floor($raw / 2),default => $raw
            };
            $adjustments = [];
            if (in_array($type, $profile['immunities'] ?? [], true)) {
                $amount = 0;
                $adjustments[] = 'immunity';
            } else {
                if (in_array($type, $profile['resistances'] ?? [], true)) {
                    $amount = (int) floor($amount / 2);
                    $adjustments[] = 'resistance';
                }
                if (in_array($type, $profile['vulnerabilities'] ?? [], true)) {
                    $amount *= 2;
                    $adjustments[] = 'vulnerability';
                }
            }
            $result[] = ['type' => $type, 'rolled' => $raw, 'saveEffect' => $saveEffect, 'adjustments' => $adjustments, 'amount' => $amount];
        }

        return ['components' => $result, 'total' => array_sum(array_column($result, 'amount'))];
    }
}
