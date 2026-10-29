<?php

namespace App\Services;

use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\CueStep;
use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\Token;
use App\Models\User;
use App\Realtime\SafeBroadcast;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class PreloadService
{
    public const MAX_BYTES = 134217728;

    public static function url(Asset $asset): string
    {
        $key = $asset->delivery_key;

        return $key ? '/api/media/'.$key : '/api/assets/'.$asset->id;
    }

    private function assets(Scene $scene, bool $audio): array
    {
        $ids = array_filter([$scene->map_asset_id,
            ...Token::with('character')->where('scene_id', $scene->id)->where('is_hidden', false)->get()->map(fn ($t) => $t->token_image_asset_id)->all(),
            ...SceneProp::where('scene_id', $scene->id)->where('is_hidden', false)->pluck('asset_id')->all()]);
        if ($audio) {
            foreach (CueStep::whereIn('cue_id', DB::table('cues')->where('scene_id', $scene->id)->select('id'))
                ->whereIn('type', ['music.start', 'ambient.start', 'sfx.play'])->get() as $step) {
                $ids[] = $step->config['assetId'] ?? null;
            }
        }

        // Handouts are never eligible, even if referenced accidentally by old data.
        return Asset::where('campaign_id', $scene->campaign_id)->whereIn('id', array_unique(array_filter($ids)))
            ->whereIn('kind', ['map', 'token', 'prop', ...($audio ? ['music', 'ambient', 'sfx'] : [])])->orderBy('id')->get()->all();
    }

    public function start(User $user, Campaign $campaign, int $sceneId, bool $audio): array
    {
        return DB::transaction(function () use ($user, $campaign, $sceneId, $audio) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($user)->authorize('update', $campaign);
            $scene = Scene::where('campaign_id', $campaign->id)->whereKey($sceneId)->lockForUpdate()->firstOrFail();
            $assets = $this->assets($scene, $audio);
            abort_if(count($assets) > 128 || array_sum(array_map(fn ($a) => $a->file_size, $assets)) > self::MAX_BYTES, 422, 'Набор предзагрузки ограничен 128 файлами и 128 МиБ. Уменьшите ресурсы или отключите аудио.');
            $resources = [];
            foreach ($assets as $asset) {
                if (! $asset->delivery_key) {
                    $asset->update(['delivery_key' => (string) Str::uuid()]);
                }
                $resources[] = ['assetId' => (string) $asset->id, 'url' => self::url($asset), 'bytes' => (int) $asset->file_size,
                    'kind' => $asset->duration_ms === null ? 'image' : 'audio'];
            }
            $old = $this->row($campaign);
            if ($old && $old->scene_id === $scene->id && $old->scene_revision === $scene->revision && (bool) $old->include_audio === $audio
                && json_decode($old->resources, true) === $resources) {
                return $this->gm($campaign);
            }
            DB::table('scene_preloads')->updateOrInsert(['campaign_id' => $campaign->id], ['id' => (string) Str::uuid(), 'scene_id' => $scene->id,
                'scene_revision' => $scene->revision, 'include_audio' => $audio, 'resources' => json_encode($resources), 'expires_at' => now()->addMinutes(30)]);
            DB::table('preload_readiness')->where('campaign_id', $campaign->id)->delete();
            $this->notify($campaign);

            return $this->gm($campaign);
        }, 3);
    }

    private function row(Campaign $campaign): ?object
    {
        return DB::table('scene_preloads')->where('campaign_id', $campaign->id)->where('expires_at', '>', now())->first();
    }

    private function valid(object $row): bool
    {
        $scene = Scene::find($row->scene_id);
        if (! $scene || $scene->revision !== (int) $row->scene_revision) {
            return false;
        }
        $ids = array_map(fn ($a) => (string) $a->id, $this->assets($scene, (bool) $row->include_audio));

        return $ids === array_column(json_decode($row->resources, true), 'assetId');
    }

    public function manifest(Campaign $campaign): ?array
    {
        $row = $this->row($campaign);
        if (! $row || ! $this->valid($row)) {
            return null;
        }

        return ['id' => $row->id, 'expiresAt' => strtotime($row->expires_at) * 1000,
            'resources' => array_map(fn ($r) => array_intersect_key($r, array_flip(['url', 'bytes', 'kind'])), json_decode($row->resources, true))];
    }

    public function authorized(Campaign $campaign, Asset $asset): bool
    {
        $row = $this->row($campaign);

        return $row && $this->valid($row) && in_array((string) $asset->id, array_column(json_decode($row->resources, true), 'assetId'), true);
    }

    public function gm(Campaign $campaign): array
    {
        $row = $this->row($campaign);
        if (! $row) {
            return ['preload' => null];
        }
        $resources = json_decode($row->resources, true);
        $readiness = DB::table('preload_readiness')->where('campaign_id', $campaign->id)->where('batch_id', $row->id)->get()->keyBy('user_id');
        $valid = $this->valid($row);

        return ['preload' => ['id' => $row->id, 'sceneId' => (string) $row->scene_id, 'valid' => $valid, 'includeAudio' => (bool) $row->include_audio,
            'total' => count($resources), 'bytes' => array_sum(array_column($resources, 'bytes')),
            'players' => $campaign->members()->wherePivot('role', 'player')->get()->map(function ($user) use ($readiness, $valid) {
                $r = $readiness->get($user->id);
                $fresh = $valid && $r && now()->subSeconds(45)->lessThan($r->updated_at);

                return ['id' => (string) $user->id, 'name' => $user->name, 'status' => $fresh ? $r->status : 'waiting', 'loaded' => $fresh ? $r->loaded : 0];
            })->all()]];
    }

    public function acknowledge(User $user, Campaign $campaign, array $data): array
    {
        return DB::transaction(function () use ($user, $campaign, $data) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            abort_unless($campaign->roleFor($user) === 'player', 403);
            $manifest = $this->manifest($campaign);
            abort_unless($manifest && $manifest['id'] === $data['batchId'], 409, 'Подготовка обновлена.');
            $loaded = min(count($manifest['resources']), $data['loaded']);
            abort_if($data['status'] === 'ready' && $loaded !== count($manifest['resources']), 422);
            DB::table('preload_readiness')->updateOrInsert(['campaign_id' => $campaign->id, 'user_id' => $user->id],
                ['batch_id' => $manifest['id'], 'client_id' => $data['clientId'], 'status' => $data['status'], 'loaded' => $loaded, 'updated_at' => now()]);

            return ['accepted' => true];
        });
    }

    private function notify(Campaign $campaign): void
    {
        // Invalidation only: no target scene, title, plan or resources on shared control.
        $event = new TabletopEvent('campaign.'.$campaign->id.'.control', ['type' => 'preload.changed']);
        DB::afterCommit(fn () => app(SafeBroadcast::class)->send($event));
    }
}
