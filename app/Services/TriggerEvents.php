<?php

namespace App\Services;

use App\Actions\CueRunner;
use App\Models\Cue;
use App\Models\Scene;
use App\Models\SceneRegion;
use App\Models\SceneTrigger;
use App\Models\User;
use App\Realtime\CommandContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/** Event detection only. Call under campaign/scene writer locks, before commit. */
class TriggerEvents
{
    public const TYPES = ['region.enter', 'region.exit', 'object.interact', 'scene.activated', 'combat.started', 'combat.round'];

    public const MAX_DEPTH = 8;

    public function movement(Scene $scene, array $moves): void
    {
        if ($scene->campaign->active_scene_id !== $scene->id || ! $moves) {
            return;
        }
        $triggers = SceneTrigger::where('scene_id', $scene->id)->where('enabled', true)->whereIn('event_type', ['region.enter', 'region.exit'])->orderBy('id')->get();
        if ($triggers->isEmpty()) {
            return;
        }
        $regions = SceneRegion::where('scene_id', $scene->id)->where('enabled', true)->whereIn('id', $triggers->pluck('region_id'))->get()->keyBy('id');
        $byRegion = $triggers->groupBy('region_id');
        $players = $scene->campaign->members()->wherePivot('role', 'player')->pluck('users.id')->all();
        $events = [];
        foreach ($moves as $move) {
            [$before, $after] = $move;
            $path = $move[2] ?? [];
            if (! $path && $before->x === $after->x && $before->y === $after->y) {
                continue;
            }
            foreach ($regions as $region) {
                if ($path) {
                    $crossings = RegionGeometry::crossings($region, $before, $path);
                } else {
                    // Teleport/GM edit/override retain endpoint-only semantics.
                    $was = RegionGeometry::contains($region, $before);
                    $is = RegionGeometry::contains($region, $after);
                    $crossings = $was === $is ? [] : [['distance' => 0, 'type' => $is ? 'region.enter' : 'region.exit']];
                }
                foreach ($crossings as $index => $crossing) {
                    foreach ($byRegion[$region->id] as $trigger) {
                        if ($trigger->event_type !== $crossing['type']
                            || ($trigger->actor_filter === 'player' && ! in_array($after->owner_user_id, $players, true))
                            || ($trigger->actor_filter === 'token' && $trigger->actor_token_id !== $after->id)) {
                            continue;
                        }
                        $events[] = $crossing + ['trigger' => $trigger, 'tokenId' => $after->id, 'index' => $index, 'path' => (bool) $path];
                    }
                }
            }
        }
        // Distance along the accepted route; ties: enter, exit, region, trigger,
        // token. Tangent contact therefore enters before exiting at the same point.
        usort($events, fn ($a, $b) => [$a['distance'], $a['type'] === 'region.exit', $a['trigger']->region_id, $a['trigger']->id, $a['tokenId']]
            <=> [$b['distance'], $b['type'] === 'region.exit', $b['trigger']->region_id, $b['trigger']->id, $b['tokenId']]);
        foreach ($events as $event) {
            $this->fire($scene, $event['trigger'], 'movement:'.app(CommandContext::class)->id().':token:'.$event['tokenId'].':crossing:'.$event['index'], $event['path']);
        }
    }

    public function event(Scene $scene, string $type, string $source, array $data = []): void
    {
        if ($scene->campaign->active_scene_id !== $scene->id) {
            return;
        }
        foreach (SceneTrigger::where('scene_id', $scene->id)->where('enabled', true)->where('event_type', $type)->orderBy('id')->get() as $trigger) {
            if ($type === 'object.interact' && ($trigger->{$data['kind'] === 'token' ? 'token_id' : 'prop_id'} !== $data['id'])) {
                continue;
            }
            if ($type === 'combat.round' && $data['round'] < $trigger->minimum_round) {
                continue;
            }
            $this->fire($scene, $trigger, $source);
        }
    }

    private function fire(Scene $scene, SceneTrigger $trigger, string $source, bool $pathCrossing = false): void
    {
        $context = app(CommandContext::class);
        $chain = $context->triggerChain;
        $correlation = $context->correlationId ?? $context->id();
        if (count($chain) >= self::MAX_DEPTH || in_array($trigger->id, $chain, true)
            || ($trigger->once && $trigger->fire_count > 0)
            || ($trigger->last_fired_at && now()->lessThan($trigger->last_fired_at->addMilliseconds($trigger->cooldown_ms)))) {
            return;
        }
        $source = hash('sha256', $source.':'.$trigger->event_type);
        // Distinct crossings of a root movement may repeat with once=false and
        // cooldown=0. Cue cascades still fire a trigger only once per correlation.
        $repeat = $pathCrossing && ! $chain && $context->correlationId === null;
        if (DB::table('trigger_fires')->where('trigger_id', $trigger->id)->where(function ($q) use ($source, $correlation, $repeat) {
            $q->where('source_key', $source);
            if (! $repeat) {
                $q->orWhere('correlation_id', $correlation);
            }
        })->exists()) {
            return;
        }
        $cue = Cue::where('scene_id', $scene->id)->find($trigger->cue_id);
        $author = User::find($trigger->created_by);
        if (! $cue || ! $author || Gate::forUser($author)->denies('update', $scene)) {
            return;
        }
        // The same CueRunner snapshots/enqueues the actions; no inline automation actions.
        $run = app(CueRunner::class)->start($author, $scene, $cue, [...$chain, $trigger->id], $correlation, true);
        DB::table('trigger_fires')->insert(['trigger_id' => $trigger->id, 'source_event' => $trigger->event_type,
            'source_key' => $source, 'correlation_id' => $correlation, 'cue_run_id' => $run->id, 'fired_at' => now()->format('Y-m-d H:i:s.v')]);
        $trigger->update(['fire_count' => $trigger->fire_count + 1, 'last_fired_at' => now()]);
    }
}
