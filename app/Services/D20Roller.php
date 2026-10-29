<?php

namespace App\Services;

class D20Roller
{
    public function roll(): int
    {
        return random_int(1, 20);
    }
}
