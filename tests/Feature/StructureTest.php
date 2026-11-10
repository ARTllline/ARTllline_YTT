<?php

namespace Tests\Feature;

use App\Actions\MapWorldActions;
use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\MapMaterial;
use App\Models\Scene;
use App\Models\User;
use App\Services\LineOfSight;
use App\Services\MovementCollision;
use App\Services\RoomAssembly;
use App\Services\StructuralGeometry;
use App\Services\StructureData;
use App\Services\WallCurve;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Tests\TestCase;

class StructureTest extends TestCase
{
    use RefreshDatabase;

    public function test_room_assemblies_match_frontend_geometry_and_atomic_history(): void
    {
        $fixtures = json_decode(file_get_contents(base_path('tests/Fixtures/room-assemblies.json')), true);
        foreach ($fixtures as $name => $graph) {
            $compiled = RoomAssembly::rebuild($graph);
            foreach (['vertices', 'edges', 'rooms', 'floors', 'openings'] as $kind) {
                $this->assertEqualsWithDelta(collect($graph[$kind] ?? [])->sortBy('id')->values()->all(), collect($compiled[$kind] ?? [])->sortBy('id')->values()->all(), .006, "$name $kind");
            }
            $response = $this->save($graph);
            $this->assertSame(200, $response->status(), $name.': '.$response->json('message'));
            $result = $response->json();
            $this->assertCount(count($graph['rooms']), $result['structure']['graph']['rooms'], $name);
            $this->assertCount(count($graph['assemblies'][0]['sources']), $result['structure']['graph']['assemblies'][0]['sources']);
            $this->command('edit-history', ['changes' => [['kind' => 'structure', 'id' => $this->scene->id, 'expected' => ['hash' => $result['structure']['hash']], 'value' => $result['structureEdit']['before']]]])->assertOk();
        }
    }

    public function test_assembly_sources_are_private_and_materials_and_missing_openings_are_validated(): void
    {
        $graph = json_decode(file_get_contents(base_path('tests/Fixtures/room-assemblies.json')), true)['door'];
        $response = $this->save($graph);
        $this->assertSame(200, $response->status(), (string) $response->json('message'));
        $result = $response->json();
        $public = StructureData::projection($this->scene->fresh(), false)['graph'];
        $this->assertArrayNotHasKey('assemblies', $public);
        $this->assertNotEmpty($public['floors']);
        foreach ($public['edges'] as $edge) {
            $this->assertArrayNotHasKey('blocksVision', $edge);
        }
        $edited = $graph;
        $edited['assemblies'][0]['sources'][1]['graph']['rooms'][0]['materialVersionId'] = '999999';
        $this->save($edited)->assertUnprocessable();
        $this->assertSame($result['structure']['hash'], StructureData::projection($this->scene->fresh(), true)['hash']);
        $edited = $graph;
        $edited['assemblies'][0]['sources'][1]['graph']['vertices'][0]['x'] += 10;
        $this->save($edited)->assertUnprocessable();
        $this->actingAs($this->player);
        $this->save($graph)->assertForbidden();
    }

    public function test_nested_room_floor_overrides_both_material_regions_of_its_merged_parent(): void
    {
        $fixture = json_decode(file_get_contents(base_path('tests/Fixtures/room-assemblies.json')), true)['nestedAcrossSeam'];
        $assembly = $fixture['assemblies'][0];
        foreach ($assembly['sources'] as $i => &$source) {
            $source['graph']['rooms'][0]['materialVersionId'] = (string) ($i + 1);
        }
        unset($source);
        $graph = RoomAssembly::compile($assembly);
        foreach ([['x' => 480, 'y' => 300], ['x' => 530, 'y' => 300]] as $point) {
            $floors = array_values(array_filter($graph['floors'], fn ($f) => RoomAssembly::contains($f['points'], $point)));
            $this->assertNotEmpty($floors);
            foreach ($floors as $floor) {
                $this->assertSame('3', $floor['materialVersionId']);
            }
        }
    }

    public function test_curved_seam_join_preserves_an_existing_window_and_physical_door_panel(): void
    {
        $fixtures = json_decode(file_get_contents(base_path('tests/Fixtures/room-assemblies.json')), true);
        $this->save($fixtures['seamBefore'])->assertOk();
        $result = $this->save($fixtures['seamAfter'])->assertOk()->json('structure.graph');
        $this->assertCount(2, $result['openings']);
        $this->assertCount(4, $result['assemblies'][0]['sources'][1]['graph']['edges']);
        $compiled = StructuralGeometry::compile($result);
        $panels = array_filter($compiled['segments'], fn ($s) => isset($s['openingId']));
        $this->assertCount(2, $panels);
        $door = collect($result['openings'])->firstWhere('type', 'door');
        $panel = collect($panels)->firstWhere('openingId', $door['id']);
        $this->assertEqualsWithDelta($panel['a']['x'], $panel['b']['x'], .001);
        $broken = $fixtures['seamAfter'];
        $broken['assemblies'][0]['sources'][1]['mode'] = 'trim';
        $broken['assemblies'][0]['sources'][1]['graph']['edges'][0]['curve']['cx'] = 450;
        $this->save($broken)->assertUnprocessable();
    }

    private User $gm;

    private User $player;

    private Campaign $campaign;

    private Scene $scene;

