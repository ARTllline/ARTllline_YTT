<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\Scene;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class ScenePreparationTest extends TestCase
{
    use RefreshDatabase, \Tests\Support\SeedsCharacterCatalog;

    private User $gm;

    private Campaign $campaign;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCharacterCatalog();
        Storage::fake('campaigns');
        Event::fake([TabletopEvent::class]);
        $this->gm = User::factory()->create();
        $this->campaign = Campaign::create(['name' => 'Preparation']);
        $this->campaign->members()->attach($this->gm, ['role' => 'gm']);
        $this->actingAs($this->gm);
    }

    private function send(string $path, array $data = [])
    {
        return $this->postJson('/api/'.$path, $data + ['clientMutationId' => (string) Str::uuid()]);
    }

    private function settings(): array
    {
        return ['name' => 'Old mill', 'width' => 1440, 'height' => 1080,
            'grid' => ['size' => 60, 'offset' => ['x' => 4, 'y' => 8], 'visible' => true, 'snap' => true, 'distancePerCell' => 5, 'distanceUnit' => 'ft']];
    }

    public function test_atomic_create_edit_global_map_and_receipt_replay(): void
    {
        $asset = $this->post('/api/library/assets', ['category' => 'maps', 'file' => UploadedFile::fake()->image('Mill.png', 600, 480)], ['Accept' => 'application/json'])->assertOk()->json();
        $payload = $this->settings() + ['map' => ['assetId' => $asset['id'], 'x' => 0, 'y' => 0, 'width' => 600, 'height' => 480], 'clientMutationId' => (string) Str::uuid()];
        $path = 'campaigns/'.$this->campaign->id.'/scene-preparation';
        $id = $this->send($path, $payload)->assertOk()->json('id');
        $this->send($path, $payload)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertSame(1, Scene::count());
        $this->assertNull($this->campaign->fresh()->active_scene_id);
        $this->assertDatabaseHas('assets', ['id' => $asset['id'], 'campaign_id' => null, 'library_user_id' => $this->gm->id]);
        $this->getJson('/api/scenes/'.$id.'/snapshot')->assertOk()->assertJsonPath('map.asset.id', $asset['id'])->assertJsonPath('grid.offset.x', 4);
        $this->send($path, array_replace($this->settings(), ['sceneId' => $id, 'name' => 'Mill at night', 'map' => null]))->assertOk();
        $this->getJson('/api/scenes/'.$id.'/snapshot')->assertJsonPath('name', 'Mill at night')->assertJsonPath('map', null);
        $this->send($path, $this->settings() + ['map' => ['assetId' => 999999, 'x' => 0, 'y' => 0, 'width' => 600, 'height' => 480]])->assertUnprocessable();
        $this->assertSame(1, Scene::count());
    }

    public function test_global_character_copy_and_assigned_hero_link_keep_library_intact(): void
    {
        $scene = $this->campaign->scenes()->create(['name' => 'Stage']);
        $hero = $this->send('library/characters', ['name' => 'Hero', 'campaign_id' => null, 'hp' => 16, 'max_hp' => 20])->assertOk()->json('character.id');
        $original = Character::findOrFail($hero)->getAttributes();
        $payload = ['characterId' => $hero, 'x' => 120, 'y' => 180, 'clientMutationId' => (string) Str::uuid()];
        $placed = $this->send('scenes/'.$scene->id.'/characters', $payload)->assertOk()->json('token');
        $this->assertNotEquals($hero, $placed['characterId']);
        $this->send('scenes/'.$scene->id.'/characters', $payload)->assertOk()->assertHeader('Idempotent-Replay', 'true')->assertJsonPath('character.id', $placed['characterId'])->assertJsonPath('revision', $scene->fresh()->revision);
        $this->assertEquals($original, Character::findOrFail($hero)->getAttributes());
        $this->assertSame(1, $scene->tokens()->count());
        $this->send('scenes/'.$scene->id.'/characters', ['characterId' => $placed['characterId'], 'x' => 0, 'y' => 0])->assertUnprocessable();
        $second = $this->campaign->scenes()->create(['name' => 'Next stage']);
        $this->send('scenes/'.$second->id.'/characters', ['characterId' => $placed['characterId'], 'x' => 240, 'y' => 180])->assertOk()->assertJsonPath('token.characterId', $placed['characterId']);
        $this->getJson('/api/scenes/'.$second->id.'/snapshot')->assertJsonCount(1, 'tokens');
    }

    public function test_duplicate_preserves_layout_and_independent_npcs_without_activation(): void
    {
        $scene = $this->campaign->scenes()->create(['name' => 'Stage', 'grid_size' => 80, 'fog_base' => 'hidden']);
        $npc = $this->send('library/npcs', ['name' => 'Guard', 'hp' => 18, 'max_hp' => 18])->assertOk()->json('character.id');
        $token = $this->send('scenes/'.$scene->id.'/npcs', ['npcId' => $npc, 'x' => 200, 'y' => 360])->assertOk()->json('token');
        $scene->props()->create(['name' => 'Crate', 'x' => 40, 'y' => 60, 'scale_x' => 1, 'scale_y' => 1, 'is_hidden' => true]);
        $payload = ['name' => 'Stage copy', 'clientMutationId' => (string) Str::uuid()];
        $copyId = $this->send('scenes/'.$scene->id.'/duplicate', $payload)->assertOk()->json('id');
        $this->send('scenes/'.$scene->id.'/duplicate', $payload)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $copy = Scene::findOrFail($copyId);
        $this->assertEquals($scene->grid_size, $copy->grid_size);
        $this->assertEquals($scene->fog_base, $copy->fog_base);
        $this->assertEquals(200, $copy->tokens()->first()->x);
        $this->assertNotEquals($token['characterId'], $copy->tokens()->first()->character_id);
        $this->assertEquals(40, $copy->props()->first()->x);
        $this->assertTrue($copy->props()->first()->is_hidden);
        $this->assertNull($this->campaign->fresh()->active_scene_id);
        $this->getJson('/api/campaigns/'.$this->campaign->id.'/scenes')->assertOk()->assertJsonCount(2, 'scenes');
    }

    public function test_player_outsider_cross_campaign_and_private_library_boundaries(): void
    {
        $scene = $this->campaign->scenes()->create(['name' => 'Secret stage']);
        $other = User::factory()->create();
        $hero = Character::create(['name' => 'Private']);
        $hero->forceFill(['library_user_id' => $other->id])->save();
        $this->send('scenes/'.$scene->id.'/characters', ['characterId' => $hero->id, 'x' => 0, 'y' => 0])->assertNotFound();
        $another = Campaign::create(['name' => 'Other']);
        $another->members()->attach($this->gm, ['role' => 'gm']);
        $this->send('campaigns/'.$another->id.'/scene-preparation', $this->settings() + ['sceneId' => $scene->id])->assertNotFound();
        $player = User::factory()->create();
        $this->campaign->members()->attach($player, ['role' => 'player']);
        $this->actingAs($player);
        $this->get('/campaigns/'.$this->campaign->id.'/scenes')->assertForbidden();
        $this->getJson('/api/campaigns/'.$this->campaign->id.'/scenes')->assertForbidden();
        $this->send('scenes/'.$scene->id.'/duplicate', ['name' => 'Leak'])->assertForbidden();
        $this->send('campaigns/'.$this->campaign->id.'/scene-preparation', $this->settings())->assertForbidden();
        $this->send('scenes/'.$scene->id.'/characters', ['characterId' => $hero->id, 'x' => 0, 'y' => 0])->assertForbidden();
        $this->actingAs($other)->getJson('/api/campaigns/'.$this->campaign->id.'/scenes')->assertForbidden();
    }
}
