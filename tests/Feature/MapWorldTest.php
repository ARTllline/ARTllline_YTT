<?php

namespace Tests\Feature;

use App\Actions\MapWorldActions;
use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\Scene;
use App\Models\SceneNote;
use App\Models\SceneRegion;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class MapWorldTest extends TestCase
{
    use RefreshDatabase;

    private User $gm;

    private User $player;

    private Campaign $campaign;

    private Scene $scene;

    private Asset $asset;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutVite();
        $this->gm = User::factory()->create();
        $this->player = User::factory()->create();
        $this->campaign = Campaign::create(['name' => 'Map preparation']);
        $this->campaign->members()->attach($this->gm, ['role' => 'gm']);
        $this->campaign->members()->attach($this->player, ['role' => 'player']);
        $this->asset = Asset::create(['library_user_id' => $this->gm->id, 'uploaded_by' => $this->gm->id,
            'kind' => 'map', 'name' => 'Reference', 'original_name' => 'reference.png', 'storage_path' => 'private/reference.png',
            'mime_type' => 'image/png', 'file_size' => 100, 'width' => 1200, 'height' => 900]);
        $this->scene = $this->campaign->scenes()->create(['name' => 'Legacy', 'map_asset_id' => $this->asset->id,
            'width' => 1440, 'height' => 1080, 'map_width' => 1200, 'map_height' => 900]);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->actingAs($this->gm);
        Event::fake([TabletopEvent::class]);
    }

    private function state(?Scene $scene = null): array
    {
        return app(MapWorldActions::class)->state(($scene ?? $this->scene)->fresh());
    }

    private function save(array $value, ?array $expected = null, ?string $id = null)
    {
        return $this->postJson('/api/scenes/'.$this->scene->id.'/map-world', [
            'value' => $value, 'expected' => $expected ?? $this->state(), 'clientMutationId' => $id ?? (string) Str::uuid(),
        ]);
    }

    public function test_additive_migration_leaves_existing_scene_and_image_untouched(): void
    {
        $migration = require database_path('migrations/2026_11_03_000100_create_map_worlds.php');
        $migration->down();
        $attributes = $this->scene->fresh()->getAttributes();
        $migration->up();
        $this->assertDatabaseCount('map_worlds', 0);
        $this->assertEquals($attributes, $this->scene->fresh()->getAttributes());
        $this->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk()
            ->assertJsonPath('mapWorld', null)->assertJsonPath('map.asset.id', (string) $this->asset->id)
            ->assertJsonMissingPath('map.crop');
    }

    public function test_atomic_create_crop_grid_reload_replay_and_player_projection(): void
    {
        $before = $this->state();
        $value = array_replace_recursive($before, ['enabled' => true, 'width' => 1800, 'height' => 1400,
            'map' => ['x' => 25, 'y' => 35, 'width' => 1500, 'height' => 1125, 'crop' => ['x' => 0.1, 'y' => 0, 'width' => 0.8, 'height' => 1]],
            'grid' => ['size' => 75, 'offset' => ['x' => 25, 'y' => 35], 'distancePerCell' => 1.5, 'distanceUnit' => 'm']]);
        $assetBefore = $this->asset->fresh()->getAttributes();
        $id = (string) Str::uuid();
        $this->save($value, $before, $id)->assertOk()->assertJsonPath('revision', 1)->assertJsonPath('mapWorld.schemaVersion', 1);
        $this->save($value, $before, $id)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertSame(1, $this->scene->fresh()->revision);
        $this->assertDatabaseCount('map_worlds', 1);
        $this->assertEquals($assetBefore, $this->asset->fresh()->getAttributes());
        $this->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertJsonPath('width', 1800)
            ->assertJsonPath('mapWorld.bounds.height', 1400)->assertJsonPath('map.crop.x', 0.1)
            ->assertJsonPath('grid.size', 75)->assertJsonPath('grid.distanceUnit', 'm');
        $this->actingAs($this->player)->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk()
            ->assertJsonMissingPath('mapWorld.schemaVersion')->assertJsonPath('mapWorld.bounds.width', 1800);
        $events = Event::dispatched(TabletopEvent::class)->pluck(0)->filter(fn ($e) => str_contains($e->channel, '.user.'.$this->player->id));
        $this->assertCount(1, $events);
        $event = $events->first();
        $this->assertSame('map-world.updated', $event->envelope['type']);
        $this->assertArrayNotHasKey('schemaVersion', $event->envelope['payload']['mapWorld']);
        $this->assertSame(1800, $event->envelope['payload']['scene']['width']);
    }

    public function test_blank_world_bounds_grid_and_scene_duplication_keep_runtime_entities(): void
    {
        $this->scene->update(['map_asset_id' => null]);
        $token = $this->scene->tokens()->create(['name' => 'Hero', 'x' => 200, 'y' => 250]);
        $prop = $this->scene->props()->create(['name' => 'Crate', 'x' => 300, 'y' => 350]);
        $value = array_replace_recursive($this->state(), ['enabled' => true, 'width' => 2000, 'height' => 1600, 'grid' => ['size' => 90]]);
        $this->save($value)->assertOk()->assertJsonPath('map', null);
        $this->assertEquals(200, $token->fresh()->x);
        $this->assertEquals(350, $prop->fresh()->y);
        $copy = $this->postJson('/api/scenes/'.$this->scene->id.'/duplicate', ['name' => 'Copy', 'clientMutationId' => (string) Str::uuid()])->assertOk()->json('id');
        $this->getJson('/api/scenes/'.$copy.'/snapshot')->assertOk()->assertJsonPath('mapWorld.bounds.width', 2000);
        $this->assertDatabaseCount('map_worlds', 2);
        $this->assertSame($this->scene->id, $this->campaign->fresh()->active_scene_id);
        $this->get('/campaigns/'.$this->campaign->id.'/scenes/'.$this->scene->id.'?mode=prepare')->assertOk();
        $this->get('/campaigns/'.$this->campaign->id.'/scenes/'.$this->scene->id.'?mode=session')->assertOk();
    }

    public function test_bounds_check_hidden_token_radius_and_rotated_prop_and_preserve_data_on_rejection(): void
    {
        $this->save(array_replace($this->state(), ['enabled' => true]))->assertOk();
        $token = $this->scene->tokens()->create(['name' => 'Hidden', 'x' => 900, 'y' => 300, 'size' => 100, 'scale' => 2, 'is_hidden' => true]);
        $before = $this->state();
        $this->save(array_replace($before, ['width' => 950]))->assertUnprocessable()->assertJsonValidationErrors('bounds');
        $this->assertEquals($before, $this->state());
        $this->patchJson('/api/scenes/'.$this->scene->id, ['width' => 950, 'clientMutationId' => (string) Str::uuid()])->assertUnprocessable();
        $token->delete();
        $prop = $this->scene->props()->create(['name' => 'Rotated', 'asset_id' => $this->asset->id, 'x' => 700, 'y' => 350,
            'scale_x' => 0.1, 'scale_y' => 0.5, 'rotation' => 90, 'is_hidden' => true]);
        $this->save(array_replace($before, ['width' => 900]))->assertUnprocessable()->assertJsonValidationErrors('bounds');
        $this->assertEquals(700, $prop->fresh()->x);
        $this->save(array_replace($before, ['width' => 1000]))->assertOk();
    }

    public function test_permissions_foreign_assets_and_stale_edits_never_mutate_or_publish(): void
    {
        $before = $this->state();
        $value = array_replace($before, ['enabled' => true]);
        $this->actingAs($this->player);
        $this->save($value, $before)->assertForbidden();
        $this->actingAs(User::factory()->create());
        $this->save($value, $before)->assertForbidden();
        $this->actingAs($this->gm);
        $bad = $value;
        $bad['map']['assetId'] = 999999;
        $this->save($bad, $before)->assertUnprocessable();
        $bad = $value;
        $bad['map']['crop'] = ['x' => 0.7, 'y' => 0, 'width' => 0.5, 'height' => 1];
        $this->save($bad, $before)->assertUnprocessable();
        $this->assertDatabaseCount('map_worlds', 0);
        Event::assertNotDispatched(TabletopEvent::class);
        $this->save($value, $before)->assertOk();
        $this->save(array_replace($value, ['width' => 1600]), $before)->assertConflict();
        $this->assertSame(1, $this->scene->fresh()->revision);
    }

    public function test_bounds_preserve_regions_and_notes_and_old_map_endpoint_clears_crop_on_replacement(): void
    {
        $value = $this->state();
        $value['enabled'] = true;
        $value['map']['crop'] = ['x' => 0, 'y' => 0, 'width' => 0.8, 'height' => 1];
        $this->save($value)->assertOk();
        $region = SceneRegion::create(['scene_id' => $this->scene->id, 'name' => 'Hazard', 'enabled' => true, 'shape' => 'circle', 'geometry' => ['x' => 1100, 'y' => 200, 'radius' => 100]]);
        $this->save(array_replace($this->state(), ['width' => 1150]))->assertUnprocessable()->assertJsonValidationErrors('bounds');
        $region->delete();
        SceneNote::create(['scene_id' => $this->scene->id, 'created_by' => $this->gm->id, 'x' => 1200, 'y' => 250, 'title' => 'GM note', 'body' => '', 'icon' => 'note']);
        $this->save(array_replace($this->state(), ['width' => 1150]))->assertUnprocessable();
        $this->putJson('/api/scenes/'.$this->scene->id.'/map', ['assetId' => null, 'x' => 0, 'y' => 0, 'width' => 1440, 'height' => 1080, 'clientMutationId' => (string) Str::uuid()])->assertOk()->assertJsonPath('map', null);
        $this->assertNull($this->scene->fresh()->mapWorld->reference_crop);
    }

    public function test_settings_undo_redo_and_create_undo_are_atomic_and_conflict_safe(): void
    {
        $before = $this->state();
        $this->save(array_replace($before, ['enabled' => true, 'width' => 1700]))->assertOk();
        $accepted = $this->state();
        $path = '/api/scenes/'.$this->scene->id.'/edit-history';
        $change = ['kind' => 'mapWorld', 'id' => (string) $this->scene->id, 'expected' => $accepted, 'value' => $before];
        $this->postJson($path, ['changes' => [$change], 'clientMutationId' => (string) Str::uuid()])->assertOk()->assertJsonPath('mapWorld', null)->assertJsonPath('revision', 2);
        $this->assertEquals($before, $this->state());
        $change['expected'] = $before;
        $change['value'] = $accepted;
        $this->postJson($path, ['changes' => [$change], 'clientMutationId' => (string) Str::uuid()])->assertOk()->assertJsonPath('revision', 3);
        $this->postJson($path, ['changes' => [$change], 'clientMutationId' => (string) Str::uuid()])->assertConflict();
        $this->assertEquals($accepted, $this->state());
        $this->actingAs($this->player)->postJson($path, ['changes' => [$change], 'clientMutationId' => (string) Str::uuid()])->assertForbidden();
    }
}