    protected function setUp(): void
    {
        parent::setUp();
        $this->gm = User::factory()->create();
        $this->player = User::factory()->create();
        $this->campaign = Campaign::create(['name' => 'Build']);
        $this->campaign->members()->attach($this->gm, ['role' => 'gm']);
        $this->campaign->members()->attach($this->player, ['role' => 'player']);
        $this->scene = $this->campaign->scenes()->create(['name' => 'Build', 'width' => 720, 'height' => 600]);
        $this->scene->mapWorld()->create();
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->actingAs($this->gm);
        Event::fake([TabletopEvent::class]);
    }

    private function command(string $command, array $payload, ?string $id = null)
    {
        return $this->postJson("/api/scenes/{$this->scene->id}/$command", $payload + ['clientMutationId' => $id ?? (string) Str::uuid()]);
    }

    private function save(array $graph, ?string $expected = null, ?string $id = null)
    {
        return $this->command('structure', [
            'value' => $graph, 'expected' => $expected ?? StructureData::hash(StructureData::graph($this->scene->fresh())),
        ], $id);
    }

    private function room(): array
    {
        return [
            'vertices' => [
                ['id' => 'va', 'x' => 120, 'y' => 120], ['id' => 'vb', 'x' => 300, 'y' => 120],
                ['id' => 'vc', 'x' => 300, 'y' => 360], ['id' => 'vd', 'x' => 120, 'y' => 360],
            ],
            'edges' => [$this->edge('ea', 'va', 'vb'), $this->edge('eb', 'vb', 'vc'),
                $this->edge('ec', 'vc', 'vd'), $this->edge('ed', 'vd', 'va')],
            'rooms' => [['id' => 'ra', 'loop' => ['va', 'vb', 'vc', 'vd'], 'materialVersionId' => null]],
        ];
    }

    private function edge(string $id, string $a, string $b): array
    {
        return ['id' => $id, 'a' => $a, 'b' => $b, 'thickness' => 16, 'materialVersionId' => null,
            'blocksMovement' => true, 'blocksVision' => false, 'blocksLight' => true];
    }

    public function test_topology_history_reload_and_compiled_capsules_share_identity(): void
    {
        $room = $this->room();
        $empty = StructureData::hash(StructureData::graph($this->scene->fresh()));
        $this->assertSame('e9e2551ff7d2a3824cb4725dc15cf3826753f8fb28c4849fa8d448b73171831a', $empty);
        $id = (string) Str::uuid();
        $created = $this->save($room, $empty, $id)->assertOk()->json();
        $this->save($room, $empty, $id)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->save($room, $empty)->assertConflict();
        $split = $room;
        $split['vertices'][] = ['id' => 'vm', 'x' => 210, 'y' => 120];
        $split['edges'][0]['b'] = 'vm';
        $split['edges'][] = $this->edge('es', 'vm', 'vb');
        $split['rooms'][0]['loop'] = ['va', 'vm', 'vb', 'vc', 'vd'];
        $edit = $this->save($split)->assertOk()->json('structureEdit');
        foreach (['before', 'after'] as $phase) {
            $this->command('edit-history', ['changes' => [[
                'kind' => 'structure', 'id' => $this->scene->id, 'expected' => $edit[$phase === 'before' ? 'after' : 'before'],
                'value' => $edit[$phase],
            ]]])->assertOk()->assertJsonPath('structure.hash', $edit[$phase]['hash']);
        }
        $this->getJson("/api/scenes/{$this->scene->id}/snapshot")->assertOk()
            ->assertJsonPath('structure.graph.rooms.0.loop.1', 'vm');
        $compiled = StructuralGeometry::compile(StructureData::graph($this->scene->fresh()));
        $this->assertSame(2, $compiled['schemaVersion']);
        $this->assertCount(5, $compiled['segments']);
        $this->assertSame('ea', $compiled['segments'][0]['edgeId']);
        $this->assertSame('vm', $compiled['segments'][0]['b']['id']);
        $this->assertEquals(8, $compiled['segments'][0]['radius']);
        $this->assertFalse($compiled['segments'][0]['blocksVision']);
        $this->assertNotSame($created['structure']['hash'], $edit['after']['hash']);
        $copy = $this->command('duplicate', ['name' => 'Copy'])->assertOk()->json('id');
        $this->getJson("/api/scenes/$copy/snapshot")->assertOk()->assertJsonPath('structure.hash', $edit['after']['hash']);
    }

    public function test_rejects_broken_loops_and_out_of_bounds_without_mutation(): void
    {
        $room = $this->room();
        $this->save($room)->assertOk();
        $invalid = $room;
        array_pop($invalid['edges']);
        $this->save($invalid)->assertUnprocessable();
        $invalid = $room;
        $invalid['vertices'][0]['x'] = 5;
        $this->save($invalid)->assertUnprocessable();
        $invalid = $room;
        foreach ($invalid['vertices'] as &$vertex) {
            $vertex['x'] = 420 - $vertex['x'];
        }
        unset($vertex);
        $this->save($invalid)->assertUnprocessable()
            ->assertJsonPath('message', 'Перемещение сворачивает контур комнаты.');
        $before = app(MapWorldActions::class)->state($this->scene->fresh());
        $this->command('map-world', ['expected' => $before, 'value' => array_replace($before, ['width' => 300])])->assertUnprocessable();
        $this->command('edit-history', ['changes' => [[
            'kind' => 'mapWorld', 'id' => $this->scene->id, 'expected' => $before, 'value' => array_replace($before, ['enabled' => false]),
        ]]])->assertConflict();
        $this->assertSame(1, $this->scene->fresh()->revision);
    }

