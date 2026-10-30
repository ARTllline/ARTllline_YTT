<?php

namespace App\Combat;

use App\Models\Combat;
use App\Realtime\CommandContext;
use Illuminate\Support\Facades\DB;

class CombatLog
{
    public function write(?Combat $combat, string $type, array $data): void
    {
        if (! $combat) {
            return;
        }
        DB::table('combat_events')->insert(['combat_id' => $combat->id, 'turn_sequence' => $combat->turn_sequence, 'type' => $type,
            'data' => json_encode($data, JSON_THROW_ON_ERROR), 'mutation_id' => app(CommandContext::class)->id(), 'created_at' => now()]);
    }
}
