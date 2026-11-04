<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\Combat;
use App\Models\User;
use App\Services\StructureData;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class ClickToMoveTest extends TestCase
{
    use RefreshDatabase;

    public function test_player_navigation_contains_only_public_movement_silhouettes_in_snapshots_and_events(): void
    {
        Event::fake([TabletopEvent::class]);
        $gm = User::factory()->create();
        $player = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Navigation']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $campaign->members()->attach($player, ['role' => 'player']);
        $scene = $campaign->scenes()->create(['name' => 'Navigation']);
        $campaign->forceFill(['active_scene_id' => $scene->id])->save();
        $graph = json_decode(file_get_contents(base_path('tests/Fixtures/movement.json')), true)['graph'];
        $scene->mapWorld()->create(['structure' => $graph]);
        $asset = Asset::create(['library_user_id' => $gm->id, 'uploaded_by' => $gm->id, 'kind' => 'prop',
            'name' => 'Table', 'original_name' => 'table.png', 'storage_path' => 'private/table.png',
            'mime_type' => 'image/png', 'file_size' => 100, 'width' => 100, 'height' => 100]);
        $data = ['asset_id' => $asset->id, 'name' => 'Table', 'x' => 200, 'y' => 200, 'rotation' => 90,
            'scale_x' => 2, 'scale_y' => 0.5, 'preset_snapshot' => ['width' => 100, 'height' => 100,
                'pivotX' => 0.5, 'pivotY' => 0.5, 'name' => 'GM-only preset', 'tags' => ['secret'],
                'collider' => ['type' => 'circle', 'x' => 50, 'y' => 50, 'radius' => 20,
                    'blocksMovement' => true, 'blocksVision' => true, 'blocksLight' => false]]];
        $prop = $scene->props()->create($data);
        $hidden = $scene->props()->create(['is_hidden' => true, 'name' => 'Hidden barrier'] + $data);
        $this->actingAs($player)->getJson("/api/scenes/{$scene->id}/snapshot")->assertOk()
            ->assertJsonCount(1, 'props')->assertJsonPath('props.0.movementObstacle.rx', 40)
            ->assertJsonPath('props.0.movementObstacle.ry', 10)
            ->assertJsonMissingPath('props.0.collider')->assertJsonMissingPath('props.0.preset')
            ->assertJsonMissingPath('props.0.movementObstacle.blocksVision')
            ->assertJsonPath('structure.graph.edges.0.blocksMovement', true)
            ->assertJsonMissingPath('structure.graph.edges.0.blocksVision')
            ->assertJsonMissingPath('structure.graph.openings.0.locked')
            ->assertDontSee('Hidden barrier')->assertDontSee('GM-only preset');
        $this->actingAs($gm)->postJson("/api/scenes/{$scene->id}/props", [
            'action' => 'update', 'id' => $prop->id, 'patch' => ['x' => 220], 'clientMutationId' => (string) Str::uuid(),
        ])->assertOk();
        Event::assertDispatched(TabletopEvent::class, fn ($event) => str_contains($event->channel, '.user.')
            && ($event->envelope['payload']['props'][0]['movementObstacle']['center']['x'] ?? null) === 220.0);
        Event::assertNotDispatched(TabletopEvent::class, fn ($event) => str_contains($event->channel, '.user.')
            && preg_match('/Hidden barrier|GM-only preset|blocksVision|blocksLight|"preset"|"collider"/', json_encode($event->envelope)));
        $this->assertNotSame($prop->id, $hidden->id);
        // Movement-flag edits invalidate the public graph hash, even without visual edits.
        $before = StructureData::projection($scene->fresh(), false)['hash'];
        $graph['openings'][1]['blocksMovement'] = true;
        $scene->mapWorld->update(['structure' => $graph]);
        $this->assertNotSame($before, StructureData::projection($scene->fresh(), false)['hash']);
    }

    public function test_routed_player_combat_is_atomic_idempotent_and_cannot_bypass_turn_or_waypoint_limits(): void
    {
        Event::fake([TabletopEvent::class]);
        $player = User::factory()->create();
        $other = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Routed combat']);
        $campaign->members()->attach($player, ['role' => 'player']);
        $campaign->members()->attach($other, ['role' => 'player']);
        $scene = $campaign->scenes()->create(['name' => 'Combat', 'grid_size' => 60, 'distance_per_cell' => 5]);
        $scene->mapWorld()->create([]);
        $campaign->forceFill(['active_scene_id' => $scene->id])->save();
        $token = $scene->tokens()->create(['name' => 'Walker', 'x' => 100, 'y' => 100, 'size' => 20,
            'speed' => 10, 'owner_user_id' => $player->id]);
        $otherToken = $scene->tokens()->create(['name' => 'Other', 'x' => 300, 'y' => 300, 'owner_user_id' => $other->id]);
        $combat = Combat::create(['scene_id' => $scene->id, 'created_by' => $player->id, 'status' => 'active', 'round' => 1]);
        $entry = $combat->combatants()->create(['token_id' => $token->id, 'position' => 0]);
        $next = $combat->combatants()->create(['token_id' => $otherToken->id, 'position' => 1]);
        $combat->update(['current_combatant_id' => $next->id]);
        $url = "/api/tokens/{$token->id}/move";
        $data = ['x' => 160, 'y' => 140, 'waypoints' => [['x' => 100, 'y' => 140]], 'clientMutationId' => (string) Str::uuid()];
        $this->actingAs($other)->postJson($url, $data)->assertForbidden();
        $this->actingAs($player)->postJson($url, $data)->assertUnprocessable();
        $this->assertEquals(0, $entry->fresh()->movement_spent);
        $combat->update(['current_combatant_id' => $entry->id]);
        $data['clientMutationId'] = (string) Str::uuid();
        $accepted = $this->postJson($url, $data)->assertOk()
            ->assertJsonPath('tokenMovements.0.path.1', ['x' => 100, 'y' => 140])->json();
        $spent = $entry->fresh()->movement_spent;
        $this->assertEquals(8.3334, $spent);
        $this->postJson($url, $data)->assertOk()->assertJsonPath('revision', $accepted['revision']);
        $this->assertEquals($spent, $entry->fresh()->movement_spent);
        $this->postJson($url, ['x' => 190, 'y' => 140, 'clientMutationId' => (string) Str::uuid()])->assertUnprocessable();
        $this->postJson($url, ['x' => 170, 'y' => 140, 'waypoints' => array_fill(0, 17, ['x' => 160, 'y' => 140]),
            'clientMutationId' => (string) Str::uuid()])->assertUnprocessable();
        $this->assertEquals(160, $token->fresh()->x);
        $this->assertEquals($spent, $entry->fresh()->movement_spent);
    }
}