    public function test_coincident_straight_walls_coalesce_preserve_apertures_and_reject_conflicts(): void
    {
        $graph = $this->room();
        $graph['openings'] = [['id' => 'existing-window', 'edgeId' => 'ea', 'type' => 'window', 'center' => .5, 'width' => 32, 'frame' => 'wood', 'blocksMovement' => true, 'blocksVision' => false, 'blocksLight' => false]];
        $this->save($graph)->assertOk();
        $graph['vertices'][] = ['id' => 've', 'x' => 160, 'y' => 120];
        $graph['vertices'][] = ['id' => 'vf', 'x' => 260, 'y' => 120];
        $graph['edges'][] = $this->edge('overlap', 'vf', 've');
        $result = $this->save($graph)->assertOk()->json();
        $saved = $result['structure']['graph'];
        $this->assertCount(6, $saved['edges']);
        $this->assertCount(1, $saved['openings']);
        $opening = $saved['openings'][0];
        $wall = collect($saved['edges'])->firstWhere('id', $opening['edgeId']);
        $vertices = array_column($saved['vertices'], null, 'id');
        $this->assertEqualsWithDelta(210, $vertices[$wall['a']]['x'] + ($vertices[$wall['b']]['x'] - $vertices[$wall['a']]['x']) * $opening['center'], .001);
        $bad = $saved;
        $bad['edges'][] = array_replace($wall, ['id' => 'conflict-wall']);
        $bad['openings'][] = array_replace($opening, ['id' => 'conflict-window', 'edgeId' => 'conflict-wall']);
        $this->save($bad)->assertUnprocessable();
        $this->assertSame($result['structure']['hash'], StructureData::projection($this->scene->fresh(), true)['hash']);
    }

    public function test_room_can_move_onto_a_wall_while_both_existing_apertures_keep_their_positions(): void
    {
        $graph = $this->room();
        $graph['vertices'][] = ['id' => 've', 'x' => 460, 'y' => 120];
        $graph['vertices'][] = ['id' => 'vf', 'x' => 460, 'y' => 360];
        $graph['edges'][] = $this->edge('stationary-wall', 've', 'vf');
        $window = ['type' => 'window', 'width' => 32, 'frame' => 'wood', 'blocksMovement' => true, 'blocksVision' => false, 'blocksLight' => false];
        $graph['openings'] = [['id' => 'moving-window', 'edgeId' => 'eb', 'center' => .5] + $window, ['id' => 'stationary-window', 'edgeId' => 'stationary-wall', 'center' => .2] + $window];
        $this->save($graph)->assertOk();
        foreach ($graph['vertices'] as &$v) {
            if (in_array($v['id'], ['va', 'vb', 'vc', 'vd'], true)) {
                $v['x'] += 160;
            }
        }
        unset($v);
        $result = $this->save($graph)->assertOk()->json('structure.graph');
        $this->assertCount(4, $result['edges']);
        $this->assertCount(2, $result['openings']);
        $this->assertSame($result['openings'][0]['edgeId'], $result['openings'][1]['edgeId']);
    }

    public function test_room_translation_preserves_shared_edges_and_rejects_occupied_destinations(): void
    {
        $graph = $this->room();
        $graph['vertices'][] = ['id' => 've', 'x' => 500, 'y' => 120];
        $graph['vertices'][] = ['id' => 'vf', 'x' => 500, 'y' => 360];
        $graph['edges'][] = $this->edge('ee', 'vb', 've');
        $graph['edges'][] = $this->edge('ef', 've', 'vf');
        $graph['edges'][] = $this->edge('eg', 'vf', 'vc');
        $graph['rooms'][] = ['id' => 'rb', 'loop' => ['vb', 've', 'vf', 'vc'], 'materialVersionId' => null];
        $graph['openings'][] = ['id' => 'door', 'edgeId' => 'eb', 'type' => 'door', 'center' => 0.5, 'width' => 40,
            'open' => false, 'locked' => true, 'hinge' => 'a', 'direction' => 'left', 'angle' => 90];
        $original = $this->save($graph)->assertOk()->json('structure');

        $move = static function (int $dx) use ($graph) {
            $next = $graph;
            foreach ($next['vertices'] as &$vertex) {
                if (in_array($vertex['id'], $graph['rooms'][0]['loop'], true)) {
                    $vertex['x'] += $dx;
                }
            }

            return $next;
        };
        $token = $this->scene->tokens()->create(['name' => 'Occupant', 'x' => 360, 'y' => 240, 'size' => 20]);
        $this->save($move(60), $original['hash'])->assertUnprocessable()
            ->assertJsonPath('message', 'Перемещение перекрывает место, занятое токеном.');
        $this->save($move(200), $original['hash'])->assertUnprocessable();
        $this->assertSame(1, $this->scene->fresh()->revision);
        $this->assertEquals(360, $token->fresh()->x);

        $result = $this->save($move(25), $original['hash'])->assertOk()->json();
        $next = $result['structure']['graph'];
        foreach (['rooms', 'edges', 'openings'] as $kind) {
            $this->assertSame($original['graph'][$kind], $next[$kind]);
        }
        $vertices = array_column($next['vertices'], 'x', 'id');
        $this->assertEquals(325, $vertices['vb']);
        $this->assertEquals(500, $vertices['ve']);
        $segments = array_column(StructuralGeometry::forScene($this->scene->fresh())['segments'], null, 'id');
        $this->assertEquals(325, $segments['opening:door']['a']['x']);
        $this->assertSame(2, $this->scene->fresh()->revision);
        $edit = $result['structureEdit'];
        $this->command('edit-history', ['changes' => [[
            'kind' => 'structure', 'id' => $this->scene->id, 'expected' => $edit['after'],
            'value' => $edit['before'],
        ]]])->assertOk()->assertJsonPath('structure.hash', $original['hash']);
    }

