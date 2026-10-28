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
        $players = $scene->campaign->members()->wherePivot('role', 'player')->pluck('users.id')->all();
        foreach ($moves as [$before, $after]) {
            if ($before->x === $after->x && $before->y === $after->y) {
                continue;
            }
            foreach ($triggers as $trigger) {
                $region = $regions->get($trigger->region_id);
                if (! $region || ($trigger->actor_filter === 'player' && ! in_array($after->owner_user_id, $players, true))
                    || ($trigger->actor_filter === 'token' && $trigger->actor_token_id !== $after->id)) {
                    continue;
                }
                $was = RegionGeometry::contains($region, $before);
                $is = RegionGeometry::contains($region, $after);
                if ($was === $is || ($trigger->event_type === 'region.enter') !== $is) {
                    continue;
                }
                $this->fire($scene, $trigger, 'scene:'.$scene->id.':revision:'.($scene->revision + 1).':token:'.$after->id);
            }
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

    private function fire(Scene $scene, SceneTrigger $trigger, string $source): void
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
        if (DB::table('trigger_fires')->where('trigger_id', $trigger->id)->where(fn ($q) => $q->where('source_key', $source)->orWhere('correlation_id', $correlation))->exists()) {
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
