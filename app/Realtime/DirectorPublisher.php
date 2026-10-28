<?php

namespace App\Realtime;

use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\CueRun;
use Illuminate\Support\Facades\DB;

class DirectorPublisher
{
    /** Called with the campaign writer lock held. No definitions or target identities. */
    public function send(Campaign $campaign, CueRun $run, string $eventId, string $action, array $config = []): void
    {
        if ((string) $campaign->active_scene_id !== (string) $run->scene_id || $campaign->live_revision !== $run->epoch) {
            return;
        }
        $channels = $campaign->members()->wherePivot('role', 'player')->get()->map(fn ($user) => ChannelAccess::player($campaign->id, $run->scene_id, $run->epoch, $user->id))->all();
        if (! $channels) {
            return;
        }
        $event = new TabletopEvent(array_shift($channels), ['type' => 'director.action',
            'sceneId' => (string) $run->scene_id, 'epoch' => $run->epoch, 'runId' => $run->id,
            'eventId' => $eventId, 'sequence' => $run->position, 'action' => $action, 'config' => $config,
            'sentAt' => now()->getTimestampMs(), 'expiresAt' => now()->addSeconds(70)->getTimestampMs()], null, $channels);
        DB::afterCommit(fn () => app(SafeBroadcast::class)->send($event));
    }
}
