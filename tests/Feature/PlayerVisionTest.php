<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\Combat;
use App\Models\LootContainer;
use App\Models\User;
use App\Policies\AssetPolicy;
use App\Services\AbilityGeometry;
use App\Services\CombatView;
use App\Services\LineOfSight;
use App\Services\PreloadService;
use App\Services\SceneVisibility;
use App\Services\StructuralGeometry;
use App\Services\StructureData;
use App\Services\VisibilityPolygon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class PlayerVisionTest extends TestCase
{
    use RefreshDatabase;

    private function fixture(): array
    {
        Event::fake([TabletopEvent::class]);
        $gm = User::factory()->create();
        $p1 = User::factory()->create();
        $p2 = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Vision']);
        foreach ([[$gm, 'gm'], [$p1, 'player'], [$p2, 'player']] as [$u, $role]) {
            $campaign->members()->attach($u, ['role' => $role]);
        }
        $scene = $campaign->scenes()->create(['name' => 'Vision', 'width' => 800, 'height' => 600, 'vision_enabled' => true]);
        $campaign->forceFill(['active_scene_id' => $scene->id, 'live_revision' => 1])->save();
        // Use a single full-height wall with a configurable central door.
        $graph = ['vertices' => [['id' => 'a', 'x' => 400, 'y' => 20], ['id' => 'b', 'x' => 400, 'y' => 580]],
            'edges' => [['id' => 'wall', 'a' => 'a', 'b' => 'b', 'thickness' => 16, 'blocksMovement' => true,
                'blocksVision' => true, 'blocksLight' => false, 'materialVersionId' => null]], 'rooms' => [],
            'openings' => [['id' => 'door', 'edgeId' => 'wall', 'type' => 'door', 'center' => .5, 'width' => 100, 'open' => false, 'locked' => false, 'frame' => 'wood']]];
        $scene->mapWorld()->create(['structure' => $graph]);
        $a = $scene->tokens()->create(['name' => 'A', 'kind' => 'player_character', 'owner_user_id' => $p1->id, 'x' => 200, 'y' => 300, 'vision_range' => 500]);
        $b = $scene->tokens()->create(['name' => 'B', 'kind' => 'player_character', 'owner_user_id' => $p2->id, 'x' => 600, 'y' => 300, 'vision_range' => 500]);
        $npc = $scene->tokens()->create(['name' => 'Private NPC', 'x' => 620, 'y' => 300]);
        $secret = $scene->tokens()->create(['name' => 'GM hidden', 'x' => 220, 'y' => 300, 'is_hidden' => true]);

        return compact('gm', 'p1', 'p2', 'scene', 'campaign', 'a', 'b', 'npc', 'secret', 'graph');
    }

    public function test_snapshots_360_union_range_and_gm_hidden_priority(): void
    {
        extract($this->fixture());
        $url = "/api/scenes/{$scene->id}/snapshot";
        $data = $this->actingAs($p1)->getJson($url)->assertOk()->assertJsonPath('vision.enabled', true)->assertJsonCount(1, 'tokens')->assertJsonCount(1, 'vision.polygons')->json();
        $this->assertStringNotContainsString('Private NPC', json_encode($data));
        $this->assertArrayNotHasKey('geometryKey', $data['vision']);
        $second = $this->actingAs($p2)->getJson($url)->assertOk()->assertJsonCount(2, 'tokens')->json('vision.polygons');
        $this->assertTrue(array_is_list($second), 'Every recipient gets a JSON array, including a non-first observer');
        $this->actingAs($gm)->getJson($url)->assertOk()->assertJsonCount(4, 'tokens')->assertJsonCount(0, 'vision.polygons');
        $this->actingAs($gm)->patchJson("/api/tokens/{$a->id}", ['rotation' => 173, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $rotated = $this->actingAs($p1)->getJson($url)->assertOk()->json('vision');
        $this->assertEquals($data['vision'], $rotated);
        $this->actingAs($gm)->patchJson("/api/tokens/{$b->id}", ['owner_user_id' => $p1->id, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->actingAs($p1)->getJson($url)->assertOk()->assertJsonCount(3, 'tokens')->assertJsonCount(2, 'vision.polygons');
        $this->actingAs($p2)->getJson($url)->assertOk()->assertJsonCount(0, 'tokens')->assertJsonCount(0, 'vision.polygons');
    }

    public function test_door_reveals_and_conceals_recipient_safe_incremental_entities(): void
    {
        extract($this->fixture());
        $path = "/api/scenes/{$scene->id}/structure";
        foreach ([true, false] as $open) {
            Event::fake([TabletopEvent::class]);
            $this->actingAs($gm)->postJson($path, ['door' => ['id' => 'door', 'open' => $open],
                'expected' => StructureData::hash(StructureData::graph($scene->fresh())), 'clientMutationId' => (string) Str::uuid()])->assertOk();
            $events = Event::dispatched(TabletopEvent::class)->map(fn ($args) => $args[0]);
            $event = $events->first(fn ($e) => str_ends_with($e->channel, '.user.'.$p1->id));
            $this->assertNotNull($event);
            $payload = $event->envelope['payload'];
            $this->assertArrayHasKey('vision', $payload);
            $this->assertArrayNotHasKey('scene', $payload);
            if ($open) {
                $this->assertContains((string) $npc->id, array_column($payload['tokens'], 'id'));
            } else {
                $this->assertContains((string) $npc->id, $payload['deletedIds']);
                $this->assertStringNotContainsString('Private NPC', json_encode($payload));
            }
            $this->assertStringNotContainsString('GM hidden', json_encode($payload));
            $this->assertStringNotContainsString('blocksVision', json_encode($payload));
        }
    }

    public function test_player_opens_and_closes_visible_door_and_receives_its_own_visibility_delta(): void
    {
        extract($this->fixture());
        $this->actingAs($p1);
        $url = "/api/scenes/{$scene->id}/structure";
        $toggle = fn (bool $open, string $hash) => $this->postJson($url, [
            'opening' => ['id' => 'door', 'open' => $open], 'expected' => $hash, 'clientMutationId' => (string) Str::uuid(),
        ]);
        $hash = StructureData::hash($graph, false);
        $opened = $toggle(true, $hash)->assertOk()
            ->assertJsonPath('structurePatch.openings.upsert.0.open', true)
            ->assertJsonMissingPath('structurePatch.openings.upsert.0.locked')
            ->assertJsonMissingPath('structureEdit')
            ->assertJsonPath('vision.enabled', true)->json();
        $this->assertContains((string) $npc->id, array_column($opened['tokens'], 'id'));
        $closed = $toggle(false, $opened['structurePatch']['hash'])->assertOk()->json();
        $this->assertContains((string) $npc->id, $closed['deletedIds']);
        $visionUrl = "/api/scenes/{$scene->id}/vision";
        $range = fn (int $range) => $this->actingAs($gm)->postJson($visionUrl, [
            'enabled' => true, 'observerId' => $a->id, 'range' => $range, 'clientMutationId' => (string) Str::uuid(),
        ])->assertOk();
        $range(50);
        $this->actingAs($p1);
        $toggle(true, $closed['structurePatch']['hash'])->assertForbidden();
        $range(500);
        $this->actingAs($gm)->postJson($url, [
            'door' => ['id' => 'door', 'locked' => true], 'expected' => StructureData::hash($graph),
            'clientMutationId' => (string) Str::uuid(),
        ])->assertOk();
        $this->actingAs($p1);
        $toggle(true, $closed['structurePatch']['hash'])->assertUnprocessable();
    }

    public function test_settings_permissions_and_movement_response_update_vision(): void
    {
        extract($this->fixture());
        $path = "/api/scenes/{$scene->id}/vision";
        $this->actingAs($p1)->postJson($path, ['enabled' => false, 'clientMutationId' => (string) Str::uuid()])->assertForbidden();
        $this->actingAs($gm)->postJson($path, ['enabled' => true, 'observerId' => $a->id, 'range' => 90, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->assertEquals(90, $a->fresh()->vision_range);
        $response = $this->actingAs($p1)->postJson("/api/tokens/{$a->id}/move", ['x' => 240, 'y' => 300, 'clientMutationId' => (string) Str::uuid()])->assertOk()->assertJsonPath('token.x', 240)->assertJsonPath('vision.enabled', true)->json();
        $this->assertStringNotContainsString('Private NPC', json_encode($response));
        $snapshot = $this->getJson("/api/scenes/{$scene->id}/snapshot")->assertOk()->json();
        $this->assertEquals($snapshot['vision'], $response['vision']);
    }

    public function test_movement_and_projection_churn_are_distinct_from_actual_obstacle_edits(): void
    {
        extract($this->fixture());
        $this->actingAs($p1)->postJson("/api/tokens/{$a->id}/move", ['x' => 220, 'y' => 300,
            'clientMutationId' => (string) Str::uuid()])->assertOk()->assertJsonPath('movementGeometryChanged', false);
        $this->actingAs($gm)->postJson("/api/scenes/{$scene->id}/structure", ['door' => ['id' => 'door', 'open' => true],
            'expected' => StructureData::hash(StructureData::graph($scene->fresh())),
            'clientMutationId' => (string) Str::uuid()])->assertOk()->assertJsonPath('movementGeometryChanged', true);
        $this->actingAs($gm)->patchJson("/api/tokens/{$a->id}", ['rotation' => 90,
            'clientMutationId' => (string) Str::uuid()])->assertOk()->assertJsonPath('movementGeometryChanged', false);
    }

    public function test_movement_batches_loot_reads_for_a_dense_scene_and_keeps_occluded_props_private(): void
    {
        extract($this->fixture());
        for ($i = 0; $i < 75; $i++) {
            $prop = $scene->props()->create(['name' => "Prop $i", 'x' => $i < 50 ? 280 : 520, 'y' => 240 + $i]);
            if ($i === 0 || $i === 50) {
                LootContainer::create(['scene_id' => $scene->id, 'prop_id' => $prop->id,
                    'name' => "Chest $i", 'created_by' => $gm->id]);
            }
        }

        $this->actingAs($p1)->getJson("/api/scenes/{$scene->id}/snapshot")->assertOk()
            ->assertJsonCount(50, 'props')->assertJsonPath('props.0.loot.name', 'Chest 0')
            ->assertJsonMissing(['name' => 'Chest 50']);
        DB::enableQueryLog();
        try {
            $this->postJson("/api/tokens/{$a->id}/move", ['x' => 220, 'y' => 300,
                'clientMutationId' => (string) Str::uuid()])->assertOk()
                ->assertJsonPath('token.x', 220)
                ->assertJsonCount(0, 'props')->assertJsonCount(0, 'deletedPropIds')
                ->assertJsonMissing(['name' => 'Chest 50']);
            $lootReads = array_filter(DB::getQueryLog(), fn ($query) =>
                str_contains($query['query'], 'loot_containers') && str_contains($query['query'], 'prop_id'));
            $this->assertLessThanOrEqual(4, count($lootReads), 'At most one prop loot read per viewer and revision');
        } finally {
            DB::disableQueryLog();
            DB::flushQueryLog();
        }
    }

    public function test_unseen_interaction_and_preview_are_denied(): void
    {
        extract($this->fixture());
        $this->actingAs($p1)->postJson("/api/scenes/{$scene->id}/interact", ['kind' => 'token', 'id' => $npc->id,
            'epoch' => $campaign->live_revision, 'clientMutationId' => (string) Str::uuid()])->assertNotFound();
        $this->assertFalse(app(SceneVisibility::class)->allows($npc, $p1));
        $this->assertTrue(app(SceneVisibility::class)->allows($npc, $gm));
    }

    public function test_assets_preload_combat_and_receipt_replay_do_not_bypass_vision(): void
    {
        extract($this->fixture());
        $asset = Asset::create(['library_user_id' => $gm->id, 'uploaded_by' => $gm->id, 'kind' => 'token', 'name' => 'NPC image',
            'original_name' => 'npc.png', 'storage_path' => 'private/npc.png', 'mime_type' => 'image/png', 'file_size' => 100, 'width' => 100, 'height' => 100]);
        $npc->update(['token_image_asset_id' => $asset->id]);
        $this->assertFalse(app(AssetPolicy::class)->view($p1, $asset));
        $this->assertTrue(app(AssetPolicy::class)->view($p2, $asset));
        $this->actingAs($p1)->getJson("/api/assets/{$asset->id}")->assertForbidden();
        $preload = app(PreloadService::class);
        $preload->start($gm, $campaign, $scene->id, false);
        $this->assertSame([], $preload->manifest($campaign)['resources']);
        $this->assertFalse($preload->authorized($campaign, $asset));
        $combat = Combat::create(['scene_id' => $scene->id, 'status' => 'active', 'round' => 1, 'created_by' => $gm->id]);
        $entry = $combat->combatants()->create(['token_id' => $npc->id, 'position' => 0]);
        $combat->update(['current_combatant_id' => $entry->id]);
        $dto = app(CombatView::class)->build($scene, false, $p1);
        $this->assertSame([], $dto['combatants']);
        $this->assertSame(['gmHiddenTurn' => true], $dto['currentTurn']);
        $combat->update(['status' => 'ended']);
        $id = (string) Str::uuid();
        $move = ['x' => 240, 'y' => 300, 'clientMutationId' => $id];
        $this->actingAs($p1)->postJson("/api/tokens/{$a->id}/move", $move)->assertOk();
        $this->actingAs($gm)->postJson("/api/scenes/{$scene->id}/vision", ['enabled' => true, 'observerId' => $a->id, 'range' => 50, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->actingAs($p1)->postJson("/api/tokens/{$a->id}/move", $move)->assertConflict();
    }

    public function test_targeting_unseen_npc_is_rejected_before_execution(): void
    {
        extract($this->fixture());
        $ability = ['id' => (string) Str::uuid(), 'name' => 'Test', 'icon' => 'flame', 'description' => '', 'category' => 'attack', 'target' => 'token',
            'check' => ['stat_key' => 'str', 'modifier' => 0, 'dc' => 12, 'dc_visible' => false, 'defense' => 'ac'], 'costs' => [], 'damage' => '1d6',
            'result' => ['type' => 'nothing', 'target' => null, 'amount' => 0], 'sort_order' => 0, 'enabled' => true];
        $a->update(['abilities' => [$ability]]);
        $this->actingAs($p1)->postJson("/api/scenes/{$scene->id}/abilities/execute", ['actorTokenId' => $a->id, 'abilityId' => $ability['id'], 'epoch' => 1,
            'target' => ['kind' => 'token', 'id' => $npc->id], 'rollMode' => 'normal', 'clientMutationId' => (string) Str::uuid()])->assertNotFound();
        $this->assertDatabaseCount('ability_executions', 0);
        $candidates = app(AbilityGeometry::class)->validate($scene->fresh(),
            ['target' => 'point', 'area' => ['shape' => 'circle', 'size' => 100]], $a, null, ['x' => 620, 'y' => 300], $p1);
        $this->assertSame([$a->id], array_map(fn ($t) => $t->id, $candidates));
    }

    public function test_polygon_matches_exact_los_at_corners_and_narrow_apertures(): void
    {
        $fixture = json_decode(file_get_contents(base_path('tests/Fixtures/los.json')), true);
        $compiled = StructuralGeometry::compile($fixture['graph']);
        $los = new LineOfSight($compiled);
        $builder = new VisibilityPolygon($compiled);
        foreach ($fixture['cases'] as $case) {
            $polygon = $builder->build($case['a'], 1200, 2000, 2000);
            if (! $los->point($case['a'], $case['a'])['visible']) {
                $this->assertSame([], $polygon);

                continue;
            }
            mt_srand(808);
            for ($i = 0; $i < 300; $i++) {
                $sample = ['x' => mt_rand(0, 10000) / 10, 'y' => mt_rand(0, 7000) / 10];
                $inside = false;
                $nearest = INF;
                $previous = $polygon[count($polygon) - 1];
                foreach ($polygon as $p) {
                    if (($p['y'] > $sample['y']) !== ($previous['y'] > $sample['y']) && $sample['x'] < $p['x'] + ($previous['x'] - $p['x']) * ($sample['y'] - $p['y']) / ($previous['y'] - $p['y'])) {
                        $inside = ! $inside;
                    }
                    $dx = $p['x'] - $previous['x'];
                    $dy = $p['y'] - $previous['y'];
                    $length = $dx * $dx + $dy * $dy;
                    $t = $length > 0 ? max(0, min(1, (($sample['x'] - $previous['x']) * $dx + ($sample['y'] - $previous['y']) * $dy) / $length)) : 0;
                    $nearest = min($nearest, hypot($sample['x'] - $previous['x'] - $t * $dx, $sample['y'] - $previous['y'] - $t * $dy));
                    $previous = $p;
                }
                if ($nearest > .3) {
                    $this->assertSame($los->point($case['a'], $sample, 1200)['visible'], $inside, $case['name'].' polygon interior '.json_encode($sample));
                }
            }
            // Boundary points use exact LOS: polygon is a visual approximation, never authorization.
            foreach ($polygon as $p) {
                $distance = hypot($p['x'] - $case['a']['x'], $p['y'] - $case['a']['y']);
                $this->assertLessThanOrEqual(1200.00001, $distance);
                $this->assertTrue($los->point($case['a'], $p)['visible'], $case['name'].' polygon ray');
            }
        }
        $origin = ['x' => 100, 'y' => 100];
        $circle = (new VisibilityPolygon(['shapes' => []]))->build($origin, 50, 800, 600);
        foreach ($circle as $p) {
            $this->assertEqualsWithDelta(50, hypot($p['x'] - 100, $p['y'] - 100), .001);
        }
        $this->assertSame([], $builder->build($origin, 0, 800, 600));
    }

    public function test_diagonal_narrow_jambs_and_rotated_curved_prop_silhouettes(): void
    {
        $contains = static function ($polygon, $sample) {
            $inside = false;
            $previous = $polygon[count($polygon) - 1];
            foreach ($polygon as $p) {
                if (($p['y'] > $sample['y']) !== ($previous['y'] > $sample['y'])
                    && $sample['x'] < $p['x'] + ($previous['x'] - $p['x']) * ($sample['y'] - $p['y']) / ($previous['y'] - $p['y'])) {
                    $inside = ! $inside;
                }
                $previous = $p;
            }

            return $inside;
        };
        $world = static fn ($along, $normal) => ['x' => 200 + ($along + $normal) / sqrt(2), 'y' => 200 + ($along - $normal) / sqrt(2)];
        foreach ([20, .05] as $width) {
            $graph = ['vertices' => [['id' => 'a', 'x' => 100, 'y' => 100], ['id' => 'b', 'x' => 300, 'y' => 300]],
                'edges' => [['id' => 'w', 'a' => 'a', 'b' => 'b', 'thickness' => 20, 'materialVersionId' => null,
                    'blocksMovement' => false, 'blocksVision' => true, 'blocksLight' => false]], 'rooms' => [],
                'openings' => [['id' => 'gap', 'edgeId' => 'w', 'type' => 'door', 'center' => .5, 'width' => $width, 'open' => true]]];
            $compiled = StructuralGeometry::compile($graph);
            $los = new LineOfSight($compiled);
            $builder = new VisibilityPolygon($compiled);
            foreach ([0, $width / 2 - .0002, $width / 2 + .0002] as $along) {
                $origin = $world($along, -100);
                $target = $world($along, 100);
                $visible = $los->point($origin, $target)['visible'];
                $this->assertSame($along < $width / 2, $visible);
                $this->assertSame($visible, $contains($builder->build($origin, 600, 800, 600), $target), 'Diagonal aperture '.$width.' / '.$along);
            }
        }
        $shapes = [['id' => 'ellipse', 'source' => 'prop', 'kind' => 'ellipse', 'center' => ['x' => 250, 'y' => 250],
            'radiusX' => 50, 'radiusY' => 20, 'rotation' => 30, 'blocksVision' => true],
            ['id' => 'concave', 'source' => 'prop', 'kind' => 'polygon', 'blocksVision' => true,
                'points' => [['x' => 320, 'y' => 300], ['x' => 420, 'y' => 300], ['x' => 420, 'y' => 330], ['x' => 350, 'y' => 330], ['x' => 350, 'y' => 400], ['x' => 320, 'y' => 400]]]];
        $compiled = ['shapes' => $shapes];
        $los = new LineOfSight($compiled);
        $origin = ['x' => 100, 'y' => 250];
        $polygon = (new VisibilityPolygon($compiled))->build($origin, 600, 800, 600);
        foreach ([['x' => 400, 'y' => 250], ['x' => 400, 'y' => 100], ['x' => 400, 'y' => 500], ['x' => 500, 'y' => 330]] as $target) {
            $this->assertSame($los->point($origin, $target)['visible'], $contains($polygon, $target));
        }
    }
}
