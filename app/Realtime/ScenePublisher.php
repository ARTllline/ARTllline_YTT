<?php

namespace App\Realtime;

use App\Actions\CharacterActions;
use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\Token;
use App\Models\User;
use App\Services\CombatView;
use App\Services\SceneSnapshotBuilder;
use App\Services\SceneVisibility;
use App\Services\StructureData;
use App\Services\TerrainData;
use App\Spells\SpellEffects;
use App\Support\RequestPerformance;
use Illuminate\Support\Facades\DB;

class ScenePublisher
{
    public function __construct(private SceneSnapshotBuilder $snapshots, private SafeBroadcast $broadcast, private CommandContext $context) {}

    /** Materialize recipient-safe payloads while campaign + scene locks are held. */
    public function changed(Scene $scene, string $type, array $result, bool $wasVisible, array $previousVisibility = ['tokens' => [], 'props' => []], array $visionBefore = []): void
    {
        app(RequestPerformance::class)->measure('broadcast_prepare', fn () => app(SpellEffects::class)->project(fn () => $this->changedMeasured($scene, $type, $result, $wasVisible, $previousVisibility, $visionBefore)));
    }

    private function changedMeasured(Scene $scene, string $type, array $result, bool $wasVisible, array $previousVisibility, array $visionBefore): void
    {
        unset($result['fogPrevious']);
        if ($type === 'fog.history' && isset($result['fog']) && strlen(json_encode($result['fog'])) > 8 * 1024) {
            // Restoring a cleared scene can exceed the websocket frame limit.
            unset($result['fog']);
            $result['fogRefresh'] = true;
        }
        $members = $scene->campaign->members()->get();
        $token = isset($result['token']) ? $scene->tokens()->with(['character.portraitAsset', 'imageAsset', 'conditions'])->find($result['token']['id']) : null;
        $base = ['type' => $type, 'sceneId' => (string) $scene->id, 'revision' => $scene->revision, 'mutationId' => $this->context->id()];
        if ($this->context->dragSessionId) {
            $base['dragSessionId'] = $this->context->dragSessionId;
        }
        $gm = $members->first(fn ($member) => $member->pivot->role === 'gm');
        if ($gm) {
            $payload = $result;
            unset($payload['revision'], $payload['mutationId'], $payload['propEdits'], $payload['terrainEdit'],
                $payload['structure'], $payload['structureEdit'], $payload['_structureBefore'], $payload['_lightingInvalidated']);
            if (isset($result['_structureBefore'])) {
                $payload += StructureData::patch($scene, $result['_structureBefore'], true);
            }
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
        $batchTokens = ($type === 'objects.changed' || array_key_exists('tokens', $result)) ? $scene->tokens()->with(['character.portraitAsset', 'imageAsset', 'conditions'])->whereIn('id', array_column($result['tokens'] ?? [], 'id'))->where('is_hidden', false)->get() : collect();
        $batchProps = ($type === 'objects.changed' || array_key_exists('tokens', $result)) ? SceneProp::with('asset')->where('scene_id', $scene->id)->whereIn('id', array_column($result['props'] ?? [], 'id'))->where('is_hidden', false)->get() : collect();
        foreach ($members as $member) {
            if ($member->pivot->role !== 'player') {
                continue;
            }
            if (isset($visionBefore[$member->id])) {
                $payload = $this->visionPayload($scene, $member, $result, $visionBefore[$member->id]);
                $this->schedule(ChannelAccess::player($scene->campaign_id, $scene->id, $scene->campaign->live_revision, $member->id),
                    array_replace($base, ['type' => 'vision.updated', 'payload' => $payload]));

                continue;
            }
            $event = $base;
            if (isset($result['lighting'])) {
                $payloadLighting = \App\Services\SceneLighting::settings($scene, false);
            } else {
                $payloadLighting = null;
            }
            if (str_starts_with($type, 'note.') || str_starts_with($type, 'region.') || str_starts_with($type, 'trigger.')) {
                $event['type'] = 'scene.revision';
            }
            $payload = [];
            $visibleTokens = [];
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
                foreach (['grid', 'map', 'scene', 'fog', 'fogAction', 'fogRemovedSequence', 'fogRefresh'] as $key) {
                    if (array_key_exists($key, $result)) {
                        $payload[$key] = $result[$key];
                    }
                }
                if (array_key_exists('mapWorld', $result)) {
                    $payload['mapWorld'] = $this->snapshots->mapWorld($scene, false);
                }
                if (isset($result['_structureBefore'])) {
                    $structure = StructureData::patch($scene, $result['_structureBefore'], false);
                    if ($structure) {
                        $payload += $structure;
                    } else {
                        $event['type'] = 'scene.revision';
                    }
                }
                if (isset($result['terrain'])) {
                    $payload['terrain'] = app(TerrainData::class)->manifest($scene, false, array_column($result['terrain']['chunks'], 'key'));
                }
            }
            if (array_key_exists('combat', $result)) {
                $payload['combat'] = app(CombatView::class)->build($scene, false, $member);
                if ($payload['combat'] === null && str_starts_with($type, 'combat.')) {
                    $event['type'] = 'scene.revision';
                }
            }
            if (($type === 'objects.changed' || array_key_exists('tokens', $result))) {
                $visibleTokens = $batchTokens->pluck('id')->map(strval(...))->all();
                $visibleProps = $batchProps->pluck('id')->map(strval(...))->all();
                $payload += ['tokens' => $batchTokens->map(fn ($t) => $this->snapshots->token($t, false, $member))->all(),
                    'props' => $batchProps->map(fn ($p) => $p->projection(false))->all(),
                    'deletedIds' => array_values(array_diff($previousVisibility['tokens'], $visibleTokens)),
                    'deletedPropIds' => array_values(array_diff($previousVisibility['props'], $visibleProps))];
                if (! $payload['tokens'] && ! $payload['props'] && ! $payload['deletedIds'] && ! $payload['deletedPropIds'] && ! isset($payload['deletedId']) && ! isset($payload['token'])) {
                    $event['type'] = 'scene.revision';
                    $payload = array_key_exists('combat', $result) ? ['combat' => app(CombatView::class)->build($scene, false, $member)] : [];
                }
            }
            if (! empty($result['tokenMovements'])) {
                $visible = array_intersect($previousVisibility['tokens'], $visibleTokens);
                if ($token && $wasVisible && ! $token->is_hidden) {
                    $visible[] = (string) $token->id;
                }
                $movements = array_values(array_filter($result['tokenMovements'], fn ($move) => in_array($move['tokenId'], $visible, true)));
                if ($movements) {
                    $payload['tokenMovements'] = $movements;
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
            if ($payloadLighting !== null) {
                $payload['lighting'] = $payloadLighting;
            }
            $this->schedule(ChannelAccess::player($scene->campaign_id, $scene->id, $scene->campaign->live_revision, $member->id), $event + ['payload' => $payload ?: (object) []]);
        }
    }

    public function visionPayload(Scene $scene, User $user, array $result, array $before): array
    {
        $vision = app(SceneVisibility::class);
        $payload = array_intersect_key($result, array_flip(['grid', 'map', 'fog', 'fogAction', 'fogRemovedSequence', 'fogRefresh']));
        $payload += $vision->delta($scene, $user, $before);
        if (isset($result['lighting'])) {
            $payload['lighting'] = \App\Services\SceneLighting::settings($scene, false);
        }
        if (array_key_exists('movementGeometryChanged', $result)) {
            $payload['movementGeometryChanged'] = $result['movementGeometryChanged'];
        }
        if (isset($result['scene'])) {
            $safeScene = array_intersect_key($result['scene'], array_flip(['id', 'name', 'width', 'height']));
            if ($safeScene) {
                $payload['scene'] = $safeScene;
            }
        }
        $payload['combat'] = app(CombatView::class)->build($scene, false, $user);
        if (isset($result['_structureBefore'])) {
            $payload += StructureData::patch($scene, $result['_structureBefore'], false);
        }
        if (array_key_exists('mapWorld', $result)) {
            $payload['mapWorld'] = $this->snapshots->mapWorld($scene, false);
        }
        if (isset($result['terrain'])) {
            $payload['terrain'] = app(TerrainData::class)->manifest($scene, false, array_column($result['terrain']['chunks'], 'key'));
        }
        if ($result['charactersChanged'] ?? false) {
            $payload['scene'] = app(CharacterActions::class)->roster($scene->campaign, $user);
        }
        // Never disclose another token's route through unseen space. Final positions arrive in delta.
        $owned = $vision->view($scene, $user)['observers']->pluck('id')->map(strval(...))->all();
        $payload['tokenMovements'] = array_values(array_filter($result['tokenMovements'] ?? [], fn ($m) => in_array($m['tokenId'], $owned, true)));
        $ids = $vision->view($scene, $user)['tokens']->pluck('id')->map(strval(...))->all();
        $feedbacks = $result['gameplayFeedbacks'] ?? (isset($result['gameplayFeedback']) ? [$result['gameplayFeedback']] : []);
        $payload['gameplayFeedbacks'] = array_values(array_filter($feedbacks, fn ($f) => in_array($f['tokenId'], $ids, true)));

        return $payload;
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
                if (! $scene->vision_enabled) {
                    $channels[] = ChannelAccess::player($scene->campaign_id, $scene->id, $scene->campaign->live_revision, $member->id);
                }
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