    public function test_openings_cut_wall_runs_and_door_state_is_authoritative(): void
    {
        $room = $this->room();
        $door = ['id' => 'door', 'edgeId' => 'ea', 'type' => 'door', 'center' => 0.3, 'width' => 40,
            'open' => false, 'locked' => true, 'hinge' => 'a', 'direction' => 'left', 'angle' => 90];
        $window = ['id' => 'window', 'edgeId' => 'ea', 'type' => 'window', 'center' => 0.7, 'width' => 32,
            'frame' => 'iron', 'blocksMovement' => true, 'blocksVision' => false, 'blocksLight' => false];
        $room['openings'] = [$door, $window];
        $saved = $this->save($room)->assertOk()->json('structure');
        $compile = fn () => array_column(StructuralGeometry::compile(StructureData::graph($this->scene->fresh()))['segments'], null, 'id');
        $closed = $compile();
        $this->assertEquals(154, $closed['ea:a:door']['b']['x']);
        $this->assertFalse($closed['ea:a:door']['roundB']);
        $this->assertTrue($closed['opening:door']['blocksVision']);
        $this->assertTrue($closed['opening:window']['blocksMovement']);
        $this->assertFalse($closed['opening:window']['blocksVision']);
        $this->assertFalse($closed['opening:window']['blocksLight']);
        $this->assertEquals(4, $closed['opening:door']['radius']);

        $invalid = $room;
        $invalid['openings'][1]['center'] = 0.3;
        $this->save($invalid)->assertUnprocessable();
        $invalid = $room;
        $invalid['vertices'][1]['x'] = 160;
        $this->save($invalid)->assertUnprocessable();
        $this->save(['vertices' => [], 'edges' => [], 'rooms' => []])->assertUnprocessable();

        $toggle = fn (array $patch, string $hash) => $this->command('structure', [
            'door' => ['id' => 'door'] + $patch, 'expected' => $hash,
        ]);
        $toggle(['open' => true], $saved['hash'])->assertUnprocessable();
        $this->command('structure', [
            'opening' => ['id' => 'door', 'open' => true], 'expected' => $saved['hash'],
        ])->assertUnprocessable();
        $visibleHash = StructureData::projection($this->scene->fresh(), false)['hash'];
        $this->assertNotSame($saved['hash'], $visibleHash);
        $unlocked = $toggle(['locked' => false], $saved['hash'])->assertOk()->json('structure.hash');
        $this->assertSame($visibleHash, StructureData::projection($this->scene->fresh(), false)['hash']);
        $playerEvent = Event::dispatched(TabletopEvent::class)->pluck(0)
            ->last(fn ($event) => str_contains($event->channel, '.user.'.$this->player->id));
        $this->assertSame('scene.revision', $playerEvent->envelope['type']);
        $this->assertSame([], (array) $playerEvent->envelope['payload']);
        $this->assertSame($closed, $compile());
        $toggle(['open' => true], $saved['hash'])->assertConflict();
        $opened = $toggle(['open' => true], $unlocked)->assertOk()->json();
        $this->assertSame(array_diff_key($closed, ['opening:door' => true]), $compile());
        $this->command('edit-history', ['changes' => [[
            'kind' => 'structure', 'id' => $this->scene->id, 'expected' => $opened['structureEdit']['after'],
            'value' => $opened['structureEdit']['before'],
        ]]])->assertOk();
        $this->assertSame($closed, $compile());

        $this->actingAs($this->player);
        $toggle(['open' => true], $unlocked)->assertForbidden();
        $this->getJson("/api/scenes/{$this->scene->id}/snapshot")->assertOk()
            ->assertJsonPath('structure.graph.openings.0.open', false)
            ->assertJsonMissingPath('structure.graph.openings.0.locked')
            ->assertJsonMissingPath('structure.graph.openings.1.blocksVision');
        $events = Event::dispatched(TabletopEvent::class)->pluck(0)
            ->filter(fn ($event) => str_contains($event->channel, '.user.'.$this->player->id));
        $this->assertNotEmpty($events);
        foreach ($events as $event) {
            $payload = (array) $event->envelope['payload'];
            foreach ($payload['structurePatch']['openings']['upsert'] ?? [] as $opening) {
                $this->assertArrayNotHasKey('locked', $opening);
                $this->assertArrayNotHasKey('blocksVision', $opening);
            }
        }
    }

