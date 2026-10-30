<?php

namespace App\Combat;

use App\Models\Character;
use App\Models\Token;

/** SRD 5.2.1 p.181. One calculation shared by all D20 contexts. */
class ExhaustionRules
{
    public function parts(Token|Character|null $subject, string $stat = 'd20'): array
    {
        $level = (int) ($subject?->exhaustion ?? 0);

        return $level ? [['source' => 'exhaustion', 'label' => 'Exhaustion '.$level, 'value' => -$level * ($stat === 'speed' ? 5 : 2)]] : [];
    }
}
