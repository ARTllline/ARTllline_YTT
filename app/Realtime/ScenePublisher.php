<?php

namespace App\Realtime;

use App\Actions\CharacterActions;
use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\Token;
use App\Services\CombatView;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Support\Facades\DB;

class ScenePublisher
{
    public function __construct(private SceneSnapshotBuilder $snapshots, private SafeBroadcast $broadcast, private CommandContext $context) {}

    /** Materialize recipient-safe payloads while campaign + scene locks are held. */
    public function changed(Scene $scene, string $type, array $result, bool $wasVisible, array $previousVisibility = ['tokens' => [], 'props' => []]): void
    {
        $members = $scene->campaign->members()->get();
        $token = isset($result['token']) ? $scene->tokens()->with(['character.portraitAsset', 'imageAsset', 'conditions'])->find($result['token']['id']) : null;
        $base = ['type' => $type, 'sceneId' => (string) $scene->id, 'revision' => $scene->revision, 'mutationId' => $this->context->id()];
        if ($this->context->dragSessionId) {
            $base['dragSessionId'] = $this->context->dragSessionId;
        }
        $gm = $members->first(fn ($member) => $member->pivot->role === 'gm');
        if ($gm) {
            $payload = $result;
            unset($payload['revision'], $payload['mutationId']);
            if ($result['charactersChanged'] ?? false) {
                $payload['scene'] = app(CharacterActions::class)->roster($scene->campaign, $gm);
            }
            unset($payload['charactersChanged']);
            if ($token) {
                $payload['token'] = $this->snapshots->token($token, true, $gm);
            }
            $this->schedule(ChannelAccess::gm($scene->campaign_id, $scene->id), $base + ['payload' => $payload]);
        }
        if ($scene->campaign->active_scene_id !== $scene->id) {
            return;
        }
        $playerCombat = array_key_exists('combat', $result) ? app(CombatView::class)->build($scene, false) : null;
        $batchTokens = $type === 'objects.changed' ? $scene->tokens()->with(['character.portraitAsset', 'imageAsset', 'conditions'])->whereIn('id', array_column($result['tokens'] ?? [], 'id'))->where('is_hidden', false)->get() : collect();
        $batchProps = $type === 'objects.changed' ? SceneProp::with('asset')->where('scene_id', $scene->id)->whereIn('id', array_column($result['props'] ?? [], 'id'))->where('is_hidden', false)->get() : collect();
        foreach ($members as $member) {
            if ($member->pivot->role !== 'player') {
                continue;
            }
            $event = $base;
            if (str_starts_with($type, 'note.') || str_starts_with($type, 'region.') || str_starts_with($type, 'trigger.')) {
                $event['type'] = 'scene.revision';
            }
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
            if (array_key_exists('combat', $result)) {
                $payload['combat'] = $playerCombat;
                if ($payload['combat'] === null && str_starts_with($type, 'combat.')) {
                    $event['type'] = 'scene.revision';
                }
            }
            if ($type === 'objects.changed') {
                $visibleTokens = $batchTokens->pluck('id')->map(strval(...))->all();
                $visibleProps = $batchProps->pluck('id')->map(strval(...))->all();
                $payload += ['tokens' => $batchTokens->map(fn ($t) => $this->snapshots->token($t, false, $member))->all(),
                    'props' => $batchProps->map(fn ($p) => $p->projection(false))->all(),
                    'deletedIds' => array_values(array_diff($previousVisibility['tokens'], $visibleTokens)),
                    'deletedPropIds' => array_values(array_diff($previousVisibility['props'], $visibleProps))];
                if (! $payload['tokens'] && ! $payload['props'] && ! $payload['deletedIds'] && ! $payload['deletedPropIds']) {
                    $event['type'] = 'scene.revision';
                    $payload = array_key_exists('combat', $result) ? ['combat' => $playerCombat] : [];
                }
            }
            if (! empty($result['gameplayFeedbacks'])) {
                $visible = $scene->tokens()->where('is_hidden', false)->pluck('id')->map(strval(...))->all();
                $payload['gameplayFeedbacks'] = array_values(array_filter($result['gameplayFeedbacks'], fn ($f) => in_array($f['tokenId'], $visible, true)));
            }
            if (! empty($result['gameplayFeedback']) && $scene->tokens()->where('is_hidden', false)->whereKey($result['gameplayFeedback']['tokenId'])->exists()) {
                $payload['gameplayFeedback'] = $result['gameplayFeedback'];
            }
            if ($result['charactersChanged'] ?? false) {
                $payload['scene'] = app(CharacterActions::class)->roster($scene->campaign, $member);
            }
            $this->schedule(ChannelAccess::player($scene->campaign_id, $scene->id, $scene->campaign->live_revision, $member->id), $event + ['payload' => $payload ?: (object) []]);
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