    public function test_players_can_change_windows_on_the_active_scene_without_receiving_private_structure(): void
    {
        $room = $this->room();
        $room['openings'] = [['id' => 'window', 'edgeId' => 'ea', 'type' => 'window', 'center' => .5, 'width' => 40,
            'frame' => 'wood', 'blocksMovement' => true, 'blocksVision' => true, 'blocksLight' => true]];
        $saved = $this->save($room)->assertOk()->json('structure');
        $compile = fn () => array_column(StructuralGeometry::forScene($this->scene->fresh())['segments'], null, 'id');
        $panel = $compile()['opening:window'];
        $this->assertTrue($panel['blocksMovement']);
        $this->assertFalse($panel['blocksVision']);
        $this->assertFalse($panel['blocksLight']);
        $toggle = fn (bool $open, string $hash, ?string $mutation = null) => $this->command('structure', [
            'opening' => ['id' => 'window', 'open' => $open], 'expected' => $hash,
        ], $mutation);

        $this->actingAs($this->player);
        $url = "/api/scenes/{$this->scene->id}/snapshot";
        $publicHash = $this->getJson($url)->assertOk()->assertJsonPath('structure.graph.openings.0.open', true)->json('structure.hash');
        $this->save($room)->assertForbidden();
        $toggle(false, $saved['hash'])->assertConflict();
        $mutation = (string) Str::uuid();
        $closed = $toggle(false, $publicHash, $mutation)->assertOk()
            ->assertJsonPath('structurePatch.openings.upsert.0.open', false)
            ->assertJsonMissingPath('structure')->assertJsonMissingPath('structureEdit')
            ->json('structurePatch.hash');
        $toggle(false, $publicHash, $mutation)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertTrue($compile()['opening:window']['blocksMovement']);
        $this->assertTrue($compile()['opening:window']['blocksVision']);
        $this->assertTrue($compile()['opening:window']['blocksLight']);

        $playerEvent = Event::dispatched(TabletopEvent::class)->pluck(0)
            ->last(fn ($event) => str_contains($event->channel, '.user.'.$this->player->id));
        $patch = $playerEvent->envelope['payload']['structurePatch']['openings']['upsert'][0];
        $this->assertFalse($patch['open']);
        $this->assertArrayNotHasKey('blocksVision', $patch);
        $this->assertArrayNotHasKey('blocksLight', $patch);

        $toggle(true, $publicHash)->assertConflict();
        $open = $toggle(true, $closed)->assertOk()->assertJsonPath('structurePatch.openings.upsert.0.open', true)->json('structurePatch.hash');
        $this->assertSame($panel, $compile()['opening:window']);
        $this->campaign->forceFill(['active_scene_id' => null])->save();
        $toggle(false, $publicHash, $mutation)->assertForbidden();
        $toggle(false, $open)->assertForbidden();
    }

    public function test_material_use_and_player_projection_are_scoped_to_the_active_scene(): void
    {
        $asset = Asset::create(['library_user_id' => $this->gm->id, 'uploaded_by' => $this->gm->id,
            'kind' => 'map', 'name' => 'Slate', 'original_name' => 'slate.png', 'storage_path' => 'private/slate.png',
            'mime_type' => 'image/png', 'file_size' => 100, 'width' => 64, 'height' => 64]);
        $material = MapMaterial::create(['user_id' => $this->gm->id]);
        $version = $material->versions()->create(['version' => 1, 'name' => 'Slate', 'type' => 'floor',
            'asset_id' => $asset->id, 'repeat_size' => 64, 'rotation' => 0, 'variation' => [], 'created_at' => now()]);
        $this->assertFalse(Gate::forUser($this->player)->allows('view', $asset));
        $room = $this->room();
        $room['edges'][0]['materialVersionId'] = (string) $version->id;
        $this->save($room)->assertUnprocessable();
        $room['edges'][0]['materialVersionId'] = null;
        $room['rooms'][0]['materialVersionId'] = (string) $version->id;
        $this->save($room)->assertOk();
        $this->deleteJson("/api/library/materials/{$material->id}", ['clientMutationId' => (string) Str::uuid()])->assertConflict();
        $this->assertTrue(Gate::forUser($this->player)->allows('view', $asset));
        $this->actingAs($this->player);
        $this->save($room)->assertForbidden();
        $this->getJson("/api/scenes/{$this->scene->id}/snapshot")->assertOk()
            ->assertJsonMissingPath('structure.graph.edges.0.blocksVision')->assertJsonMissingPath('structure.materials.0.name')
            ->assertJsonPath('structure.materials.0.versionId', (string) $version->id);
        $event = Event::dispatched(TabletopEvent::class)->pluck(0)->first(fn ($e) => str_contains($e->channel, '.user.'.$this->player->id));
        $payload = $event->envelope['payload'];
        $this->assertArrayNotHasKey('structureEdit', $payload);
        $this->assertArrayNotHasKey('blocksLight', $payload['structurePatch']['edges']['upsert'][0]);
        $this->campaign->forceFill(['active_scene_id' => null])->save();
        $this->assertFalse(Gate::forUser($this->player)->allows('view', $asset));
    }

    private function curvedRoom(array $patch = []): array
    {
        $shape = json_decode(file_get_contents(base_path('tests/Fixtures/curved-walls.json')), true)['shape'];
        $curve = $patch + $shape + ['kind' => 'ellipse', 'group' => 'curve-room', 'start' => 0, 'sweep' => 90];
        $vertices = $edges = [];
        for ($i = 0; $i < 4; $i++) {
            $part = array_replace($curve, ['start' => $i * 90]);
            $vertices[] = ['id' => 'v'.$i] + WallCurve::point($part, 0);
            $edges[] = array_replace($this->edge('e'.$i, 'v'.$i, 'v'.(($i + 1) % 4)), ['curve' => $part, 'blocksVision' => true]);
        }

        return ['vertices' => $vertices, 'edges' => $edges, 'rooms' => [['id' => 'room', 'loop' => array_column($vertices, 'id'), 'materialVersionId' => null]]];
    }

