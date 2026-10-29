<?php

namespace App\Services;

/** The shared Task 16 check algorithm. Presentation never supplies dice or totals. */
class CheckRoller
{
    public function roll(int $modifier, int $dc, string $mode = 'normal'): array
    {
        $dice = [app(D20Roller::class)->roll()];
        if ($mode !== 'normal') {
            $dice[] = app(D20Roller::class)->roll();
        }
        $natural = $mode === 'advantage' ? max($dice) : min($dice);

        return ['rawDice' => $dice, 'natural' => $natural, 'modifier' => $modifier,
            'total' => $natural + $modifier, 'dc' => $dc, 'success' => $natural + $modifier >= $dc,
            'rollMode' => $mode, 'selectedDie' => array_search($natural, $dice, true)];
    }
}
