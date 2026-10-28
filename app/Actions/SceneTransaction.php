<?php

namespace App\Actions;

use App\Models\Campaign;
use App\Models\Scene;
use App\Realtime\CommandContext;
use App\Realtime\ScenePublisher;
use App\Services\CombatView;
use Closure;
use Illuminate\Support\Facades\DB;

class SceneTransaction
{
    public function run(Scene $scene, Closure $mutation, string $type = 'scene.updated'): array
    {
        return DB::transaction(function () use ($scene, $mutation, $type) {
            // Every writer locks campaign then scene, including activation and deletion.
            $campaign = Campaign::whereKey($scene->campaign_id)->lockForUpdate()->firstOrFail();
            $locked = Scene::whereKey($scene->id)->lockForUpdate()->firstOrFail();
            $locked->setRelation('campaign', $campaign);
            $result = $mutation($locked);
            if ($result['_combatChanged'] ?? false) {
                $result['combat'] = app(CombatView::class)->build($locked, true);
            }
            unset($result['_combatChanged']);
            $wasVisible = $result['_wasVisible'] ?? false;
            unset($result['_wasVisible']);
            $locked->increment('revision');
            $result = ['revision' => $locked->revision, 'mutationId' => app(CommandContext::class)->id()] + $result;
            $locked->setRelation('campaign', $campaign);
            app(ScenePublisher::class)->changed($locked, $type, $result, $wasVisible);

            return $result;
        }, 3);
    }
}
