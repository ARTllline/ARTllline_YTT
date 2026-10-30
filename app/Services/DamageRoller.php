<?php

namespace App\Services;

use Illuminate\Validation\ValidationException;

class DamageRoller
{
    public const PATTERN = '/^(?:([1-9]|1[0-9]|20)d(4|6|8|10|12|20)([+-](?:[0-9]|[1-9][0-9]))?|[0-9]|[1-9][0-9])$/';

    public function roll(string $expression, bool $critical = false): array
    {
        if (! preg_match(self::PATTERN, $expression, $parts)) {
            throw ValidationException::withMessages(['damage' => 'Используйте 1–20 кубиков d4/d6/d8/d10/d12/d20 и поправку от −99 до +99.']);
        }
        if (ctype_digit($expression)) {
            return ['expression' => $expression, 'rawDice' => [], 'modifier' => (int) $expression, 'total' => (int) $expression];
        }
        $dice = [];
        for ($i = 0; $i < (int) $parts[1] * ($critical ? 2 : 1); $i++) {
            $dice[] = random_int(1, (int) $parts[2]);
        }
        $modifier = (int) ($parts[3] ?? 0);

        return ['expression' => $expression, 'rawDice' => $dice, 'modifier' => $modifier, 'total' => max(0, array_sum($dice) + $modifier)];
    }
}
