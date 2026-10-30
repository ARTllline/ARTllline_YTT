<?php

namespace App\Combat;

use App\Items\ItemRules;
use App\Models\Token;

class ConditionRules
{
    public function publicContext(array $ctx): array
    {
        foreach (['advantage', 'disadvantage', 'automaticFailure'] as $key) {
            $ctx[$key] = array_map(fn ($r) => ($r['visibility'] ?? 'public') === 'gm_only' ? ['label' => 'Модификатор ГМ'] : $r, $ctx[$key] ?? []);
        }

        return $ctx;
    }

    public function reasons(?Token $token, array $keys): array
    {
        if (! $token) {
            return [];
        }

        return $token->conditions()->whereIn('key', $keys)->get()->map(fn ($c) => ['conditionId' => (string) $c->id, 'key' => $c->key, 'label' => $c->label, 'visibility' => $c->visibility])->all();
    }

    public function has(Token $token, array $keys): bool
    {
        return (bool) $this->reasons($token, $keys);
    }

    public function inactive(Token $t): bool
    {
        return $this->has($t, ['incapacitated', 'stunned', 'unconscious']);
    }

    public function prone(Token $t): bool
    {
        return $this->has($t, ['prone', 'unconscious']);
    }

    public function speed(Token $t): float
    {
        return $this->has($t, ['restrained', 'unconscious']) ? 0 : app(CombatStats::class)->speed($t);
    }

    public function context(?Token $actor, string $kind, string $requested = 'normal', ?Token $target = null, float $distance = 0, ?string $saveAbility = null, bool $sight = false, ?string $statKey = null): array
    {
        $adv = $requested === 'advantage' ? [['label' => 'Выбранное преимущество', 'visibility' => 'public']] : [];
        $dis = $requested === 'disadvantage' ? [['label' => 'Выбранная помеха', 'visibility' => 'public']] : [];
        if ($kind === 'attack') {
            $dis = [...$dis, ...$this->reasons($actor, ['poisoned', 'prone', 'unconscious', 'restrained', 'blinded'])];
            $adv = [...$adv, ...$this->reasons($target, ['restrained', 'stunned', 'unconscious', 'blinded'])];
            $prone = $this->reasons($target, ['prone', 'unconscious']);
            if ($distance <= 5) {
                $adv = [...$adv, ...$prone];
            } else {
                $dis = [...$dis, ...$prone];
            }
        } elseif ($kind === 'check') {
            $dis = [...$dis, ...$this->reasons($actor, ['poisoned'])];
        } elseif ($kind === 'save' && $saveAbility === 'dex') {
            $dis = [...$dis, ...$this->reasons($actor, ['restrained'])];
        }
        if ($kind === 'check') {
            $dis = [...$dis, ...app(ItemRules::class)->checkReasons($actor, $statKey)];
        }
        $automatic = ($kind === 'save' && in_array($saveAbility, ['str', 'dex'])) ? $this->reasons($actor, ['stunned', 'unconscious']) : [];
        if ($kind === 'check' && $sight) {
            if ($kind === 'check') {
                $dis = [...$dis, ...app(ItemRules::class)->checkReasons($actor, $statKey)];
            }
            $automatic = $this->reasons($actor, ['blinded']);
        }

        return ['mode' => ($adv && $dis) ? 'normal' : ($adv ? 'advantage' : ($dis ? 'disadvantage' : 'normal')),
            'advantage' => $adv, 'disadvantage' => $dis, 'automaticFailure' => $automatic];
    }
}
