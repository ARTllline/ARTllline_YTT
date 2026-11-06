<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\SceneProp;
use App\Models\Token;
use App\Models\User;
use App\Services\LineOfSight;
use App\Services\StructuralGeometry;
use App\Services\StructureData;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class LineOfSightTest extends TestCase
{
    use RefreshDatabase;

    private function graph(): array
    {
        $graph = json_decode(file_get_contents(base_path('tests/Fixtures/movement.json')), true)['graph'];
        $graph['edges'][0]['blocksVision'] = true;
        $graph['openings'][1]['blocksVision'] = false;

        return $graph;
    }

    private function point(float $x, float $y): array
    {
        return compact('x', 'y');
    }

    public function test_walls_openings_and_independent_flags(): void
    {
        $graph = $this->graph();
        $los = new LineOfSight(StructuralGeometry::compile($graph));
        foreach ([[150, false], [234, true], [410, true], [202, false], [202.01, true], [72, false], [71.99, true]] as [$y, $visible]) {
            $this->assertSame($visible, $los->point($this->point(100, $y), $this->point(700, $y))['visible'], "y=$y");
        }
        $graph['openings'][0]['open'] = false;
        $graph['openings'][1]['blocksVision'] = true;
        $changed = new LineOfSight(StructuralGeometry::compile($graph));
        $this->assertNotSame($los->geometryKey, $changed->geometryKey);
        $this->assertFalse($changed->point($this->point(100, 234), $this->point(700, 234))['visible']);
        $this->assertFalse($changed->point($this->point(100, 410), $this->point(700, 410))['visible']);
        $graph['openings'][0]['blocksVision'] = false;
        $graph['edges'][0]['blocksVision'] = false;
        $clear = new LineOfSight(StructuralGeometry::compile($graph));
        $this->assertTrue($clear->point($this->point(100, 234), $this->point(700, 234))['visible']);
        $this->assertTrue($clear->point($this->point(100, 150), $this->point(700, 150))['visible']);
    }

    public function test_diagonal_caps_embedded_origins_tangencies_and_first_contact(): void
    {
        $band = ['kind' => 'band', 'source' => 'wall', 'id' => 'diagonal', 'blocksVision' => true,
            'a' => $this->point(100, 100), 'b' => $this->point(200, 200), 'radius' => 8, 'roundA' => true, 'roundB' => true];
        $los = new LineOfSight(['shapes' => [$band]]);
        $this->assertFalse($los->point($this->point(90, 210), $this->point(210, 90))['visible']);
        $this->assertFalse($los->point($this->point(0, 92), $this->point(300, 92))['visible']);
        $this->assertTrue($los->point($this->point(0, 91.99), $this->point(300, 91.99))['visible']);
        $same = $los->point($this->point(150, 150), $this->point(150, 150), null, true);
        $this->assertFalse($same['visible']);
        $this->assertEqualsWithDelta(150, $same['blocker']['point']['x'], 0.001);
        $this->assertTrue($los->point($this->point(20, 20), $this->point(20, 20))['visible']);
        $wall = ['kind' => 'band', 'source' => 'wall', 'id' => 'near', 'blocksVision' => true,
            'a' => $this->point(50, 0), 'b' => $this->point(50, 200), 'radius' => 4, 'roundA' => false, 'roundB' => false];
        $hit = (new LineOfSight(['shapes' => [$band, $wall]]))->point($this->point(0, 100), $this->point(300, 100), null, true);
        $this->assertSame('near', $hit['blocker']['id']);
        $this->assertEqualsWithDelta(46, $hit['blocker']['point']['x'], 0.001);
    }

    public function test_transformed_prop_colliders_and_flags(): void
    {
        $fixtures = json_decode(file_get_contents(base_path('tests/Fixtures/movement.json')), true)['props'];
        foreach ($fixtures as $case) {
            $prop = new SceneProp(['x' => 250, 'y' => 250, 'rotation' => $case['rotation'], 'scale_x' => $case['scaleX'], 'scale_y' => $case['scaleY'],
                'preset_snapshot' => ['width' => 100, 'height' => 100, 'pivotX' => 0.5, 'pivotY' => 0.5,
                    'collider' => $case['collider'] + ['blocksMovement' => false, 'blocksVision' => true, 'blocksLight' => false]]]);
            $compiled = StructuralGeometry::compile(['vertices' => [], 'edges' => []], [$prop]);
            $los = new LineOfSight($compiled);
            $this->assertFalse($los->point($this->point(50, 250), $this->point(450, 250))['visible'], $case['name']);
            $this->assertTrue($los->point($this->point(50, 100), $this->point(450, 100))['visible']);
            $compiled['shapes'][0]['blocksVision'] = false;
            $compiled['shapes'][0]['blocksMovement'] = $compiled['shapes'][0]['blocksLight'] = true;
            $this->assertTrue((new LineOfSight($compiled))->point($this->point(50, 250), $this->point(450, 250))['visible']);
        }
    }

    public function test_connected_rooms_corridor_windows_and_diagonal_fixture(): void
    {
        $fixture = json_decode(file_get_contents(base_path('tests/Fixtures/los.json')), true);
        StructuralGeometry::validate($fixture['graph']);
        $los = new LineOfSight(StructuralGeometry::compile($fixture['graph']));
        foreach ($fixture['cases'] as $case) {
            $this->assertSame($case['visible'], $los->point($case['a'], $case['b'])['visible'], $case['name']);
        }
    }

    public function test_diagonal_aperture_checks_the_whole_wall_thickness(): void
    {
        $graph = ['vertices' => [['id' => 'a', 'x' => 100, 'y' => 100], ['id' => 'b', 'x' => 300, 'y' => 300]],
            'edges' => [['id' => 'wall', 'a' => 'a', 'b' => 'b', 'thickness' => 20, 'materialVersionId' => null,
                'blocksMovement' => true, 'blocksVision' => true, 'blocksLight' => false]],
            'openings' => [['id' => 'gap', 'type' => 'door', 'edgeId' => 'wall', 'center' => 0.5, 'width' => 20, 'open' => true]], 'rooms' => []];
        $los = new LineOfSight(StructuralGeometry::compile($graph));
        $world = fn ($along, $normal) => $this->point(200 + ($along + $normal) / sqrt(2), 200 + ($along - $normal) / sqrt(2));
        $this->assertTrue($los->point($world(0, -100), $world(0, 100))['visible']);
        $this->assertFalse($los->point($world(10, -100), $world(10, 100))['visible'], 'Contact with a flat jamb blocks');
        $this->assertTrue($los->point($world(9.99, -100), $world(9.99, 100))['visible']);
        $this->assertFalse($los->point($world(-120, -100), $world(120, 100))['visible'], 'Center line alone would miss the jamb');
    }

    public function test_rotated_ellipse_tangency_and_concave_prop_recess(): void
    {
        $world = fn ($x, $y) => $this->point(250 + $x * cos(M_PI / 6) - $y * sin(M_PI / 6),
            250 + $x * sin(M_PI / 6) + $y * cos(M_PI / 6));
        $los = new LineOfSight(['shapes' => [['id' => 'ellipse', 'source' => 'prop', 'kind' => 'ellipse',
            'center' => $this->point(250, 250), 'radiusX' => 50, 'radiusY' => 20, 'rotation' => 30, 'blocksVision' => true]]]);
        $this->assertFalse($los->point($world(-100, 20), $world(100, 20))['visible']);
        $this->assertTrue($los->point($world(-100, 20.001), $world(100, 20.001))['visible']);
        $this->assertFalse($los->point($world(0, 0), $world(1, 1))['visible']);
        $this->assertFalse($los->point($world(70, 0), $world(50, 0))['visible']);
        $polygon = new LineOfSight(['shapes' => [['id' => 'concave', 'source' => 'prop', 'kind' => 'polygon',
            'points' => array_map(fn ($p) => $this->point(...$p), [[0, 0], [100, 0], [100, 30], [30, 30], [30, 100], [0, 100]]),
            'blocksVision' => true]]]);
        $this->assertTrue($polygon->point($this->point(40, 80), $this->point(80, 40))['visible']);
        $this->assertFalse($polygon->point($this->point(20, 80), $this->point(80, 20))['visible']);
    }

    public function test_sampling_partial_footprint_scale_and_range(): void
    {
        $wall = ['kind' => 'band', 'source' => 'wall', 'id' => 'wall', 'blocksVision' => true,
            'a' => $this->point(100, 0), 'b' => $this->point(100, 100), 'radius' => 4, 'roundA' => false, 'roundB' => false];
        $los = new LineOfSight(['shapes' => [$wall]]);
        $observer = new Token(['x' => 0, 'y' => 100, 'size' => 40, 'scale' => 1]);
        $target = new Token(['x' => 200, 'y' => 100, 'size' => 80, 'scale' => 1]);
        $result = $los->token($observer, $target, null, true);
        $this->assertTrue($result['visible']);
        $this->assertSame('partial', $result['visibility']);
        $this->assertFalse($result['rays'][0]['visible']);
        $this->assertCount(9, $result['rays']);
        $this->assertSame(LineOfSight::POLICY, $result['policy']);
        $empty = new LineOfSight(['shapes' => []]);
        $this->assertSame('full', $empty->token($observer, $target)['visibility']);
        $this->assertSame('none', $empty->token($observer, $target, 100)['visibility']);
        $this->assertSame('partial', $empty->token($observer, $target, 180)['visibility']);
        $target->scale = 2;
        $this->assertEquals(264, $empty->token($observer, $target, null, true)['rays'][1]['target']['x']);
        $this->assertTrue($empty->point($this->point(0, 0), $this->point(3, 4), 5)['visible']);
        $this->assertSame('out_of_range', $empty->point($this->point(0, 0), $this->point(3, 4), 4.99)['reason']);
        $this->assertArrayNotHasKey('rays', $empty->token($observer, $target));
    }

    public function test_spatial_filter_matches_unindexed_kernel(): void
    {
        $shapes = [];
        for ($i = 0; $i < 400; $i++) {
            $shapes[] = ['kind' => 'band', 'source' => 'wall', 'id' => "w$i", 'blocksVision' => true,
                'a' => $this->point(($i % 20) * 256, intdiv($i, 20) * 256),
                'b' => $this->point(($i % 20) * 256 + 60, intdiv($i, 20) * 256 + 120),
                'radius' => 8, 'roundA' => true, 'roundB' => false];
        }
        $shapes[] = ['kind' => 'band', 'source' => 'wall', 'id' => 'large', 'blocksVision' => true,
            'a' => $this->point(-20000, -20000), 'b' => $this->point(20000, 20000),
            'radius' => 2, 'roundA' => true, 'roundB' => true];
        $los = new LineOfSight(['shapes' => $shapes]);
        $kernel = new \App\Services\ShapeIntersection;
        mt_srand(808);
        for ($i = 0; $i < 200; $i++) {
            $a = $this->point(mt_rand(-500, 6000), mt_rand(-500, 6000));
            $b = $this->point(mt_rand(-500, 6000), mt_rand(-500, 6000));
            $this->assertSame(! $kernel->intersects($a, $b, LineOfSight::EPSILON, $shapes), $los->point($a, $b)['visible']);
        }
        $this->assertFalse($los->point($this->point(-20000, 0), $this->point(20000, 0))['visible']);
    }

    public function test_gm_query_security_revision_invalidation_and_legacy(): void
    {
        Event::fake([TabletopEvent::class]);
        $gm = User::factory()->create();
        $player = User::factory()->create();
        $outsider = User::factory()->create();
        $campaign = Campaign::create(['name' => 'LOS']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $campaign->members()->attach($player, ['role' => 'player']);
        $scene = $campaign->scenes()->create(['name' => 'LOS', 'width' => 800, 'height' => 600]);
        $campaign->forceFill(['active_scene_id' => $scene->id])->save();
        $path = "/api/scenes/{$scene->id}/los";
        $query = ['observer' => ['point' => $this->point(100, 234)], 'targets' => [['point' => $this->point(700, 234)]]];
        $this->postJson($path, $query)->assertUnauthorized();
        foreach ([$player, $outsider] as $user) {
            $this->actingAs($user)->postJson($path, $query)->assertForbidden()->assertJsonMissingPath('geometryKey');
            $this->postJson($path, [])->assertForbidden();
        }
        $this->actingAs($gm);
        $this->postJson($path, $query)->assertOk()->assertJsonPath('results.0.visible', true)->assertJsonPath('revision', 0);
        $scene->mapWorld()->create(['structure' => $this->graph()]);
        $first = $this->postJson($path, $query)->assertOk()->assertJsonPath('results.0.visible', true)->json();
        $this->postJson("/api/scenes/{$scene->id}/structure", [
            'door' => ['id' => 'door', 'open' => false], 'expected' => StructureData::hash($this->graph()),
            'clientMutationId' => (string) Str::uuid(),
        ])->assertOk();
        $second = $this->postJson($path, $query)->assertOk()->assertJsonPath('results.0.visible', false)
            ->assertJsonPath('results.0.blocker.id', 'opening:door')->assertJsonPath('revision', 1)->json();
        $this->assertNotSame($first['geometryKey'], $second['geometryKey']);
        $graph = StructureData::graph($scene->fresh());
        $graph['edges'][0]['blocksVision'] = false;
        $this->postJson("/api/scenes/{$scene->id}/structure", [
            'value' => $graph, 'expected' => StructureData::hash(StructureData::graph($scene->fresh())),
            'clientMutationId' => (string) Str::uuid(),
        ])->assertOk();
        $wallQuery = ['observer' => ['point' => $this->point(100, 150)], 'targets' => [['point' => $this->point(700, 150)]]];
        $wallChanged = $this->postJson($path, $wallQuery)->assertOk()->assertJsonPath('results.0.visible', true)->json();
        $this->assertNotSame($second['geometryKey'], $wallChanged['geometryKey']);
        $asset = Asset::create(['library_user_id' => $gm->id, 'uploaded_by' => $gm->id, 'kind' => 'prop',
            'name' => 'secret blocker', 'original_name' => 'b.png', 'storage_path' => 'private/b.png',
            'mime_type' => 'image/png', 'file_size' => 100, 'width' => 100, 'height' => 100]);
        $prop = $scene->props()->create(['asset_id' => $asset->id, 'name' => 'secret blocker', 'is_hidden' => true,
            'x' => 500, 'y' => 410, 'scale_x' => 1, 'scale_y' => 1, 'rotation' => 0,
            'preset_snapshot' => ['width' => 100, 'height' => 100, 'pivotX' => 0.5, 'pivotY' => 0.5,
                'collider' => ['type' => 'rectangle', 'x' => 0, 'y' => 0, 'width' => 100, 'height' => 100,
                    'blocksVision' => true, 'blocksMovement' => false, 'blocksLight' => false]]]);
        $query['observer']['point']['y'] = $query['targets'][0]['point']['y'] = 410;
        $blocked = $this->postJson($path, $query)->assertOk()->assertJsonPath('results.0.blocker.id', 'prop:'.$prop->id)->json();
        $prop->update(['y' => 550]);
        $clear = $this->postJson($path, $query)->assertOk()->assertJsonPath('results.0.visible', true)->json();
        $this->assertNotSame($blocked['geometryKey'], $clear['geometryKey']);
        $observer = $scene->tokens()->create(['name' => 'Observer', 'x' => 100, 'y' => 410, 'size' => 40, 'scale' => 1]);
        $target = $scene->tokens()->create(['name' => 'Target', 'x' => 700, 'y' => 410, 'size' => 40, 'scale' => 1]);
        $this->postJson($path, ['observer' => ['tokenId' => $observer->id], 'targets' => [['tokenId' => $target->id]]])
            ->assertOk()->assertJsonPath('results.0.visibility', 'full')->assertJsonCount(9, 'results.0.rays');
        $other = $campaign->scenes()->create(['name' => 'Other']);
        $foreign = $other->tokens()->create(['name' => 'Foreign', 'x' => 100, 'y' => 100]);
        $this->postJson($path, ['observer' => ['tokenId' => $observer->id], 'targets' => [['tokenId' => $foreign->id]]])->assertUnprocessable();
        foreach ([[], ['targets' => array_fill(0, 65, ['point' => $this->point(1, 1)])], ['range' => -1],
            ['observer' => ['point' => $this->point(1, 1), 'tokenId' => $observer->id]],
            ['observer' => ['point' => $this->point(900, 1)]]] as $patch) {
            $this->postJson($path, $patch ? array_replace($query, $patch) : [])->assertUnprocessable();
        }
        $this->actingAs($player)->getJson("/api/scenes/{$scene->id}/snapshot")->assertOk()
            ->assertJsonCount(0, 'props')->assertJsonCount(2, 'tokens')
            ->assertJsonMissingPath('geometryKey')->assertJsonMissingPath('losDebug')
            ->assertJsonMissingPath('structure.graph.edges.0.blocksVision');
        // Only door/wall mutations publish (separate GM and Player projections).
        Event::assertDispatchedTimes(TabletopEvent::class, 4);
    }
}
