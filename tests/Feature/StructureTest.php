<?php

namespace Tests\Feature;

use App\Actions\MapWorldActions;
use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\MapMaterial;
use App\Models\Scene;
use App\Models\User;
use App\Services\StructuralGeometry;
use App\Services\StructureData;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Tests\TestCase;

class StructureTest extends TestCase
{
    use RefreshDatabase;

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

    public function test_rejects_crossings_broken_loops_and_out_of_bounds_without_mutation(): void
    {
        $room = $this->room();
        $this->save($room)->assertOk();
        $invalid = $room;
        $invalid['vertices'][] = ['id' => 've', 'x' => 210, 'y' => 60];
        $invalid['vertices'][] = ['id' => 'vf', 'x' => 210, 'y' => 160];
        $invalid['edges'][] = $this->edge('ee', 've', 'vf');
        $this->save($invalid)->assertUnprocessable();
        $invalid = $room;
        array_pop($invalid['edges']);
        $this->save($invalid)->assertUnprocessable();
        $invalid = $room;
        $invalid['vertices'][0]['x'] = 5;
        $this->save($invalid)->assertUnprocessable();
        $before = app(MapWorldActions::class)->state($this->scene->fresh());
        $this->command('map-world', ['expected' => $before, 'value' => array_replace($before, ['width' => 300])])->assertUnprocessable();
        $this->command('edit-history', ['changes' => [[
            'kind' => 'mapWorld', 'id' => $this->scene->id, 'expected' => $before, 'value' => array_replace($before, ['enabled' => false]),
        ]]])->assertConflict();
        $this->assertSame(1, $this->scene->fresh()->revision);
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
}
