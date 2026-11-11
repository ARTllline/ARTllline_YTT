<?php

namespace App\Services;

use App\Models\Scene;
use Illuminate\Support\Facades\DB;

class EncounterRuntime
{
    /** GM-only metadata. Combat and tokens continue to own all gameplay state. */
    public static function projections(Scene $scene): array
    {
        return DB::table('scene_encounter_runs as runs')
            ->join('combats', 'combats.id', '=', 'runs.combat_id')
            ->join('scene_encounters', 'scene_encounters.id', '=', 'runs.encounter_id')
            ->where('runs.scene_id', $scene->id)->orderBy('runs.encounter_id')
            ->get(['runs.*', 'combats.status'])->map(fn ($run) => [
                'encounterId' => $run->encounter_id, 'combatId' => (string) $run->combat_id,
                'status' => $run->status, 'activatedTokenIds' => json_decode($run->activated_token_ids, true),
            ])->all();
    }
}