    public function test_curves_roundtrip_history_projection_and_shared_geometry_fixture(): void
    {
        $graph = $this->curvedRoom();
        $reordered = $graph;
        foreach ($reordered['edges'] as &$edge) {
            $edge['curve'] = array_reverse($edge['curve'], true);
        }
        unset($edge);
        $this->assertSame(StructureData::hash($graph), StructureData::hash($reordered));
        $created = $this->save($graph)->assertOk()->json();
        $stored = $this->scene->fresh()->mapWorld->structure;
        $fixture = json_decode(file_get_contents(base_path('tests/Fixtures/curved-walls.json')), true);
        $compiled = StructuralGeometry::compile($stored);
        $this->assertCount(72, $compiled['segments']);
        foreach ($compiled['segments'] as $i => $segment) {
            $this->assertEqualsWithDelta($fixture['runs'][$i]['a']['x'], $segment['a']['x'], 1e-7);
            $this->assertEqualsWithDelta($fixture['runs'][$i]['b']['y'], $segment['b']['y'], 1e-7);
            $this->assertTrue($segment['roundA'] && $segment['roundB']);
            $dx = $segment['b']['x'] - $segment['a']['x'];
            $dy = $segment['b']['y'] - $segment['a']['y'];
            $length = hypot($dx, $dy);
            foreach ([0, .5, 1] as $t) {
                $p = ['x' => $segment['a']['x'] + $dx * $t, 'y' => $segment['a']['y'] + $dy * $t];
                $a = ['x' => $p['x'] - $dy / $length * 12, 'y' => $p['y'] + $dx / $length * 12];
                $b = ['x' => $p['x'] + $dy / $length * 12, 'y' => $p['y'] - $dx / $length * 12];
                $this->assertTrue((new MovementCollision)->blocks($a, $b, .1, $compiled['shapes']), 'No collision seam at '.$i.':'.$t);
            }

        }
        foreach (['blocksVision', 'blocksLight'] as $flag) {
            $los = new LineOfSight($compiled, $flag);
            $this->assertFalse($los->point(['x' => 360, 'y' => 300], ['x' => 700, 'y' => 300])['visible']);
            $this->assertTrue($los->point(['x' => 360, 'y' => 300], ['x' => 370, 'y' => 300])['visible']);
        }
        $moved = $this->curvedRoom(['rx' => 155, 'rotation' => 35]);
        $this->save($moved)->assertOk();
        $edit = $created['structureEdit'];
        $current = StructureData::projection($this->scene->fresh(), true);
        $this->command('edit-history', ['changes' => [['kind' => 'structure', 'id' => $this->scene->id,
            'expected' => ['hash' => $current['hash']], 'value' => $edit['after']]]])->assertOk();
        $this->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk()->assertJsonPath('structure.hash', $created['structure']['hash']);
        $this->actingAs($this->player);
        $this->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk()
            ->assertJsonPath('structure.graph.edges.0.curve.rx', 140)
            ->assertJsonMissingPath('structure.graph.edges.0.blocksVision');
        $this->save($graph)->assertForbidden();
    }

    public function test_curve_openings_keep_identity_arclength_and_reject_unsafe_resize_atomically(): void
    {
        $graph = $this->curvedRoom();
        $graph['openings'] = [['id' => 'door', 'edgeId' => 'e0', 'type' => 'door', 'center' => .5, 'width' => 40,
            'open' => false, 'locked' => false, 'hinge' => 'a', 'direction' => 'left', 'angle' => 90]];
        $this->save($graph)->assertOk();
        $next = $this->curvedRoom(['rx' => 160]);
        $next['openings'] = $graph['openings'];
        $this->save($next)->assertOk();
        $compiled = StructuralGeometry::compile($next);
        $panel = array_values(array_filter($compiled['segments'], fn ($s) => isset($s['openingId'])))[0];
        $path = WallCurve::path($next['edges'][0], array_column($next['vertices'], null, 'id'));
        $left = WallCurve::along($path, WallCurve::length($path) / 2 - 20);
        $this->assertEquals($left, $panel['a']);
        $bad = $this->curvedRoom(['rx' => 20, 'ry' => 20]);
        $bad['openings'] = $graph['openings'];
        $revision = $this->scene->fresh()->revision;
        $this->save($bad)->assertUnprocessable();
        $this->assertSame($revision, $this->scene->fresh()->revision);
        $this->assertSame(StructureData::hash($this->scene->fresh()->mapWorld->structure), StructureData::hash(StructureData::graph($this->scene->fresh())));
    }

    public function test_curves_reject_inconsistent_endpoints_crossings_and_tight_radius_without_mutation(): void
    {
        $graph = $this->curvedRoom();
        $this->save($graph)->assertOk();
        $invalid = $graph;
        $invalid['edges'][0]['curve']['rx'] += 10;
        $this->save($invalid)->assertUnprocessable();
        $invalid = $graph;
        $invalid['edges'][0]['curve']['sweep'] = 0;
        $this->save($invalid)->assertUnprocessable();
        $invalid = $graph;
        $invalid['edges'][0]['curve']['unexpected'] = true;
        $this->save($invalid)->assertUnprocessable();
        $invalid = $graph;
        $invalid['vertices'][] = ['id' => 'outside', 'x' => 700, 'y' => 300];
        $invalid['vertices'][] = ['id' => 'inside', 'x' => 360, 'y' => 300];
        $invalid['edges'][] = $this->edge('crossing', 'outside', 'inside');
        $this->save($invalid)->assertUnprocessable();
        $this->assertSame(1, $this->scene->fresh()->revision);
    }

