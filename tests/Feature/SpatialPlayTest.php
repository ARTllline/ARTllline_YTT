<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\Scene;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class SpatialPlayTest extends TestCase
{
    use DatabaseMigrations;

    private User $gm;

    private User $player;

    private Scene $scene;

    private Campaign $campaign;

    protected function setUp(): void
    {
        parent::setUp();
        $this->gm = User::factory()->create();
        $this->player = User::factory()->create();
        $this->campaign = Campaign::create(['name' => 'Spatial']);
        $this->campaign->members()->attach($this->gm, ['role' => 'gm']);
        $this->campaign->members()->attach($this->player, ['role' => 'player']);
        $this->scene = $this->campaign->scenes()->create(['name' => 'Crossing']);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->scene->tokens()->create(['name' => 'SECRET DRAGON', 'x' => 30, 'y' => 30, 'is_hidden' => true]);
        Event::fake([TabletopEvent::class]);
    }

    private function stroke(): array
    {
        return ['clientMutationId' => (string) Str::uuid(), 'operation' => 'reveal', 'shape' => 'brush', 'geometry' => ['points' => [['x' => 100.5, 'y' => 200], ['x' => 300, 'y' => 220]], 'radius' => 90]];
    }

    private function overlay(string $kind = 'ruler'): array
    {
        return ['kind' => $kind, 'sessionId' => (string) Str::uuid(), 'startedAt' => 123456, 'sequence' => 1, 'phase' => 'end', 'epoch' => 0, 'start' => ['x' => 30, 'y' => 30], 'end' => ['x' => 390, 'y' => 30]];
    }

    public function test_fog_is_authorized_idempotent_filtered_and_reset_compacts(): void
    {
        $path = '/api/scenes/'.$this->scene->id.'/fog/';
        $stroke = $this->stroke();
        $this->actingAs($this->player)->postJson($path.'actions', $stroke)->assertForbidden();
        $this->postJson($path.'reset', ['base' => 'covered'])->assertForbidden();
        $this->actingAs(User::factory()->create())->postJson($path.'actions', $stroke)->assertForbidden();
        $first = $this->actingAs($this->gm)->postJson($path.'actions', $stroke)->assertOk()->assertJsonPath('revision', 1)->json();
        $this->postJson($path.'actions', $stroke)->assertOk()->assertExactJson($first);
        $this->assertDatabaseCount('fog_actions', 1);
        $this->assertSame(1, $this->scene->fresh()->revision);
        $playerEvents = Event::dispatched(TabletopEvent::class)->pluck(0)->filter(fn ($event) => str_contains($event->channel, '.user.'));
        $this->assertCount(1, $playerEvents);
        $serialized = json_encode($playerEvents);
        $this->assertStringNotContainsString('SECRET DRAGON', $serialized);
        $this->assertStringNotContainsString('created_by', $serialized);
        $snapshot = $this->actingAs($this->player)->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk()->json();
        $this->assertSame([], $snapshot['tokens']);
        $this->assertSame($first['fogAction'], $snapshot['fog']['actions'][0]);
        $reset = ['base' => 'covered', 'clientMutationId' => (string) Str::uuid()];
        $this->actingAs($this->gm)->postJson($path.'reset', $reset)->assertOk()->assertJsonPath('revision', 2);
        $this->postJson($path.'reset', $reset)->assertOk()->assertJsonPath('revision', 2);
        $this->assertDatabaseCount('fog_actions', 0);
        $this->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertJsonPath('fog', ['base' => 'covered', 'actions' => []]);
    }

    public function test_fog_geometry_bounds_and_inactive_publication(): void
    {
        $this->actingAs($this->gm);
        $path = '/api/scenes/'.$this->scene->id.'/fog/actions';
        $stroke = $this->stroke();
        $stroke['geometry']['radius'] = 9999;
        $this->postJson($path, $stroke)->assertUnprocessable();
        $stroke = $this->stroke();
        $stroke['geometry']['points'] = array_fill(0, 513, ['x' => 0, 'y' => 0]);
        $this->postJson($path, $stroke)->assertUnprocessable();
        $this->assertSame(0, $this->scene->fresh()->revision);
        $this->campaign->forceFill(['active_scene_id' => null])->save();
        $stroke = $this->stroke();
        $stroke['shape'] = 'rectangle';
        unset($stroke['geometry']['radius']);
        $this->postJson($path, $stroke)->assertOk();
        Event::assertDispatchedTimes(TabletopEvent::class, 1);
        Event::assertDispatched(TabletopEvent::class, fn ($event) => str_ends_with($event->channel, '.gm'));
    }

    public function test_spatial_is_ephemeral_attributed_authorized_and_epoch_scoped(): void
    {
        $path = '/api/scenes/'.$this->scene->id.'/spatial';
        $this->actingAs(User::factory()->create())->postJson($path, $this->overlay())->assertForbidden();
        foreach (['ruler', 'circle', 'cone', 'rectangle', 'ping'] as $kind) {
            $this->actingAs($this->player)->postJson($path, $this->overlay($kind) + ['participant' => ['id' => 'fake', 'name' => 'FAKE']])->assertOk();
        }
        $this->assertSame(0, $this->scene->fresh()->revision);
        $this->assertDatabaseCount('scene_mutation_receipts', 0);
        $this->assertDatabaseCount('fog_actions', 0);
        Event::assertDispatchedTimes(TabletopEvent::class, 5);
        Event::assertDispatched(TabletopEvent::class, fn ($event) => count($event->broadcastOn()) === 2 && count($event->additionalChannels) === 1);
        $events = json_encode(Event::dispatched(TabletopEvent::class));
        $this->assertStringNotContainsString('FAKE', $events);
        $this->assertStringNotContainsString('SECRET DRAGON', $events);
        $this->campaign->forceFill(['live_revision' => 1])->save();
        $this->postJson($path, $this->overlay())->assertConflict();
        $this->campaign->forceFill(['active_scene_id' => null])->save();
        $this->actingAs($this->gm)->postJson($path, $this->overlay())->assertForbidden();
    }

    public function test_ping_allows_double_ping_but_limits_spam(): void
    {
        $this->freezeTime();
        $path = '/api/scenes/'.$this->scene->id.'/spatial';
        $this->actingAs($this->player);
        for ($i = 0; $i < 4; $i++) {
            $this->postJson($path, $this->overlay('ping'))->assertOk();
        }
        $this->postJson($path, $this->overlay('ping'))->assertStatus(429);
        $this->assertSame(0, $this->scene->fresh()->revision);
    }

    public function test_grid_units_persist_and_receipt_cleanup_respects_window(): void
    {
        $this->actingAs($this->gm)->putJson('/api/scenes/'.$this->scene->id.'/grid', ['size' => 60, 'offset' => ['x' => 0, 'y' => 0], 'visible' => true, 'snap' => true, 'distancePerCell' => 1.5, 'distanceUnit' => 'm'])->assertOk()->assertJsonPath('grid.distancePerCell', 1.5)->assertJsonPath('grid.distanceUnit', 'm');
        $this->postJson('/api/scenes/'.$this->scene->id.'/fog/actions', $this->stroke())->assertOk();
        $old = DB::table('scene_mutation_receipts')->first()->id;
        DB::table('scene_mutation_receipts')->where('id', $old)->update(['created_at' => now()->subDays(8)]);
        $this->artisan('tabletop:prune-receipts --dry-run')->assertSuccessful();
        $this->assertDatabaseCount('scene_mutation_receipts', 2);
        $this->artisan('tabletop:prune-receipts')->assertSuccessful();
        $this->assertDatabaseCount('scene_mutation_receipts', 1);
        $this->assertDatabaseMissing('scene_mutation_receipts', ['id' => $old]);
        $this->assertSame(2, $this->scene->fresh()->revision);
    }
}
