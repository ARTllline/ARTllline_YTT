<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\LootContainer;
use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\User;
use App\Services\StructuralGeometry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class MapEditorPropsTest extends TestCase
{
    use RefreshDatabase;

    private User $gm;

    private User $player;

    private Scene $scene;

    private Asset $asset;

    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([TabletopEvent::class]);
        $this->gm = User::factory()->create();
        $this->player = User::factory()->create();
        $c = Campaign::create(['name' => 'Editor']);
        $c->members()->attach($this->gm, ['role' => 'gm']);
        $c->members()->attach($this->player, ['role' => 'player']);
        $this->scene = $c->scenes()->create(['name' => 'Legacy']);
        $c->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->asset = Asset::create(['library_user_id' => $this->gm->id, 'uploaded_by' => $this->gm->id, 'kind' => 'prop', 'name' => 'Stone', 'original_name' => 'stone.png', 'storage_path' => 'private/stone.png', 'mime_type' => 'image/png', 'file_size' => 100, 'width' => 96, 'height' => 48]);
        $this->actingAs($this->gm);
    }

    private function command(string $endpoint, array $data)
    {
        return $this->postJson('/api/scenes/'.$this->scene->id.'/'.$endpoint, $data + ['clientMutationId' => (string) Str::uuid()]);
    }

    private function create(): array
    {
        return $this->command('props', ['action' => 'create', 'assetId' => $this->asset->id, 'x' => 300, 'y' => 300])->assertOk()->json();
    }

    private function inverse(array $edit, bool $expected): array
    {
        return ['kind' => 'propPresence', 'id' => $edit['id'], 'expected' => ['present' => $expected, 'snapshot' => $edit['snapshot']], 'value' => ['present' => ! $expected, 'snapshot' => $edit['snapshot']]];
    }

    private function preset(array $shape): array
    {
        return ['name' => 'Oak', 'category' => 'Landscape', 'assetId' => $this->asset->id,
            'settings' => ['width' => 120, 'height' => 90, 'pivotX' => 0.25, 'pivotY' => 1,
                'scaleX' => 2, 'scaleY' => 0.5, 'rotation' => 90, 'tags' => ['climbable'],
                'collider' => $shape + ['blocksMovement' => true, 'blocksVision' => false, 'blocksLight' => true]],
            'clientMutationId' => (string) Str::uuid()];
    }

    public function test_preset_snapshot_geometry_undo_and_player_privacy(): void
    {
        $data = $this->preset(['type' => 'circle', 'x' => 40, 'y' => 50, 'radius' => 12]);
        $preset = $this->postJson('/api/library/object-presets', $data)->assertOk()->json();
        $url = '/api/library/object-presets/'.$preset['id'];
        $this->getJson('/api/library/object-presets?search=landscape')->assertJsonCount(1, 'presets');
        $copy = $this->postJson($url.'/duplicate', ['clientMutationId' => (string) Str::uuid()])->assertOk()->json();
        $this->assertNotSame($preset['id'], $copy['id']);
        $this->deleteJson('/api/assets/'.$this->asset->id)->assertConflict();
        $placement = ['action' => 'create', 'presetId' => $preset['id'], 'x' => 300, 'y' => 200];
        $result = $this->command('props', $placement)->assertOk()->assertJsonPath('props.0.image.width', 120)
            ->assertJsonPath('props.0.pivotX', 0.25)->assertJsonPath('props.0.collider.type', 'circle')->json();
        $id = $result['props'][0]['id'];
        $shape = StructuralGeometry::forScene($this->scene)['shapes'][0];
        $this->assertSame('prop:'.$id, $shape['id']);
        $this->assertSame('ellipse', $shape['kind']);
        $this->assertEqualsWithDelta(320, $shape['center']['x'], 0.00001);
        $this->assertEqualsWithDelta(220, $shape['center']['y'], 0.00001);
        $this->assertEquals(24, $shape['radiusX']);
        $this->assertEquals(6, $shape['radiusY']);
        $this->assertFalse($shape['blocksVision']);
        $graph = ['vertices' => [['id' => 'a', 'x' => 10, 'y' => 10], ['id' => 'b', 'x' => 210, 'y' => 10]],
            'edges' => [['id' => 'wall', 'a' => 'a', 'b' => 'b', 'thickness' => 20, 'materialVersionId' => null,
                'blocksMovement' => true, 'blocksVision' => true, 'blocksLight' => true]],
            'openings' => [['id' => 'window', 'edgeId' => 'wall', 'type' => 'window', 'center' => 0.5,
                'width' => 30, 'blocksMovement' => true, 'blocksVision' => false, 'blocksLight' => false]]];
        $compiled = StructuralGeometry::compile($graph, [SceneProp::findOrFail($id)]);
        $this->assertSame(['wall', 'opening', 'wall', 'prop'], array_column($compiled['shapes'], 'source'));
        $this->assertSame(['band', 'band', 'band', 'ellipse'], array_column($compiled['shapes'], 'kind'));
        $this->assertSame('opening:window', $compiled['shapes'][1]['id']);
        $this->assertFalse($compiled['shapes'][1]['blocksLight']);

        $changed = $this->preset(['type' => 'none']);
        $changed['settings']['width'] = 444;
        $this->patchJson($url, $changed)->assertOk();
        $this->deleteJson($url)->assertNoContent();
        $this->command('edit-history', ['changes' => [$this->inverse($result['propEdits'][0], true)]])->assertOk();
        $this->command('edit-history', ['changes' => [$this->inverse($result['propEdits'][0], false)]])->assertOk()
            ->assertJsonPath('props.0.collider.type', 'circle')->assertJsonPath('props.0.image.width', 120);
        $rectangle = ['type' => 'rectangle', 'x' => 30, 'y' => 80, 'width' => 20, 'height' => 10,
            'blocksMovement' => false, 'blocksVision' => true, 'blocksLight' => false];
        $this->command('props', ['action' => 'update', 'id' => $id, 'patch' => ['collider' => $rectangle]])
            ->assertOk()->assertJsonPath('props.0.collider.type', 'rectangle');
        $polygon = StructuralGeometry::forScene($this->scene)['shapes'][0];
        $this->assertSame('polygon', $polygon['kind']);
        $this->assertEqualsWithDelta(305, $polygon['points'][0]['x'], 0.00001);
        $this->assertTrue($polygon['blocksVision']);
        $this->command('edit-history', ['changes' => [['kind' => 'prop', 'id' => $id,
            'expected' => ['collider' => $rectangle], 'value' => ['collider' => $data['settings']['collider']]]]])
            ->assertOk()->assertJsonPath('props.0.collider.type', 'circle');

        $this->actingAs($this->player)->getJson('/api/library/object-presets')->assertJsonCount(0, 'presets');
        $this->deleteJson('/api/library/object-presets/'.$copy['id'])->assertNotFound();
        $this->command('props', $placement)->assertForbidden();
        $this->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk()
            ->assertJsonPath('props.0.pivotY', 1)->assertJsonMissingPath('props.0.collider')->assertJsonMissingPath('props.0.preset');
        Event::assertNotDispatched(TabletopEvent::class, fn ($event) => str_contains($event->channel, '.user.')
            && preg_match('/"collider"|"preset"|"climbable"/', json_encode($event->envelope)));
    }

    public function test_polygon_validation_rejects_degenerate_and_crossing_shapes(): void
    {
        foreach ([
            [[0, 0], [40, 40], [0, 40], [50, 0]],
            [[0, 0], [20, 0], [40, 0]],
            [[0, 0], [40, 0], [10, 0], [10, 40]],
            [[0, 0], [40, 0], [0, 0], [0, 40]],
            array_fill(0, 33, [0, 0]),
        ] as $vertices) {
            $points = array_map(fn ($p) => ['x' => $p[0], 'y' => $p[1]], $vertices);
            $this->postJson('/api/library/object-presets', $this->preset(['type' => 'polygon', 'points' => $points]))
                ->assertUnprocessable();
        }
        $points = [['x' => 0, 'y' => 0], ['x' => 20, 'y' => 0], ['x' => 40, 'y' => 0],
            ['x' => 40, 'y' => 40], ['x' => 20, 'y' => 25], ['x' => 0, 'y' => 40]];
        $this->postJson('/api/library/object-presets', $this->preset(['type' => 'polygon', 'points' => $points]))
            ->assertOk()->assertJsonCount(6, 'settings.collider.points');
    }

    public function test_create_duplicate_delete_presence_undo_redo_and_safe_player_events(): void
    {
        $created = $this->create();
        $edit = $created['propEdits'][0];
        $this->command('edit-history', ['changes' => [$this->inverse($edit, true)]])->assertOk()->assertJsonPath('deletedPropIds.0', $edit['id']);
        $this->assertDatabaseMissing('scene_props', ['id' => $edit['id']]);
        $this->command('edit-history', ['changes' => [$this->inverse($edit, false)]])->assertOk()->assertJsonPath('props.0.id', $edit['id']);
        $duplicated = $this->command('selection', ['action' => 'duplicate', 'tokenIds' => [], 'propIds' => [$edit['id']]])->assertOk()->json();
        $copy = $duplicated['propEdits'][0];
        $this->assertNotSame($edit['id'], $copy['id']);
        $this->command('edit-history', ['changes' => [$this->inverse($copy, true)]])->assertOk();
        $deleted = $this->command('selection', ['action' => 'delete', 'tokenIds' => [], 'propIds' => [$edit['id']]])->assertOk()->json('propEdits.0');
        $this->command('edit-history', ['changes' => [$this->inverse($deleted, false)]])->assertOk();
        $this->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertJsonCount(1, 'props')->assertJsonPath('mapWorld', null);
        Event::assertNotDispatched(TabletopEvent::class, fn ($e) => str_contains(json_encode($e->envelope), 'propEdits'));
        $this->actingAs($this->player);
        $this->command('props', ['action' => 'create', 'assetId' => $this->asset->id, 'x' => 1, 'y' => 1])->assertForbidden();
        $this->command('edit-history', ['changes' => [$this->inverse($edit, true)]])->assertForbidden();
    }

    public function test_presence_inverses_reject_tampering_cross_scene_conflicts_and_new_dependencies_atomically(): void
    {
        $edit = $this->create()['propEdits'][0];
        $bad = $edit;
        $bad['snapshot'] = 'forged';
        $this->command('edit-history', ['changes' => [$this->inverse($bad, true)]])->assertUnprocessable();
        $other = $this->scene->campaign->scenes()->create(['name' => 'Other']);
        $this->postJson('/api/scenes/'.$other->id.'/edit-history', ['changes' => [$this->inverse($edit, true)]])->assertUnprocessable();
        $p = SceneProp::findOrFail($edit['id']);
        $p->update(['x' => 400]);
        $this->command('edit-history', ['changes' => [$this->inverse($edit, true)]])->assertConflict();
        $p->update(['x' => 300]);
        LootContainer::create(['scene_id' => $this->scene->id, 'prop_id' => $p->id, 'name' => 'New dependency', 'kind' => 'container', 'created_by' => $this->gm->id]);
        $this->command('edit-history', ['changes' => [$this->inverse($edit, true)]])->assertConflict();
        $this->assertDatabaseHas('scene_props', ['id' => $p->id]);
        $this->assertSame(1, $this->scene->fresh()->revision);
        $deleted = $this->command('selection', ['action' => 'delete', 'tokenIds' => [], 'propIds' => [$edit['id']]])->assertOk()->json();
        $this->assertSame([], $deleted['propEdits']);
    }

    public function test_inspector_inverse_restores_negative_rotation_visibility_name_and_lock_without_leaks(): void
    {
        $id = $this->create()['props'][0]['id'];
        $this->command('props', ['action' => 'update', 'id' => $id, 'patch' => ['rotation' => -45, 'name' => 'Secret', 'is_hidden' => true, 'is_locked' => true]])->assertOk();
        $this->command('edit-history', ['changes' => [['kind' => 'prop', 'id' => $id, 'expected' => ['rotation' => -45, 'name' => 'Secret', 'isHidden' => true, 'isLocked' => true], 'value' => ['rotation' => 0, 'name' => 'Stone', 'isHidden' => false, 'isLocked' => false]]]])->assertOk()->assertJsonPath('props.0.name', 'Stone');
        $this->command('edit-history', ['changes' => [['kind' => 'prop', 'id' => $id, 'expected' => ['isHidden' => false], 'value' => ['isHidden' => true]]]])->assertOk();
        $this->actingAs($this->player)->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk()->assertJsonCount(0, 'props');
        Event::assertNotDispatched(TabletopEvent::class, fn ($e) => str_contains($e->channel, '.user.') && str_contains(json_encode($e->envelope), 'Secret'));
    }

    public function test_presence_batch_rolls_back_all_inverses_when_a_later_snapshot_is_invalid(): void
    {
        $first = $this->create()['propEdits'][0];
        $second = $this->create()['propEdits'][0];
        $second['snapshot'] = 'forged';
        $this->command('edit-history', ['changes' => [$this->inverse($first, true), $this->inverse($second, true)]])->assertUnprocessable();
        $this->assertDatabaseHas('scene_props', ['id' => $first['id']]);
        $this->assertDatabaseHas('scene_props', ['id' => $second['id']]);
        $this->assertSame(2, $this->scene->fresh()->revision);
    }
}
