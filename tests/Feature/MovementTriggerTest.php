<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\Combat;
use App\Models\Cue;
use App\Models\CueRun;
use App\Models\SceneRegion;
use App\Models\SceneTrigger;
use App\Models\User;
use App\Services\RegionGeometry;
use App\Services\TriggerEvents;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

class MovementTriggerTest extends TestCase
{
    use RefreshDatabase;

    private $gm;

    private $player;

    private $scene;

    private $token;

    private $cue;

    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([TabletopEvent::class]);
        Queue::fake();
        $this->gm = User::factory()->create();
        $this->player = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Route triggers']);
        $campaign->members()->attach($this->gm, ['role' => 'gm']);
        $campaign->members()->attach($this->player, ['role' => 'player']);
        $this->scene = $campaign->scenes()->create(['name' => 'Route', 'grid_size' => 50, 'distance_per_cell' => 5]);
        $campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->token = $this->scene->tokens()->create(['name' => 'Walker', 'kind' => 'player_character',
            'x' => 0, 'y' => 200, 'size' => 20, 'scale' => 1, 'owner_user_id' => $this->player->id, 'speed' => 100]);
        $this->cue = Cue::create(['scene_id' => $this->scene->id, 'name' => 'SECRET CUE']);
        $this->cue->steps()->create(['position' => 0, 'type' => 'wait', 'config' => ['duration' => 100]]);
        $this->actingAs($this->player);
    }

    private function region(float $x, string $shape = 'rectangle'): SceneRegion
    {
        return SceneRegion::create(['scene_id' => $this->scene->id, 'name' => 'SECRET TRAP', 'enabled' => true,
            'shape' => $shape, 'geometry' => $shape === 'circle' ? ['x' => $x, 'y' => 200, 'radius' => 5]
                : ['x' => $x, 'y' => 100, 'width' => 10, 'height' => 200]]);
    }

    private function trigger(SceneRegion $region, string $type = 'region.enter', array $extra = []): SceneTrigger
    {
        return SceneTrigger::create($extra + ['scene_id' => $this->scene->id, 'name' => 'SECRET RULE', 'enabled' => true,
            'region_id' => $region->id, 'cue_id' => $this->cue->id, 'event_type' => $type, 'once' => false,
            'cooldown_ms' => 0, 'actor_filter' => 'player', 'created_by' => $this->gm->id]);
    }

    private function move(float $x, array $waypoints = [], ?string $id = null)
    {
        return $this->postJson('/api/tokens/'.$this->token->id.'/move', ['x' => $x, 'y' => 200,
            'waypoints' => $waypoints, 'clientMutationId' => $id ?? (string) Str::uuid()]);
    }

    public function test_route_order_repeated_crossings_retry_snapshot_undo_and_secret_projection(): void
    {
        // Deliberately create the later region/trigger first.
        $later = $this->region(300, 'circle');
        $bExit = $this->trigger($later, 'region.exit');
        $bEnter = $this->trigger($later);
        $early = $this->region(100);
        $aExit = $this->trigger($early, 'region.exit');
        $aEnter = $this->trigger($early);
        $id = (string) Str::uuid();
        // Same origin/destination, two full passes: endpoints alone see nothing.
        $points = [['x' => 400, 'y' => 200]];
        $accepted = $this->move(0, $points, $id)->assertOk()->assertJsonCount(3, 'tokenMovements.0.path');
        $expected = [$aEnter->id, $aExit->id, $bEnter->id, $bExit->id, $bEnter->id, $bExit->id, $aEnter->id, $aExit->id];
        $this->assertSame($expected, DB::table('trigger_fires')->orderBy('id')->pluck('trigger_id')->all());
        $this->assertSame(8, CueRun::count());
        $before = clone $this->token;
        $this->token->refresh();
        // Even a duplicate internal delivery of the accepted route is idempotent.
        app(TriggerEvents::class)->movement($this->scene->fresh(), [[$before, $this->token, $accepted->json('tokenMovements.0.path')]]);
        $this->move(0, $points, $id)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk()->assertJsonMissingPath('regions')->assertJsonMissingPath('triggers');
        $this->assertDatabaseCount('trigger_fires', 8);
        $this->assertStringNotContainsString('SECRET', $accepted->getContent());
        foreach (Event::dispatched(TabletopEvent::class)->pluck(0) as $event) {
            if (str_contains($event->channel, '.user.')) {
                $this->assertStringNotContainsString('SECRET', json_encode($event->envelope));
                $this->assertArrayNotHasKey('regions', $event->envelope['payload'] ?? []);
            }
        }
        $this->actingAs($this->gm)->postJson('/api/scenes/'.$this->scene->id.'/edit-history', ['changes' => [
            ['kind' => 'token', 'id' => $this->token->id, 'expected' => ['x' => 0, 'y' => 200], 'value' => ['x' => 400, 'y' => 200]],
        ]])->assertOk();
        $this->assertDatabaseCount('trigger_fires', 8);
    }

    public function test_once_cooldown_and_permissions_apply_to_distinct_crossings(): void
    {
        $region = $this->region(100);
        $once = $this->trigger($region, extra: ['once' => true]);
        $cooldown = $this->trigger($region, extra: ['cooldown_ms' => 5000]);
        $repeat = $this->trigger($region);
        $denied = $this->trigger($region, extra: ['created_by' => $this->player->id]);
        $this->move(0, [['x' => 200, 'y' => 200]])->assertOk();
        $this->assertSame(1, $once->fresh()->fire_count);
        $this->assertSame(1, $cooldown->fresh()->fire_count);
        $this->assertSame(2, $repeat->fresh()->fire_count);
        $this->assertSame(0, $denied->fresh()->fire_count);
        $this->travel(5)->seconds();
        $this->move(200)->assertOk();
        $this->assertSame(1, $once->fresh()->fire_count);
        $this->assertSame(2, $cooldown->fresh()->fire_count);
    }

    public function test_closed_door_rejects_entire_route_without_triggers_or_budget_and_open_door_accepts(): void
    {
        $this->trigger($this->region(100));
        $graph = ['vertices' => [['id' => 'a', 'x' => 200, 'y' => 50], ['id' => 'b', 'x' => 200, 'y' => 350]],
            'edges' => [['id' => 'wall', 'a' => 'a', 'b' => 'b', 'thickness' => 10, 'materialVersionId' => null, 'blocksMovement' => true, 'blocksVision' => true, 'blocksLight' => true]],
            'openings' => [['id' => 'door', 'edgeId' => 'wall', 'type' => 'door', 'center' => 0.5, 'width' => 100, 'open' => false]]];
        $world = $this->scene->mapWorld()->create(['structure' => $graph]);
        $combat = Combat::create(['scene_id' => $this->scene->id, 'created_by' => $this->gm->id, 'status' => 'active', 'round' => 1]);
        $entry = $combat->combatants()->create(['token_id' => $this->token->id, 'position' => 0]);
        $combat->update(['current_combatant_id' => $entry->id]);
        $this->move(300)->assertUnprocessable()->assertDontSee('SECRET');
        $this->assertDatabaseCount('trigger_fires', 0);
        $this->assertEquals(0, $entry->fresh()->movement_spent);
        $this->assertEquals(0, $this->token->fresh()->x);
        $graph['openings'][0]['open'] = true;
        $world->update(['structure' => $graph]);
        $this->move(300)->assertOk()->assertJsonPath('token.x', 300);
        $this->assertDatabaseCount('trigger_fires', 1);
        $this->assertEquals(30, $entry->fresh()->movement_spent);
        // Entire proposed path is budget-checked before any event is accepted.
        $this->move(1200)->assertUnprocessable();
        $this->assertDatabaseCount('trigger_fires', 1);
        $this->assertEquals(30, $entry->fresh()->movement_spent);
    }

    public function test_short_wasd_step_sweeps_trap_and_preview_does_not_execute(): void
    {
        $this->token->update(['size' => 20, 'scale' => 0.4, 'x' => 100]);
        $region = $this->region(115, 'circle');
        $enter = $this->trigger($region);
        $exit = $this->trigger($region, 'region.exit');
        $this->postJson('/api/tokens/'.$this->token->id.'/preview', ['x' => 130, 'y' => 200,
            'baseRevision' => 0, 'dragSessionId' => (string) Str::uuid(), 'sequence' => 1])->assertOk();
        $this->assertDatabaseCount('trigger_fires', 0);
        $stream = (string) Str::uuid();
        $this->postJson('/api/tokens/'.$this->token->id.'/control/start', ['streamId' => $stream])->assertOk();
        $state = $this->token->fresh()->direct_control;
        $state['at'] -= 250;
        $this->token->update(['direct_control' => $state]);
        $data = ['streamId' => $stream, 'sequence' => 1, 'origin' => ['x' => 100, 'y' => 200],
            'x' => 130, 'y' => 200, 'clientMutationId' => (string) Str::uuid()];
        $url = '/api/tokens/'.$this->token->id.'/control/step';
        $this->postJson($url, $data)->assertOk()->assertJsonPath('token.x', 130)->assertJsonPath('tokenMovements.0.continuous', true);
        $this->postJson($url, $data)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertSame([$enter->id, $exit->id], DB::table('trigger_fires')->orderBy('id')->pluck('trigger_id')->all());
    }

    public function test_swept_geometry_round_corners_tangents_boundaries_and_waypoints(): void
    {
        $region = $this->region(100);
        $point = fn ($x, $y = 200) => ['x' => $x, 'y' => $y];
        $types = fn ($path) => array_column(RegionGeometry::crossings($region, $this->token, $path), 'type');
        $this->assertSame(['region.enter', 'region.exit'], $types([$point(0), $point(90), $point(90), $point(0)]));
        $this->assertSame(['region.enter'], $types([$point(0), $point(90)]));
        $this->assertSame(['region.exit'], $types([$point(90), $point(0)]));
        $this->assertSame([], $types([$point(90), $point(90)]));
        $this->assertSame([], $types([$point(90, 90), $point(92, 92)])); // Outside rounded corner.
        $this->assertSame(['region.enter', 'region.exit'], $types([$point(0, 90), $point(200, 90)])); // Boundary glide.
        $this->assertSame(['region.enter', 'region.exit'], $types([$point(0), $point(100), $point(200)]));
        $region->shape = 'circle';
        $region->geometry = ['x' => 100, 'y' => 200, 'radius' => 5];
        $events = RegionGeometry::crossings($region, $this->token, [$point(0, 185), $point(200, 185)]);
        $this->assertSame(['region.enter', 'region.exit'], array_column($events, 'type'));
        $this->assertEqualsWithDelta(100, $events[0]['distance'], 0.000001);
        $this->assertEquals($events[0]['distance'], $events[1]['distance']);
        $this->assertSame([], $types([$point(0, 184.999), $point(200, 184.999)]));
    }

    public function test_group_routes_use_stable_tangent_order_even_when_exit_was_created_first(): void
    {
        $this->token->update(['y' => 185]);
        $second = $this->scene->tokens()->create(['name' => 'Second', 'x' => 0, 'y' => 185,
            'size' => 20, 'scale' => 1, 'owner_user_id' => $this->player->id]);
        $region = $this->region(100, 'circle');
        $exit = $this->trigger($region, 'region.exit');
        $enter = $this->trigger($region);
        $this->actingAs($this->gm)->postJson('/api/scenes/'.$this->scene->id.'/selection', [
            'action' => 'move', 'anchorKind' => 'token', 'anchorId' => $this->token->id, 'x' => 200, 'y' => 185,
            'tokenIds' => [$second->id, $this->token->id], 'propIds' => [],
        ])->assertOk()->assertJsonCount(2, 'tokenMovements');
        $this->assertSame([$enter->id, $enter->id, $exit->id, $exit->id], DB::table('trigger_fires')->orderBy('id')->pluck('trigger_id')->all());
    }

    public function test_full_cue_queue_rolls_back_route_events_and_budget_with_a_safe_error(): void
    {
        $region = $this->region(100);
        for ($i = 0; $i < 51; $i++) {
            $this->trigger($region);
        }
        $combat = Combat::create(['scene_id' => $this->scene->id, 'created_by' => $this->gm->id, 'status' => 'active', 'round' => 1]);
        $entry = $combat->combatants()->create(['token_id' => $this->token->id, 'position' => 0]);
        $combat->update(['current_combatant_id' => $entry->id]);
        $this->move(0, [['x' => 200, 'y' => 200]])->assertConflict()->assertJsonPath('message', 'Действие сейчас недоступно.')->assertDontSee('SECRET');
        $this->assertDatabaseCount('trigger_fires', 0);
        $this->assertDatabaseCount('cue_runs', 0);
        $this->assertDatabaseCount('scene_mutation_receipts', 0);
        $this->assertEquals(0, $entry->fresh()->movement_spent);
        $this->assertEquals(0, $this->scene->fresh()->revision);
        $this->assertEquals(0, SceneTrigger::sum('fire_count'));
        Event::assertNotDispatched(TabletopEvent::class);
    }
}
