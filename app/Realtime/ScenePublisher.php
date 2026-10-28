<?php

namespace App\Realtime;

use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\Scene;
use App\Models\Token;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Support\Facades\DB;

class ScenePublisher
{
    public function __construct(private SceneSnapshotBuilder $snapshots, private SafeBroadcast $broadcast, private CommandContext $context) {}

    /** Materialize recipient-safe payloads while campaign + scene locks are held. */
    public function changed(Scene $scene, string $type, array $result, bool $wasVisible): void
    {
        $members = $scene->campaign->members()->get();
        $token = isset($result['token']) ? $scene->tokens()->with('imageAsset')->find($result['token']['id']) : null;
        $base = ['type' => $type, 'sceneId' => (string) $scene->id, 'revision' => $scene->revision, 'mutationId' => $this->context->id()];
        if ($this->context->dragSessionId) {
            $base['dragSessionId'] = $this->context->dragSessionId;
        }
        $gm = $members->first(fn ($member) => $member->pivot->role === 'gm');
        if ($gm) {
            $payload = $result;
            unset($payload['revision'], $payload['mutationId']);
            if ($token) {
                $payload['token'] = $this->snapshots->token($token, true, $gm);
            }
            $this->schedule(ChannelAccess::gm($scene->campaign_id, $scene->id), $base + ['payload' => $payload]);
        }
        if ($scene->campaign->active_scene_id !== $scene->id) {
            return;
        }
        foreach ($members as $member) {
            if ($member->pivot->role !== 'player') {
                continue;
            }
            $event = $base;
            $payload = [];
            if ($token) {
                if (! $token->is_hidden) {
                    $event['type'] = $wasVisible ? $type : 'token.created';
                    $payload = ['token' => $this->snapshots->token($token, false, $member)];
                } elseif ($wasVisible) {
                    $event['type'] = 'token.removed';
                    $payload = ['deletedId' => (string) $token->id];
                } else {
                    $event['type'] = 'scene.revision';
                }
            } elseif (isset($result['deletedId'])) {
                $event['type'] = $wasVisible ? 'token.removed' : 'scene.revision';
                if ($wasVisible) {
                    $payload = ['deletedId' => $result['deletedId']];
                }
            } else {
                foreach (['grid', 'map', 'scene', 'fog', 'fogAction'] as $key) {
                    if (array_key_exists($key, $result)) {
                        $payload[$key] = $result[$key];
                    }
                }
            }
            $this->schedule(ChannelAccess::player($scene->campaign_id, $scene->id, $scene->campaign->live_revision, $member->id), $event + ['payload' => $payload]);
        }
    }

    public function campaign(Campaign $campaign, string $type = 'campaign.changed'): void
    {
        $this->schedule('campaign.'.$campaign->id.'.control', ['type' => $type,
            'campaignId' => (string) $campaign->id, 'liveRevision' => $campaign->live_revision,
            'activeSceneId' => $campaign->active_scene_id ? (string) $campaign->active_scene_id : null], false);
    }

    public function preview(Scene $scene, Token $token, array $data): void
    {
        $event = ['type' => 'token.move-preview', 'sceneId' => (string) $scene->id,
            'tokenId' => (string) $token->id, 'baseRevision' => $scene->revision] + $data;
        $channels = [];
        if ($scene->campaign->active_scene_id === $scene->id && ! $token->is_hidden) {
            foreach ($scene->campaign->members()->wherePivot('role', 'player')->get() as $member) {
                $channels[] = ChannelAccess::player($scene->campaign_id, $scene->id, $scene->campaign->live_revision, $member->id);
            }
        }
        $this->schedule(ChannelAccess::gm($scene->campaign_id, $scene->id), $event, true, $channels);
    }

    public function spatial(Scene $scene, array $data): void
    {
        $event = ['type' => 'spatial', 'sceneId' => (string) $scene->id] + $data;
        $channels = [];
        foreach ($scene->campaign->members()->wherePivot('role', 'player')->get() as $member) {
            $channels[] = ChannelAccess::player($scene->campaign_id, $scene->id, $scene->campaign->live_revision, $member->id);
        }
        $this->schedule(ChannelAccess::gm($scene->campaign_id, $scene->id), $event, true, $channels);
    }

    private function schedule(string $channel, array $event, bool $excludeOrigin = true, array $additionalChannels = []): void
    {
        $message = new TabletopEvent($channel, $event, $excludeOrigin ? $this->context->socketId : null, $additionalChannels);
        DB::afterCommit(fn () => $this->broadcast->send($message));
    }
}
