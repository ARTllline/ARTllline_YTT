<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\Combat;
use App\Models\SceneProp;
use App\Models\User;
use App\Services\MovementCollision;
use App\Services\StructuralGeometry;
use App\Services\StructureData;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class TokenMovementTest extends TestCase
{
    use RefreshDatabase;

    private function fixture(): array
    {
        return json_decode(file_get_contents(base_path('tests/Fixtures/movement.json')), true, flags: JSON_THROW_ON_ERROR);
    }

    public function test_shared_sweeps_use_compiled_structure_and_transformed_props(): void
    {
        $fixture = $this->fixture();
        $collision = new MovementCollision;
        foreach ($fixture['cases'] as $case) {
            $graph = $fixture['graph'];
            $graph['openings'][0]['open'] = ! ($case['closeDoor'] ?? false);
            $graph['openings'][1]['blocksMovement'] = $case['blockWindow'] ?? false;
            $shapes = StructuralGeometry::compile($graph)['shapes'];
            $this->assertSame($case['blocked'], $collision->blocks($case['a'], $case['b'], $case['radius'], $shapes), $case['name']);
        }
        foreach ($fixture['props'] as $case) {
            $prop = new SceneProp(['x' => 250, 'y' => 250, 'rotation' => $case['rotation'], 'scale_x' => $case['scaleX'], 'scale_y' => $case['scaleY'],
                'preset_snapshot' => ['width' => 100, 'height' => 100, 'pivotX' => 0.5, 'pivotY' => 0.5,
                    'collider' => $case['collider'] + ['blocksMovement' => true]]]);
            $shapes = StructuralGeometry::compile(['vertices' => [], 'edges' => []], [$prop])['shapes'];
            $this->assertSame($case['blocked'], $collision->blocks(['x' => 50, 'y' => 250], ['x' => 450, 'y' => 250], 10, $shapes), $case['name']);
            $this->assertFalse($collision->blocks(['x' => 50, 'y' => 100], ['x' => 450, 'y' => 100], 10, $shapes), $case['name']);
        }
    }

    public function test_moves_are_atomic_and_privileged_intents_require_gm(): void
    {
        Event::fake([TabletopEvent::class]);
        $gm = User::factory()->create();
        $player = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Movement']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $campaign->members()->attach($player, ['role' => 'player']);
        $scene = $campaign->scenes()->create(['name' => 'Movement', 'width' => 800, 'height' => 600]);
        $graph = $this->fixture()['graph'];
        $scene->mapWorld()->create(['structure' => $graph]);
        $campaign->forceFill(['active_scene_id' => $scene->id])->save();
        $token = $scene->tokens()->create(['name' => 'Walker', 'x' => 100, 'y' => 150, 'size' => 20, 'owner_user_id' => $player->id]);
        $path = "/api/tokens/{$token->id}";
        $move = fn (array $point) => $this->postJson("$path/move", $point + ['clientMutationId' => (string) Str::uuid()]);
        $this->actingAs($player);
        $move(['x' => 700, 'y' => 150])->assertUnprocessable();
        $this->assertEquals(100, $token->fresh()->x);
        $this->assertEquals(0, $scene->fresh()->revision);
        foreach (['teleport', 'override'] as $intent) {
            $move(['x' => 700, 'y' => 150, 'intent' => $intent])->assertForbidden();
        }
        $this->patchJson($path, ['x' => 700])->assertForbidden();
        $move(['x' => 700, 'y' => 150, 'waypoints' => [['x' => 100, 'y' => 234], ['x' => 700, 'y' => 234]]])
            ->assertOk()->assertJsonPath('token.x', 700)
            ->assertJsonPath('tokenMovements.0.tokenId', (string) $token->id)
            ->assertJsonPath('tokenMovements.0.path', [
                ['x' => 100, 'y' => 150], ['x' => 100, 'y' => 234],
                ['x' => 700, 'y' => 234], ['x' => 700, 'y' => 150],
            ]);
        $this->actingAs($gm);
        $move(['x' => 300, 'y' => 234, 'intent' => 'teleport'])->assertOk()->assertJsonMissingPath('tokenMovements');
        $toggle = fn ($open) => $this->postJson("/api/scenes/{$scene->id}/structure", [
            'door' => ['id' => 'door', 'open' => $open], 'expected' => StructureData::hash(StructureData::graph($scene->fresh())),
            'clientMutationId' => (string) Str::uuid(),
        ]);
        $toggle(false)->assertUnprocessable();
        $move(['x' => 300, 'y' => 150, 'intent' => 'teleport'])->assertUnprocessable();
        $move(['x' => 300, 'y' => 150, 'intent' => 'override'])->assertOk()->assertJsonMissingPath('tokenMovements');
        $move(['x' => 400, 'y' => 150])->assertUnprocessable();
        $move(['x' => 400, 'y' => 234, 'intent' => 'teleport'])->assertOk()->assertJsonMissingPath('tokenMovements');
        $toggle(false)->assertOk();
        $this->actingAs($player);
        $move(['x' => 100, 'y' => 234])->assertUnprocessable();
        $asset = Asset::create(['library_user_id' => $gm->id, 'uploaded_by' => $gm->id, 'kind' => 'prop',
            'name' => 'private barrier', 'original_name' => 'barrier.png', 'storage_path' => 'private/barrier.png',
            'mime_type' => 'image/png', 'file_size' => 100, 'width' => 96, 'height' => 96]);
        $scene->props()->create(['asset_id' => $asset->id, 'is_hidden' => true, 'name' => 'private barrier', 'x' => 500, 'y' => 234,
            'preset_snapshot' => ['width' => 96, 'height' => 96, 'pivotX' => 0.5, 'pivotY' => 0.5,
                'collider' => ['type' => 'circle', 'x' => 48, 'y' => 48, 'radius' => 12, 'blocksMovement' => true]]]);
        $events = Event::dispatched(TabletopEvent::class)->count();
        $move(['x' => 600, 'y' => 234])->assertUnprocessable()
            ->assertDontSee('private barrier')->assertJsonMissingPath('collider');
        $this->assertCount($events, Event::dispatched(TabletopEvent::class));
        $this->getJson("/api/scenes/{$scene->id}/snapshot")->assertOk()
            ->assertJsonCount(0, 'props')
            ->assertJsonPath('structure.graph.edges.0.blocksMovement', true)
            ->assertJsonMissingPath('structure.graph.edges.0.blocksVision');
        $this->assertEquals(400, $token->fresh()->x);
    }

    public function test_group_routes_follow_visibility_and_receipts(): void
    {
        Event::fake([TabletopEvent::class]);
        $gm = User::factory()->create();
        $player = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Routes']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $campaign->members()->attach($player, ['role' => 'player']);
        $scene = $campaign->scenes()->create(['name' => 'Routes']);
        $campaign->forceFill(['active_scene_id' => $scene->id])->save();
        $public = $scene->tokens()->create(['name' => 'Public', 'x' => 100, 'y' => 100]);
        $hidden = $scene->tokens()->create(['name' => 'Secret', 'x' => 100, 'y' => 200, 'is_hidden' => true]);
        $data = [
            'action' => 'move', 'anchorKind' => 'token', 'anchorId' => $public->id,
            'x' => 200, 'y' => 100, 'tokenIds' => [$public->id, $hidden->id], 'propIds' => [],
            'clientMutationId' => (string) Str::uuid(),
        ];
        $url = "/api/scenes/{$scene->id}/selection";
        $accepted = $this->actingAs($gm)->postJson($url, $data)->assertOk()->assertJsonCount(2, 'tokenMovements');
        $this->postJson($url, $data)->assertOk()->assertExactJson($accepted->json());
        $events = Event::dispatched(TabletopEvent::class)->map(fn ($args) => $args[0]);
        $viewer = $events->filter(fn ($event) => str_ends_with($event->channel, ".user.{$player->id}"))->sole();
        $this->assertSame([(string) $public->id], array_column($viewer->envelope['payload']['tokenMovements'], 'tokenId'));
        $this->assertSame($accepted->json('revision'), $viewer->envelope['revision']);
        $this->assertEquals(200, $hidden->fresh()->x);
        $this->getJson("/api/scenes/{$scene->id}/snapshot")->assertOk()->assertJsonMissingPath('tokenMovements');
    }

    public function test_waypoint_budget_and_group_rejection_are_atomic(): void
    {
        Event::fake([TabletopEvent::class]);
        $gm = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Budget']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $scene = $campaign->scenes()->create(['name' => 'Budget', 'grid_size' => 60, 'distance_per_cell' => 5]);
        $scene->mapWorld()->create(['structure' => $this->fixture()['graph']]);
        $token = $scene->tokens()->create(['name' => 'Walker', 'x' => 100, 'y' => 150, 'size' => 20, 'speed' => 10]);
        $other = $scene->tokens()->create(['name' => 'Other', 'x' => 100, 'y' => 200, 'size' => 20]);
        $combat = Combat::create(['scene_id' => $scene->id, 'created_by' => $gm->id, 'status' => 'active', 'round' => 1]);
        $entry = $combat->combatants()->create(['token_id' => $token->id, 'position' => 0]);
        $combat->update(['current_combatant_id' => $entry->id]);
        $this->actingAs($gm);
        $move = fn (array $point) => $this->postJson("/api/tokens/{$token->id}/move", $point + ['clientMutationId' => (string) Str::uuid()]);
        $move(['x' => 200, 'y' => 150, 'waypoints' => [['x' => 100, 'y' => 230]]])->assertUnprocessable();
        $this->assertEquals(0, $entry->fresh()->movement_spent);
        $this->postJson("/api/scenes/{$scene->id}/selection", [
            'action' => 'move', 'anchorKind' => 'token', 'anchorId' => $token->id, 'x' => 200, 'y' => 150,
            'tokenIds' => [$token->id, $other->id], 'propIds' => [], 'clientMutationId' => (string) Str::uuid(),
        ])->assertUnprocessable();
        $this->assertEquals(100, $token->fresh()->x);
        $this->assertEquals(0, $entry->fresh()->movement_spent);
        $this->patchJson("/api/tokens/{$token->id}", ['x' => 240])->assertOk();
        $move(['x' => 330, 'y' => 150])->assertUnprocessable();
        $this->assertEquals(240, $token->fresh()->x);
        $this->assertEquals(0, $entry->fresh()->movement_spent);
        $this->assertDatabaseMissing('combat_events', ['combat_id' => $combat->id, 'type' => 'movement.spent']);
        $this->patchJson("/api/tokens/{$token->id}", ['x' => 100])->assertOk();
        $move(['x' => 220, 'y' => 150])->assertOk();
        $this->assertEquals(10, $entry->fresh()->movement_spent);
        $move(['x' => 221, 'y' => 150])->assertUnprocessable();
        $move(['x' => 400, 'y' => 150, 'intent' => 'override'])->assertOk()->assertJsonMissingPath('tokenMovements');
        $this->assertEquals(10, $entry->fresh()->movement_spent);
    }
}
