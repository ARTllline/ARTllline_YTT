<?php

namespace App\Actions;

use App\Models\Campaign;
use App\Models\Scene;
use Closure;
use Illuminate\Support\Facades\DB;

class SceneTransaction
{
    public function run(Scene $scene, Closure $mutation): array
    {
        return DB::transaction(function () use ($scene, $mutation) {
            // Every writer locks campaign then scene, including activation and deletion.
            $campaign = Campaign::whereKey($scene->campaign_id)->lockForUpdate()->firstOrFail();
            $locked = Scene::whereKey($scene->id)->lockForUpdate()->firstOrFail();
            $locked->setRelation('campaign', $campaign);
            $result = $mutation($locked);
            $locked->increment('revision');

            return ['revision' => $locked->revision] + $result;
        }, 3);
    }
}
