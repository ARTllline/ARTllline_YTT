<?php

namespace App\Jobs;

use App\Events\TabletopEvent;
use App\Models\Scene;
use App\Realtime\ChannelAccess;
use App\Realtime\SafeBroadcast;
use App\Services\SceneLighting;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;

/** At most one pending job per scene; read the latest committed state, never replay old positions. */
class RefreshSceneLighting implements ShouldBeUniqueUntilProcessing, ShouldQueue
{
    use Queueable;

    public int $uniqueFor = 10;

    public int $timeout = 15;

    public int $tries = 1;

    public function __construct(public int $sceneId)
    {
        $this->onConnection('tabletop')->onQueue('lighting')->afterCommit();
    }

    public function uniqueId(): string
    {
        return (string) $this->sceneId;
    }

    public function handle(SceneLighting $lighting, SafeBroadcast $broadcast): void
    {
        $frames = DB::transaction(function () use ($lighting) {
            $scene = Scene::find($this->sceneId);
            if (! $scene) {
                return [];
            }
            $lighting->invalidate($scene);
            $campaign = $scene->campaign;
            $frames = [];
            foreach ($campaign->members()->get() as $member) {
                $gm = $member->pivot->role === 'gm';
                if (! $gm && ($member->pivot->role !== 'player' || $campaign->active_scene_id !== $scene->id)) {
                    continue;
                }
                $render = $lighting->render($scene, $member);
                $frames[] = [
                    $gm ? ChannelAccess::gm($campaign->id, $scene->id) : ChannelAccess::player($campaign->id, $scene->id, $campaign->live_revision, $member->id),
                    ['type' => 'lighting.frame', 'sceneId' => (string) $scene->id,
                        // Exceptionally complex masks use the authorized read endpoint.
                        'revision' => $scene->revision, 'render' => strlen(json_encode($render)) > 100000 ? null : $render],
                ];
            }

            return $frames;
        });
        foreach ($frames as [$channel, $envelope]) {
            $broadcast->send(new TabletopEvent($channel, $envelope));
        }
    }
}
