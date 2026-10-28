<?php

namespace App\Actions;

use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\Handout;
use App\Models\User;
use App\Realtime\CommandContext;
use App\Realtime\SafeBroadcast;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class HandoutActions
{
    public function projection(Handout $handout): array
    {
        return ['id' => (string) $handout->id, 'title' => $handout->title, 'description' => $handout->description,
            'asset' => app(SceneSnapshotBuilder::class)->asset($handout->asset), 'thumbnailUrl' => '/api/assets/'.$handout->asset_id.'/thumbnail'];
    }

    public function save(User $user, Campaign $campaign, array $data): array
    {
        return DB::transaction(function () use ($user, $campaign, $data) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($user)->authorize('update', $campaign);
            $asset = Asset::whereKey($data['assetId'])->where('campaign_id', $campaign->id)->where('kind', 'handout')->first();
            abort_unless($asset, 422, 'Choose a handout image from this campaign.');
            $handout = Handout::firstOrCreate(['campaign_id' => $campaign->id, 'asset_id' => $asset->id],
                ['title' => $data['title'], 'description' => $data['description'] ?? null, 'created_by' => $user->id]);
            $handout->update(['title' => $data['title'], 'description' => $data['description'] ?? null]);

            return $this->projection($handout);
        }, 3);
    }

    public function show(User $user, Campaign $campaign, string $id, ?array $recipientIds = null): array
    {
        return DB::transaction(function () use ($user, $campaign, $id, $recipientIds) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($user)->authorize('update', $campaign);
            $handout = Handout::where('campaign_id', $campaign->id)->findOrFail($id);
            $channels = [];
            foreach ($this->recipients($campaign, $recipientIds) as $player) {
                $handout->reveals()->firstOrCreate(['user_id' => $player->id], ['revealed_at' => now()]);
                $channels[] = 'campaign.'.$campaign->id.'.handouts.user.'.$player->id;
            }
            $safe = $this->projection($handout);
            if ($channels) {
                $event = new TabletopEvent(array_shift($channels), ['type' => 'handout.shown', 'campaignId' => (string) $campaign->id,
                    'presentationId' => app(CommandContext::class)->id(), 'handout' => $safe], null, $channels);
                DB::afterCommit(fn () => app(SafeBroadcast::class)->send($event));
            }

            return ['handout' => $safe];
        }, 3);
    }

    public function revoke(User $user, Campaign $campaign, string $id, ?array $recipientIds): array
    {
        return DB::transaction(function () use ($user, $campaign, $id, $recipientIds) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($user)->authorize('update', $campaign);
            $handout = Handout::where('campaign_id', $campaign->id)->findOrFail($id);
            $players = $this->recipients($campaign, $recipientIds);
            $handout->reveals()->when($recipientIds !== null, fn ($query) => $query->whereIn('user_id', $players->modelKeys()))->delete();
            foreach ($players as $player) {
                $event = new TabletopEvent('campaign.'.$campaign->id.'.handouts.user.'.$player->id,
                    ['type' => 'handout.revoked', 'campaignId' => (string) $campaign->id, 'handoutId' => (string) $handout->id]);
                DB::afterCommit(fn () => app(SafeBroadcast::class)->send($event));
            }

            return ['revoked' => true];
        }, 3);
    }

    private function recipients(Campaign $campaign, ?array $ids)
    {
        $players = $campaign->members()->wherePivot('role', 'player')->get();
        if ($ids !== null) {
            $ids = array_unique(array_map('strval', $ids));
            abort_unless(count(array_intersect($ids, array_map('strval', $players->modelKeys()))) === count($ids), 422, 'Выберите игроков этой кампании.');
            $players = $players->filter(fn ($p) => in_array((string) $p->id, $ids, true));
        }

        return $players;
    }
}
