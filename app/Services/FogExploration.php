<?php

namespace App\Services;

use App\Models\Scene;
use App\Models\User;
use App\Support\RequestPerformance;
use Illuminate\Support\Facades\DB;

/** Territory only. Writers hold campaign -> scene locks, including snapshot hydration. */
class FogExploration
{
    private function dimensions(Scene $scene): array
    {
        $cell = max(4, (int) ceil(max($scene->width, $scene->height) / 512));

        return [(int) ceil($scene->width / $cell), (int) ceil($scene->height / $cell), $cell];
    }

    public function record(Scene $scene, ?iterable $players = null): void
    {
        if (! app(RequestPerformance::class)->exploration) {
            return;
        }
        app(RequestPerformance::class)->measure('fog_record', fn () => $this->recordMeasured($scene, $players));
    }

    private function recordMeasured(Scene $scene, ?iterable $players): void
    {
        if (! $scene->vision_enabled || $scene->campaign->active_scene_id !== $scene->id) {
            return;
        }
        [$width, $height, $cell] = $this->dimensions($scene);
        $party = str_repeat("\0", (int) ceil($width * $height / 8));
        $vision = app(SceneVisibility::class);
        foreach ($players ?? $scene->campaign->members()->wherePivot('role', 'player')->get() as $player) {
            $bits = $vision->currentBits($scene, $player, $width, $height, $cell);
            $this->remember($scene, 'player:'.$player->id, $bits);
            $party |= $bits;
        }
        if ($scene->fog_memory_policy === 'party') {
            $this->remember($scene, 'party', $party);
        }
    }

    private function remember(Scene $scene, string $scope, string $current): void
    {
        [$width, $height, $cell] = $this->dimensions($scene);
        $row = DB::table('fog_memories')->where('scene_id', $scene->id)->where('scope', $scope)->first();
        $bits = $row && [$row->width, $row->height, $row->cell_size] === [$width, $height, $cell]
            ? base64_decode($row->bits) : str_repeat("\0", (int) ceil($width * $height / 8));
        $union = $bits | $current;
        if (! $row || $union !== $bits || [$row->width, $row->height, $row->cell_size] !== [$width, $height, $cell]) {
            DB::table('fog_memories')->updateOrInsert(['scene_id' => $scene->id, 'scope' => $scope],
                ['width' => $width, 'height' => $height, 'cell_size' => $cell, 'bits' => base64_encode($union)]);
        }
    }

    public function projection(Scene $scene, User $user): array
    {
        [$width, $height, $cell] = $this->dimensions($scene);
        $scope = $scene->fog_memory_policy === 'party' ? 'party' : 'player:'.$user->id;
        $row = DB::table('fog_memories')->where('scene_id', $scene->id)->where('scope', $scope)->first();
        $bits = $row && [$row->width, $row->height, $row->cell_size] === [$width, $height, $cell] ? $row->bits : '';

        return ['policy' => $scene->fog_memory_policy, 'width' => $width, 'height' => $height, 'cellSize' => $cell, 'bits' => $bits];
    }
}
