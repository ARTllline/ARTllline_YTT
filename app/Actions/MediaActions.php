<?php

namespace App\Actions;

use App\Models\Asset;
use App\Models\Campaign;
use App\Models\User;
use App\Realtime\CommandContext;
use App\Services\LiveMedia;
use App\Services\MediaConfig;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class MediaActions
{
    public function execute(User $user, Campaign $campaign, string $type, array $input): array
    {
        return DB::transaction(function () use ($user, $campaign, $type, $input) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($user)->authorize('update', $campaign);
            $data = app(MediaConfig::class)->validate($campaign->id, $type, $input);
            $media = app(LiveMedia::class);
            $state = $media->read($campaign);
            // Bind scene-scoped commands to the scene the GM actually saw.
            if (str_starts_with($type, 'ambient.') || str_starts_with($type, 'atmosphere.') || $type === 'sfx.play') {
                abort_unless($campaign->active_scene_id && (string) ($input['sceneId'] ?? '') === (string) $campaign->active_scene_id
                    && (int) ($input['epoch'] ?? -1) === $campaign->live_revision, 409, 'Активная сцена изменилась. Обновите панель звука.');
            }
            $id = app(CommandContext::class)->id();
            $state['fade'] = $data['fade'] ?? 0;
            if ($type === 'sfx.play') {
                $track = $media->track(Asset::findOrFail($data['assetId']), $data, $id);
                $media->grant($campaign, $track['assetId'], $track['duration'] + 15000);
                $media->publish($campaign, ['type' => 'media.sfx', 'eventId' => $id, 'sceneId' => $state['sceneId'], 'epoch' => $state['epoch'],
                    'track' => $track, 'volume' => $state['volumes']['sfx'], 'expiresAt' => now()->addSeconds(5)->getTimestampMs()]);

                return ['played' => true];
            }
            if (in_array($type, ['music.start', 'music.stop'])) {
                if ($state['music']) {
                    $media->grant($campaign, $state['music']['assetId'], $state['fade'] + 15000);
                }
                $state['music'] = $type === 'music.start' ? $media->track(Asset::findOrFail($data['assetId']), $data, $id) : null;
            } elseif ($type === 'music.pause' && $state['music'] && ! $state['music']['paused']) {
                $state['music']['position'] = max(0, now()->getTimestampMs() - $state['music']['startedAt']);
                $state['music']['paused'] = true;
            } elseif ($type === 'music.resume' && $state['music'] && $state['music']['paused']) {
                $state['music']['startedAt'] = now()->getTimestampMs() - $state['music']['position'];
                $state['music']['paused'] = false;
            } elseif ($type === 'ambient.start') {
                $state['ambient'] = array_values(array_filter($state['ambient'], fn ($t) => $t['assetId'] !== (string) $data['assetId']));
                abort_if(count($state['ambient']) >= 4, 422, 'Одновременно можно включить до четырёх атмосферных дорожек.');
                $state['ambient'][] = $media->track(Asset::findOrFail($data['assetId']), $data, $id);
            } elseif ($type === 'ambient.stop') {
                foreach ($state['ambient'] as $track) {
                    if (! isset($data['assetId']) || $track['assetId'] === (string) $data['assetId']) {
                        $media->grant($campaign, $track['assetId'], $state['fade'] + 15000);
                    }
                }
                $state['ambient'] = array_values(array_filter($state['ambient'], fn ($t) => isset($data['assetId']) && $t['assetId'] !== (string) $data['assetId']));
            } elseif ($type === 'audio.volume') {
                $state['volumes'][$data['channel']] = (float) $data['volume'];
            } elseif ($type === 'atmosphere.start') {
                $state['effects'][$data['effect']] = $data['intensity'];
            } elseif ($type === 'atmosphere.stop') {
                unset($state['effects'][$data['effect']]);
            }

            return $media->save($campaign, $state);
        }, 3);
    }
}
