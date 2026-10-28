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

    public function show(User $user, Campaign $campaign, string $id): array
    {
        return DB::transaction(function () use ($user, $campaign, $id) {
            $campaign = Campaign::whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($user)->authorize('update', $campaign);
            $handout = Handout::where('campaign_id', $campaign->id)->findOrFail($id);
            $channels = [];
            foreach ($campaign->members()->wherePivot('role', 'player')->get() as $player) {
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
}
