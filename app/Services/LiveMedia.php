<?php

namespace App\Services;

use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Realtime\SafeBroadcast;
use Illuminate\Support\Facades\DB;

/** Small current-state projection, entirely separate from scene revision and SFX delivery. */
class LiveMedia
{
    public function read(Campaign $campaign): array
    {
        $row = DB::table('live_media')->where('campaign_id', $campaign->id)->first();
        $state = $row ? json_decode($row->state, true) : [
            'music' => null, 'ambient' => [], 'effects' => [], 'volumes' => ['music' => 0.7, 'ambient' => 0.6, 'sfx' => 0.8], 'fade' => 1000,
        ];
        $state['music'] = $this->current($state['music']) ? $state['music'] : null;
        $state['ambient'] = array_values(array_filter($state['ambient'], $this->current(...)));

        return $state + ['revision' => (int) ($row?->revision ?? 0), 'sceneId' => $campaign->active_scene_id ? (string) $campaign->active_scene_id : null,
            'epoch' => $campaign->live_revision, 'serverNow' => now()->getTimestampMs()];
    }

    public function current(?array $track): bool
    {
        return $track && ($track['paused'] || $track['loop'] || now()->getTimestampMs() - $track['startedAt'] < $track['duration']);
    }

    public function track(Asset $asset, array $data, string $id): array
    {
        return ['id' => $id, 'assetId' => (string) $asset->id, 'name' => $asset->name, 'url' => '/api/assets/'.$asset->id,
            'duration' => (int) $asset->duration_ms, 'volume' => (float) $data['volume'], 'loop' => (bool) ($data['loop'] ?? false),
            'fade' => $data['fade'] ?? 0, 'startedAt' => now()->getTimestampMs(), 'paused' => false, 'position' => 0];
    }

    /** Writer lock on campaign is required, including for scene activation. */
    public function save(Campaign $campaign, array $state): array
    {
        $revision = $state['revision'] + 1;
        unset($state['revision'], $state['sceneId'], $state['epoch'], $state['serverNow']);
        DB::table('live_media')->updateOrInsert(['campaign_id' => $campaign->id], ['revision' => $revision, 'state' => json_encode($state, JSON_THROW_ON_ERROR)]);
        $snapshot = $this->read($campaign);
        $this->publish($campaign, ['type' => 'media.state', 'state' => $snapshot]);

        return $snapshot;
    }

    public function sceneChanged(Campaign $campaign): void
    {
        $state = $this->read($campaign);
        $state['ambient'] = [];
        $state['effects'] = [];
        $state['fade'] = 0;
        // Old scene's SFX/transition grants cannot authorize new requests.
        DB::table('audio_grants')->where('campaign_id', $campaign->id)->delete();
        $this->save($campaign, $state);
    }

    public function grant(Campaign $campaign, string $assetId, int $milliseconds): void
    {
        $expires = now()->addMilliseconds($milliseconds);
        $query = DB::table('audio_grants')->where('campaign_id', $campaign->id)->where('asset_id', $assetId);
        $old = $query->value('expires_at');
        if (! $old || $expires->greaterThan($old)) {
            DB::table('audio_grants')->updateOrInsert(['campaign_id' => $campaign->id, 'asset_id' => $assetId], ['expires_at' => $expires]);
        }
    }

    public function authorized(Campaign $campaign, Asset $asset): bool
    {
        $state = $this->read($campaign);
        foreach (array_filter([$state['music'], ...$state['ambient']]) as $track) {
            if ($track['assetId'] === (string) $asset->id) {
                return true;
            }
        }

        return DB::table('audio_grants')->where('campaign_id', $campaign->id)->where('asset_id', $asset->id)->where('expires_at', '>', now())->exists();
    }

    public function publish(Campaign $campaign, array $payload): void
    {
        $channels = $campaign->members()->get()->map(fn ($user) => 'campaign.'.$campaign->id.'.media.user.'.$user->id)->all();
        if ($channels) {
            $event = new TabletopEvent(array_shift($channels), $payload, null, $channels);
            DB::afterCommit(fn () => app(SafeBroadcast::class)->send($event));
        }
    }
}
