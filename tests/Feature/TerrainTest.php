<?php

namespace Tests\Feature;

use App\Actions\MapWorldActions;
use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\MapMaterialVersion;
use App\Models\Scene;
use App\Models\User;
use App\Services\TerrainBrush;
use App\Services\TerrainData;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class TerrainTest extends TestCase
{
    use RefreshDatabase;

    private User $gm;

    private User $player;

    private Scene $scene;

    private Campaign $campaign;

    private array $materials;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutVite();
        Storage::fake('campaigns');
        Event::fake([TabletopEvent::class]);
        $this->gm = User::factory()->create();
        $this->player = User::factory()->create();
        $this->campaign = Campaign::create(['name' => 'Terrain']);
        $this->campaign->members()->attach($this->gm, ['role' => 'gm']);
        $this->campaign->members()->attach($this->player, ['role' => 'player']);
        $this->scene = $this->campaign->scenes()->create(['name' => 'World', 'width' => 1024, 'height' => 1024]);
        $this->scene->mapWorld()->create([]);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->actingAs($this->gm);
        foreach (['grass', 'path'] as $name) {
            Storage::disk('campaigns')->put($name.'.png', 'private texture');
            $asset = Asset::create(['library_user_id' => $this->gm->id, 'uploaded_by' => $this->gm->id,
                'kind' => 'art', 'name' => $name, 'original_name' => $name.'.png', 'storage_path' => $name.'.png',
                'mime_type' => 'image/png', 'file_size' => 15, 'width' => 128, 'height' => 128]);
            $this->materials[] = $this->postJson('/api/library/materials', ['name' => $name, 'type' => 'terrain', 'assetId' => $asset->id,
                'repeatSize' => 120, 'rotation' => 0, 'variation' => ['offset' => true, 'quarterTurns' => true]])->assertOk()->json();
        }
    }

    private function stroke(array $patch = [], ?string $uuid = null)
    {
        $brush = ['operation' => 'paint', 'materialVersionId' => $this->materials[0]['versionId'], 'size' => 100,
            'softness' => 180, 'strength' => 255, 'points' => [['x' => 240, 'y' => 240], ['x' => 280, 'y' => 280]]];
        $brush = array_replace($brush, $patch);
        $coverage = app(TerrainBrush::class)->coverage($brush, $this->scene->width, $this->scene->height);
        $data = app(TerrainData::class);
        $expected = [];
        foreach ($coverage as $key => $_) {
            $expected[$key] = $data->hash($data->read($this->scene->fresh(), $key));
        }

        return $this->postJson('/api/scenes/'.$this->scene->id.'/terrain', $brush + [
            'expected' => $expected, 'clientMutationId' => $uuid ?? (string) Str::uuid()]);
    }

    private function masks(): array
    {
        $data = app(TerrainData::class);
        $result = [];
        foreach ($data->chunks($this->scene->fresh())->get() as $c) {
            $result[$c->x.':'.$c->y] = array_map(bin2hex(...), $data->read($this->scene->fresh(), $c->x.':'.$c->y));
        }
        ksort($result);

        return $result;
    }

    private function inverse(array $edit, bool $redo = false)
    {
        return $this->postJson('/api/scenes/'.$this->scene->id.'/edit-history', ['changes' => [[
            'kind' => 'terrain', 'id' => $this->scene->id, 'expected' => $edit[$redo ? 'before' : 'after']['hashes'],
            'value' => ['snapshot' => $edit[$redo ? 'after' : 'before']['snapshot']],
        ]], 'clientMutationId' => (string) Str::uuid()]);
    }

    public function test_gm_can_paint_with_shared_terrain_on_a_blank_world(): void
    {
        $this->seed();
        $version = MapMaterialVersion::whereHas('material', fn ($q) => $q
            ->where('builtin_key', 'fantasy-classic/environment/woodland-grass'))->firstOrFail();
        $this->stroke(['materialVersionId' => $version->id])->assertOk();
        $this->actingAs($this->player)->getJson('/api/scenes/'.$this->scene->id.'/snapshot')
            ->assertJsonPath('terrain.materials.0.versionId', (string) $version->id);
    }

    public function test_sparse_masks_immutable_versions_receipts_reload_and_compact_events(): void
    {
        $uuid = (string) Str::uuid();
        $response = $this->stroke([], $uuid)->assertOk()->assertJsonPath('revision', 1)->json();
        $this->stroke(['expected' => $response['terrainEdit']['before']['hashes']], $uuid)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertSame(1, $this->scene->fresh()->revision);
        $this->assertDatabaseCount('terrain_chunks', 4);
        $snapshot = $this->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk()->json('terrain');
        $this->assertCount(4, $snapshot['chunks']);
        $this->assertArrayNotHasKey('layers', $snapshot['chunks'][0]);
        $chunk = $snapshot['chunks'][0];
        $url = '/api/scenes/'.$this->scene->id.'/terrain/'.str_replace(':', '/', $chunk['key']).'?hash='.$chunk['hash'];
        $this->getJson($url)->assertOk()->assertJsonPath('layers.'.$this->materials[0]['versionId'], $this->masks()[$chunk['key']][$this->materials[0]['versionId']]);
        $version = MapMaterialVersion::findOrFail($this->materials[0]['versionId']);
        $this->patchJson('/api/library/materials/'.$this->materials[0]['id'], ['name' => 'changed', 'type' => 'floor', 'assetId' => $version->asset_id,
            'version' => 1, 'repeatSize' => 500, 'rotation' => 90, 'variation' => ['offset' => false, 'quarterTurns' => false]])->assertOk();
        $this->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertJsonPath('terrain.materials.0.repeatSize', 120);
        $this->deleteJson('/api/library/materials/'.$this->materials[0]['id'])->assertConflict();
        foreach (Event::dispatched(TabletopEvent::class)->pluck(0) as $event) {
            $payload = $event->envelope['payload'] ?? [];
            $this->assertArrayNotHasKey('terrainEdit', $payload);
            $this->assertLessThan(8000, strlen(json_encode($payload)));
        }
        $this->assertArrayHasKey('terrainEdit', $response);
    }

    public function test_exact_paint_erase_overlap_undo_redo_and_edit_after_reload(): void
    {
        $first = $this->stroke()->assertOk()->json('terrainEdit');
        $painted = $this->masks();
        $this->inverse($first)->assertOk();
        $this->assertSame([], $this->masks());
        $this->inverse($first, true)->assertOk();
        $this->assertSame($painted, $this->masks());
        $second = $this->stroke(['materialVersionId' => $this->materials[1]['versionId'], 'strength' => 128])->assertOk()->json('terrainEdit');
        $mixed = $this->masks();
        $this->assertCount(2, $mixed['0:0']);
        $this->assertNotEquals($painted, $mixed);
        $this->inverse($second)->assertOk();
        $this->assertSame($painted, $this->masks());
        $this->inverse($second, true)->assertOk();
        $this->assertSame($mixed, $this->masks());
        $this->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk();
        $erase = $this->stroke(['operation' => 'erase', 'strength' => 140])->assertOk()->json('terrainEdit');
        $this->assertNotEquals($mixed, $this->masks());
        $this->inverse($erase)->assertOk();
        $this->assertSame($mixed, $this->masks());
    }

    public function test_long_retraced_wide_stroke_commits_and_restores_as_one_revision(): void
    {
        $this->scene->update(['width' => 4096, 'height' => 2048]);
        $points = array_map(fn ($i) => ['x' => $i % 2 ? 3100 : 550, 'y' => 800], range(0, 699));
        $stroke = ['size' => 1024, 'strength' => 173, 'points' => $points];
        $result = $this->stroke($stroke)->assertOk()->assertJsonPath('revision', 1)->json();
        $this->assertGreaterThan(32, count($result['terrain']['chunks']));
        $painted = $this->masks();
        $this->inverse($result['terrainEdit'])->assertOk()->assertJsonPath('revision', 2);
        $this->assertSame([], $this->masks());
        $this->inverse($result['terrainEdit'], true)->assertOk()->assertJsonPath('revision', 3);
        $this->assertSame($painted, $this->masks());

        $erase = $this->stroke($stroke + ['operation' => 'erase'])->assertOk()->json('terrainEdit');
        $this->assertNotSame($painted, $this->masks());
        $this->inverse($erase)->assertOk();
        $this->assertSame($painted, $this->masks());
    }

    public function test_conflicts_are_atomic_and_history_never_rolls_back_gameplay(): void
    {
        $first = $this->stroke()->assertOk()->json('terrainEdit');
        $this->stroke(['materialVersionId' => $this->materials[1]['versionId']])->assertOk();
        $token = $this->scene->tokens()->create(['name' => 'Hero', 'hp' => 7, 'x' => 100, 'y' => 100]);
        $current = $this->masks();
        $this->inverse($first)->assertConflict();
        $this->assertSame($current, $this->masks());
        $this->assertSame(7, $token->fresh()->hp);
        $this->assertSame(2, $this->scene->fresh()->revision);
        // Disjoint chunks accept independent expected hashes despite unrelated scene revisions.
        $disjoint = $this->stroke(['points' => [['x' => 800, 'y' => 800]]])->assertOk()->json('terrainEdit');
        $token->update(['hp' => 3]);
        $this->scene->increment('revision');
        $this->inverse($disjoint)->assertOk();
        $this->assertSame(3, $token->fresh()->hp);
    }

    public function test_private_permissions_player_projection_and_asset_access_revocation(): void
    {
        $asset = $this->materials[0]['asset']['id'];
        $this->actingAs($this->player)->get('/api/assets/'.$asset)->assertForbidden();
        $this->actingAs($this->gm);
        $edit = $this->stroke()->assertOk()->json('terrainEdit');
        $this->actingAs($this->player);
        $snapshot = $this->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk()->assertJsonMissingPath('terrain.materials.0.name')->json('terrain');
        $chunk = $snapshot['chunks'][0];
        $url = '/api/scenes/'.$this->scene->id.'/terrain/'.str_replace(':', '/', $chunk['key']).'?hash='.$chunk['hash'];
        $this->getJson($url)->assertOk();
        $this->get('/api/assets/'.$asset)->assertOk();
        $this->postJson('/api/scenes/'.$this->scene->id.'/terrain', [])->assertForbidden();
        $this->inverse($edit)->assertForbidden();
        $this->actingAs(User::factory()->create())->getJson($url)->assertForbidden();
        $this->get('/api/assets/'.$asset)->assertForbidden();
        $this->actingAs($this->gm);
        $this->inverse($edit)->assertOk();
        $this->actingAs($this->player)->get('/api/assets/'.$asset)->assertForbidden();
        $this->campaign->forceFill(['active_scene_id' => null])->save();
        $this->getJson($url)->assertForbidden();
    }

    public function test_ownership_bounds_limits_and_world_inverse_dependencies(): void
    {
        $this->stroke(['materialVersionId' => $this->materials[0]['versionId']])->assertOk();
        $before = app(MapWorldActions::class)->state($this->scene->fresh());
        $this->postJson('/api/scenes/'.$this->scene->id.'/edit-history', ['changes' => [[
            'kind' => 'mapWorld', 'id' => $this->scene->id, 'expected' => $before, 'value' => array_replace($before, ['enabled' => false]),
        ]]])->assertConflict();
        $this->postJson('/api/scenes/'.$this->scene->id.'/map-world', ['expected' => $before, 'value' => array_replace($before, ['width' => 150])])->assertUnprocessable();
        $version = MapMaterialVersion::find($this->materials[1]['versionId']);
        DB::table('map_materials')->where('id', $version->map_material_id)->update(['user_id' => User::factory()->create()->id]);
        $this->stroke(['materialVersionId' => $version->id])->assertForbidden();
        $this->postJson('/api/scenes/'.$this->scene->id.'/terrain', ['operation' => 'paint', 'size' => 0])->assertUnprocessable();
        $this->postJson('/api/scenes/'.$this->scene->id.'/terrain', ['operation' => 'erase', 'size' => 100, 'softness' => 0, 'strength' => 255,
            'points' => [['x' => 1100, 'y' => 0]], 'expected' => ['0:0' => null]])->assertUnprocessable();
    }

    public function test_duplication_copies_masks_independently_and_keeps_material_versions(): void
    {
        $this->stroke()->assertOk();
        $copy = $this->postJson('/api/scenes/'.$this->scene->id.'/duplicate', ['name' => 'Copy'])->assertOk()->json('id');
        $scene = Scene::findOrFail($copy);
        $data = app(TerrainData::class);
        $this->assertSame($data->read($this->scene->fresh(), '0:0'), $data->read($scene, '0:0'));
        $this->stroke(['operation' => 'erase'])->assertOk();
        $this->assertNotEquals($data->read($this->scene->fresh(), '0:0'), $data->read($scene, '0:0'));
    }

    public function test_brush_v1_golden_bytes_and_stale_chunk_reads(): void
    {
        $coverage = app(TerrainBrush::class)->coverage(['size' => 100, 'softness' => 180, 'strength' => 173,
            'points' => [['x' => 240.25, 'y' => 249.5], ['x' => 280.5, 'y' => 280.25]]], 1024, 1024);
        $this->assertSame([
            '0:0' => 'b81bdf93b6d865327a182166259740e7c8776eea14dffe35fa47216c57a6a99d',
            '1:0' => 'a338ad2781b014b4f40bb823e22d2a8b375d93962b6c9d3aa031e54020cd2d70',
            '0:1' => '4cc356872183223af68cb3097821a4a30a4299662ac572cd23e7ca0d516172ed',
            '1:1' => '526bef761f7d5484b5fb283ff102c8ae4cb299134e723c3e026a90e835e8d238',
        ], array_map(fn ($mask) => hash('sha256', $mask), $coverage));
        $response = $this->stroke()->assertOk()->json();
        $this->stroke(['operation' => 'erase'])->assertOk();
        $old = $response['terrain']['chunks'][0];
        $this->getJson('/api/scenes/'.$this->scene->id.'/terrain/'.str_replace(':', '/', $old['key']).'?hash='.$old['hash'])->assertConflict();
        $this->stroke(['expected' => $response['terrainEdit']['after']['hashes']])->assertConflict();
    }

    public function test_terrain_redo_survives_undo_and_redo_of_foundation_creation(): void
    {
        $settings = app(MapWorldActions::class)->state($this->scene->fresh());
        $worldId = $this->scene->fresh()->mapWorld->id;
        $edit = $this->stroke()->assertOk()->json('terrainEdit');
        $painted = $this->masks();
        $this->inverse($edit)->assertOk();
        $disabled = array_replace($settings, ['enabled' => false]);
        $this->postJson('/api/scenes/'.$this->scene->id.'/edit-history', ['changes' => [[
            'kind' => 'mapWorld', 'id' => $this->scene->id, 'expected' => $settings, 'value' => $disabled,
        ]]])->assertOk();
        $this->postJson('/api/scenes/'.$this->scene->id.'/edit-history', ['changes' => [[
            'kind' => 'mapWorld', 'id' => $this->scene->id, 'expected' => $disabled, 'value' => $settings,
        ]]])->assertOk();
        $this->assertNotSame($worldId, $this->scene->fresh()->mapWorld->id);
        $this->inverse($edit, true)->assertOk();
        $this->assertSame($painted, $this->masks());
    }
}