    public function test_curved_junction_preserves_room_contour_and_reshapes_attached_straight_wall(): void
    {
        $graph = $this->curvedRoom();
        $this->save($graph)->assertOk();
        $curve = $graph['edges'][0]['curve'];
        $graph['vertices'][] = ['id' => 'junction'] + WallCurve::point($curve, .5);
        $graph['vertices'][] = ['id' => 'outer', 'x' => 650, 'y' => 500];
        $graph['edges'][0]['b'] = 'junction';
        $graph['edges'][0]['curve']['sweep'] = 45;
        $graph['edges'][] = $this->edge('e4', 'junction', 'v1') + ['curve' => array_replace($curve, ['start' => 45, 'sweep' => 45])];
        $graph['edges'][] = $this->edge('e5', 'junction', 'outer');
        array_splice($graph['rooms'][0]['loop'], 1, 0, ['junction']);
        $this->save($graph)->assertOk();
        $this->assertCount(5, StructureData::graph($this->scene->fresh())['rooms'][0]['loop']);
        foreach ($graph['edges'] as &$edge) {
            if (isset($edge['curve'])) {
                $edge['curve']['rx'] = 150;
            }
        }
        unset($edge);
        foreach ($graph['vertices'] as &$vertex) {
            foreach ($graph['edges'] as $edge) {
                if (isset($edge['curve']) && $edge['a'] === $vertex['id']) {
                    $vertex = ['id' => $vertex['id']] + WallCurve::point($edge['curve'], 0);
                }
            }
        }
        unset($vertex);
        $this->save($graph)->assertOk();
    }

    public function test_t_and_x_junctions_split_all_axes_preserve_room_and_openings_and_replay_exactly(): void
    {
        $graph = $this->room();
        $graph['openings'] = [['id' => 'door', 'edgeId' => 'ea', 'type' => 'door', 'center' => .2, 'width' => 20,
            'open' => false, 'locked' => true, 'hinge' => 'a', 'direction' => 'left', 'angle' => 90]];
        $initial = $this->save($graph)->assertOk()->json('structure');
        $graph['vertices'][] = ['id' => 'outside', 'x' => 250, 'y' => 60];
        $graph['vertices'][] = ['id' => 'inside', 'x' => 210, 'y' => 180];
        $graph['edges'][] = $this->edge('diagonal', 'outside', 'inside');
        $graph['vertices'][] = ['id' => 'stem', 'x' => 240, 'y' => 360];
        $graph['vertices'][] = ['id' => 'tip', 'x' => 400, 'y' => 480];
        $graph['edges'][] = $this->edge('branch', 'stem', 'tip');
        $edit = $this->save($graph)->assertOk()->json();
        $next = $edit['structure']['graph'];
        $this->assertCount(9, $next['edges']);
        $this->assertCount(6, $next['rooms'][0]['loop']);
        $joint = array_values(array_filter($next['vertices'], fn ($v) => $v['x'] == 230 && $v['y'] == 120))[0];
        $this->assertCount(4, array_filter($next['edges'], fn ($e) => $e['a'] === $joint['id'] || $e['b'] === $joint['id']));
        $this->assertCount(3, array_filter($next['edges'], fn ($e) => $e['a'] === 'stem' || $e['b'] === 'stem'));
        $opening = $next['openings'][0];
        $this->assertSame('door', $opening['id']);
        $this->assertTrue($opening['locked']);
        $wall = array_column($next['edges'], null, 'id')[$opening['edgeId']];
        $vertices = array_column($next['vertices'], null, 'id');
        $this->assertEqualsWithDelta(156, $vertices[$wall['a']]['x'] + ($vertices[$wall['b']]['x'] - $vertices[$wall['a']]['x']) * $opening['center'], .001);
        $this->getJson("/api/scenes/{$this->scene->id}/snapshot")->assertOk()->assertJsonPath('structure.hash', $edit['structure']['hash']);
        foreach (['before', 'after'] as $phase) {
            $this->command('edit-history', ['changes' => [[
                'kind' => 'structure', 'id' => $this->scene->id,
                'expected' => $edit['structureEdit'][$phase === 'before' ? 'after' : 'before'],
                'value' => $edit['structureEdit'][$phase],
            ]]])->assertOk()->assertJsonPath('structure.hash', $phase === 'before' ? $initial['hash'] : $edit['structure']['hash']);
        }
    }

    public function test_junction_at_an_opening_is_atomic_and_endpoint_join_keeps_both_walls(): void
    {
        $graph = $this->room();
        $graph['openings'] = [['id' => 'door', 'edgeId' => 'ea', 'type' => 'door', 'center' => .5, 'width' => 40,
            'open' => false, 'locked' => false, 'hinge' => 'a', 'direction' => 'left', 'angle' => 90]];
        $initial = $this->save($graph)->assertOk()->json('structure');
        $bad = $graph;
        $bad['vertices'][] = ['id' => 'p', 'x' => 210, 'y' => 60];
        $bad['vertices'][] = ['id' => 'q', 'x' => 210, 'y' => 180];
        $bad['edges'][] = $this->edge('cross', 'p', 'q');
        $this->save($bad)->assertUnprocessable()->assertJsonPath('message', 'Разрез слишком близко к проёму.');
        $this->assertSame($initial['hash'], StructureData::hash(StructureData::graph($this->scene->fresh())));
        $graph['vertices'][] = ['id' => 'same', 'x' => 300, 'y' => 120];
        $graph['vertices'][] = ['id' => 'tip', 'x' => 400, 'y' => 80];
        $graph['edges'][] = $this->edge('branch', 'same', 'tip');
        $next = $this->save($graph)->assertOk()->json('structure.graph');
        $this->assertCount(5, $next['edges']);
        $this->assertCount(5, $next['vertices']);
        $this->assertSame('vb', array_column($next['edges'], 'a', 'id')['branch']);
        $this->actingAs($this->player);
        $this->save($next)->assertForbidden();
    }

    public function test_move_and_split_preserves_opening_in_translated_wall_and_checks_new_fragments_for_tokens(): void
    {
        $graph = ['vertices' => [['id' => 'a', 'x' => 100, 'y' => 100], ['id' => 'b', 'x' => 500, 'y' => 100],
            ['id' => 'c', 'x' => 300, 'y' => 200], ['id' => 'd', 'x' => 300, 'y' => 400]],
            'edges' => [$this->edge('moving', 'a', 'b'), $this->edge('fixed', 'c', 'd')], 'rooms' => [],
            'openings' => [['id' => 'door', 'edgeId' => 'moving', 'type' => 'door', 'center' => .8, 'width' => 40,
                'open' => false, 'locked' => false, 'hinge' => 'a', 'direction' => 'left', 'angle' => 90]]];
        $this->save($graph)->assertOk();
        $graph['vertices'][0]['y'] += 150;
        $graph['vertices'][1]['y'] += 150;
        $token = $this->scene->tokens()->create(['name' => 'Occupant', 'x' => 480, 'y' => 250, 'size' => 20]);
        $this->save($graph)->assertUnprocessable()->assertJsonPath('message', 'Перемещение перекрывает место, занятое токеном.');
        $token->delete();
        $next = $this->save($graph)->assertOk()->json('structure.graph');
        $this->assertCount(4, $next['edges']);
        $opening = $next['openings'][0];
        $wall = array_column($next['edges'], null, 'id')[$opening['edgeId']];
        $vertices = array_column($next['vertices'], null, 'id');
        $this->assertEqualsWithDelta(420, $vertices[$wall['a']]['x'] + ($vertices[$wall['b']]['x'] - $vertices[$wall['a']]['x']) * $opening['center'], .001);
        $this->assertEquals(250, $vertices[$wall['a']]['y']);
    }

    public function test_welding_both_moved_endpoints_cannot_bypass_token_collision(): void
    {
        $graph = ['vertices' => [['id' => 'a', 'x' => 100, 'y' => 100], ['id' => 'b', 'x' => 200, 'y' => 100],
            ['id' => 'c', 'x' => 300, 'y' => 200], ['id' => 'd', 'x' => 400, 'y' => 200],
            ['id' => 'e', 'x' => 300, 'y' => 350], ['id' => 'f', 'x' => 500, 'y' => 350]],
            'edges' => [$this->edge('moving', 'a', 'b'), $this->edge('left', 'c', 'e'), $this->edge('right', 'd', 'f')], 'rooms' => []];
        $initial = $this->save($graph)->assertOk()->json('structure');
        $graph['vertices'][0] = ['id' => 'a', 'x' => 300, 'y' => 200];
        $graph['vertices'][1] = ['id' => 'b', 'x' => 400, 'y' => 200];
        $token = $this->scene->tokens()->create(['name' => 'Occupant', 'x' => 350, 'y' => 200, 'size' => 20]);
        $this->save($graph)->assertUnprocessable()->assertJsonPath('message', 'Перемещение перекрывает место, занятое токеном.');
        $this->assertSame($initial['hash'], StructureData::hash(StructureData::graph($this->scene->fresh())));
        $token->delete();
        $next = $this->save($graph)->assertOk()->json('structure.graph');
        $this->assertCount(4, $next['vertices']);
        $this->assertCount(3, $next['edges']);
        $this->assertSame('c', array_column($next['edges'], 'a', 'id')['moving']);
        $this->assertSame('d', array_column($next['edges'], 'b', 'id')['moving']);
    }

    public function test_curve_only_shape_change_cannot_enclose_an_occupied_wall_run(): void
    {
        $curve = ['kind' => 'circle', 'group' => 'arc', 'cx' => 360, 'cy' => 300, 'rx' => 100, 'ry' => 100, 'rotation' => 0, 'start' => 0, 'sweep' => 90];
        $graph = ['vertices' => [['id' => 'a', 'x' => 460, 'y' => 300], ['id' => 'b', 'x' => 360, 'y' => 400]],
            'edges' => [$this->edge('arc', 'a', 'b') + ['curve' => $curve]], 'rooms' => []];
        $this->save($graph)->assertOk();
        $this->scene->tokens()->create(['name' => 'Occupant', 'x' => 260, 'y' => 300, 'size' => 20]);
        $graph['edges'][0]['curve']['sweep'] = -270;
        $this->save($graph)->assertUnprocessable()->assertJsonPath('message', 'Перемещение перекрывает место, занятое токеном.');
        $this->assertSame(1, $this->scene->fresh()->revision);
    }
}
