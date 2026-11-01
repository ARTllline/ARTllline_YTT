<?php

namespace Tests\Feature;

use App\Actions\CharacterActions;
use App\Actions\MediaActions;
use App\Actions\SpellLibrary;
use App\Compendium\CompendiumSync;
use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use App\Models\Cue;
use App\Models\CueRun;
use App\Models\User;
use App\Rules\AssetIcon;
use App\Services\AudioProbe;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class GlobalAssetLibraryTest extends TestCase
{
    use RefreshDatabase, \Tests\Support\SeedsCharacterCatalog;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCharacterCatalog();
        Storage::fake('campaigns');
        Event::fake([TabletopEvent::class]);
        $this->actingAs(User::factory()->create());
    }

    private function upload(string $category = 'portraits'): array
    {
        return $this->post('/api/library/assets', ['category' => $category, 'file' => UploadedFile::fake()->image('Shared portrait.png', 80, 80)], ['Accept' => 'application/json'])->assertOk()->json();
    }

    private function send(string $path, array $data): TestResponse
    {
        return $this->postJson('/api/'.$path, $data + ['clientMutationId' => (string) Str::uuid()]);
    }

    public function test_upload_assign_to_four_editors_reload_and_session_reuse_same_asset(): void
    {
        $gm = auth()->user();
        $a = $this->upload();
        $this->get('/control/assets')->assertOk();
        $this->patchJson('/api/assets/'.$a['id'], ['tags' => ['shared', 'hero']])->assertOk();
        $this->getJson('/api/library/assets?search=shared&category=portraits')->assertJsonPath('total', 1);
        $hero = $this->send('library/characters', ['name' => 'Hero', 'campaign_id' => null, 'portrait_asset_id' => $a['id']])->assertOk()->json('character.id');
        $npc = $this->send('library/npcs', ['name' => 'Scout', 'portrait_asset_id' => $a['id']])->assertOk()->json('character.id');
        $item = $this->send('library/items', ['name' => 'Shared ring', 'description' => '', 'icon' => 'asset:'.$a['id'], 'category' => 'trinket', 'rarity' => 'common', 'width' => 1, 'height' => 1, 'max_stack' => 1, 'equipment_slots' => [], 'modifiers' => [], 'use_ability_id' => null])->assertOk()->json('definition.id');
        $this->send('library/characters/'.$hero.'/inventory', ['action' => 'give', 'libraryItemId' => $item, 'quantity' => 1])->assertOk();
        app(CompendiumSync::class)->import(CompendiumSource::firstOrFail(), json_decode(file_get_contents(base_path('tests/Fixtures/compendium/spells-2024.json')), true), ['spells']);
        $source = CompendiumEntry::where('entity_type', 'spells')->firstOrFail();
        $ability = app(SpellLibrary::class)->template($source);
        $ability['icon'] = 'asset:'.$a['id'];
        $spell = $this->send('library/spells', ['ability' => $ability])->assertOk()->json('entry.id');
        $this->send('library/characters/'.$hero.'/spells', ['action' => 'add', 'entryId' => $spell])->assertOk();
        $this->getJson('/api/library/characters')->assertJsonPath('characters.0.portrait.id', $a['id'])->assertJsonPath('characters.0.abilities.0.icon', 'asset:'.$a['id']);
        $this->getJson('/api/library/npcs')->assertJsonPath('characters.0.portrait.id', $a['id']);
        $this->getJson('/api/library/items')->assertJsonPath('definitions.0.icon', 'asset:'.$a['id']);
        $usage = $this->getJson('/api/assets/'.$a['id'].'/detail')->assertOk()->json('usage');
        $this->assertGreaterThanOrEqual(6, count($usage));
        $this->deleteJson('/api/assets/'.$a['id'])->assertConflict();

        $player = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Session']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $campaign->members()->attach($player, ['role' => 'player']);
        $scene = $campaign->scenes()->create(['name' => 'Table']);
        $campaign->forceFill(['active_scene_id' => $scene->id])->save();
        $this->send('library/characters', ['id' => $hero, 'name' => 'Hero', 'campaign_id' => $campaign->id, 'owner_user_id' => $player->id])->assertOk()->assertJsonPath('character.portrait.id', $a['id']);
        $this->postJson('/api/scenes/'.$scene->id.'/tokens', ['character_id' => $hero, 'x' => 0, 'y' => 0])->assertOk();
        $this->send('scenes/'.$scene->id.'/npcs', ['npcId' => $npc, 'x' => 100, 'y' => 100])->assertOk();
        $this->assertSame(1, Asset::count());
        $this->assertSame(3, Character::where('portrait_asset_id', $a['id'])->count());
        $this->actingAs($player)->getJson('/api/scenes/'.$scene->id.'/snapshot')->assertOk()->assertJsonFragment(['icon' => 'asset:'.$a['id']]);
        $this->get('/api/assets/'.$a['id'])->assertOk();
        $this->getJson('/api/library/assets')->assertJsonPath('total', 0);
        $this->getJson('/api/assets/'.$a['id'].'/detail')->assertForbidden();
        $this->actingAs(User::factory()->create())->get('/api/assets/'.$a['id'])->assertForbidden();
        $this->getJson('/api/library/assets')->assertJsonPath('total', 0);
        $this->post('/api/library/assets/'.$a['id'].'/replace', ['file' => UploadedFile::fake()->image('bad.png')], ['Accept' => 'application/json'])->assertForbidden();
    }

    public function test_duplicate_replace_and_delete_keep_identity_metadata_and_private_files(): void
    {
        $a = $this->upload('maps');
        $this->patchJson('/api/assets/'.$a['id'], ['name' => 'Reusable map', 'tags' => ['night']])->assertOk();
        $oldPath = Asset::find($a['id'])->storage_path;
        $copy = $this->postJson('/api/library/assets/'.$a['id'].'/duplicate')->assertOk()->assertJsonPath('tags.0.name', 'night')->json();
        $this->assertNotEquals($a['id'], $copy['id']);
        $this->assertNotEquals($oldPath, Asset::find($copy['id'])->storage_path);
        $this->post('/api/library/assets/'.$a['id'].'/replace', ['file' => UploadedFile::fake()->createWithContent('bad.svg', '<svg/>')], ['Accept' => 'application/json'])->assertUnprocessable();
        Storage::disk('campaigns')->assertExists($oldPath);
        $this->post('/api/library/assets/'.$a['id'].'/replace', ['file' => UploadedFile::fake()->image('New map.png', 160, 90)], ['Accept' => 'application/json'])->assertOk()->assertJsonPath('id', $a['id'])->assertJsonPath('name', 'Reusable map')->assertJsonPath('tags.0.name', 'night')->assertJsonPath('width', 160);
        Storage::disk('campaigns')->assertMissing($oldPath);
        $this->assertSame(2, Asset::count());
        $this->get('/api/assets/'.$a['id'].'/thumbnail')->assertOk();
        $this->deleteJson('/api/assets/'.$copy['id'])->assertOk();
        $this->deleteJson('/api/assets/'.$a['id'])->assertOk();
        $this->assertSame(0, Asset::count());
    }

    public function test_global_audio_is_private_reusable_in_cues_and_deletion_is_guarded(): void
    {
        $gm = auth()->user();
        $this->mock(AudioProbe::class)->shouldReceive('inspect')->once()->andReturn(['extension' => 'wav', 'mime' => 'audio/wav', 'duration' => 1000]);
        $a = $this->post('/api/library/assets', ['category' => 'audio', 'kind' => 'music', 'file' => UploadedFile::fake()->createWithContent('music.wav', 'wave fixture')], ['Accept' => 'application/json'])->assertOk()->json();
        $this->getJson('/api/library/assets?category=audio')->assertJsonPath('total', 1);
        $this->getJson('/api/library/assets?images=1')->assertJsonPath('total', 0);
        $this->getJson('/api/assets/'.$a['id'].'/detail')->assertOk()->assertJsonPath('usage', []);
        $player = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Audio session']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $campaign->members()->attach($player, ['role' => 'player']);
        $scene = $campaign->scenes()->create(['name' => 'Audio table']);
        $campaign->forceFill(['active_scene_id' => $scene->id])->save();
        $config = ['assetId' => $a['id'], 'volume' => 0.4, 'loop' => true, 'fade' => 0];
        $cue = Cue::create(['scene_id' => $scene->id, 'name' => 'Reusable audio']);
        $cue->steps()->create(['position' => 0, 'type' => 'music.start', 'config' => $config]);
        $this->getJson('/api/assets/'.$a['id'].'/detail')->assertOk()->assertJsonCount(1, 'usage');
        $this->deleteJson('/api/assets/'.$a['id'])->assertConflict();
        $run = CueRun::create(['id' => (string) Str::uuid(), 'campaign_id' => $campaign->id, 'scene_id' => $scene->id, 'cue_id' => $cue->id, 'created_by' => $gm->id, 'name' => 'Queued audio', 'epoch' => 0, 'queue_order' => 1]);
        $run->steps()->create(['id' => (string) Str::uuid(), 'position' => 0, 'type' => 'music.start', 'config' => $config]);
        $cue->steps()->delete();
        $this->getJson('/api/assets/'.$a['id'].'/detail')->assertOk()->assertJsonPath('usage.0', 'Ожидает выполнения в запущенном событии');
        $this->deleteJson('/api/assets/'.$a['id'])->assertConflict();
        $this->actingAs($player)->get('/api/assets/'.$a['id'])->assertForbidden();
        // Queue workers have an explicit actor, without an HTTP auth session.
        auth()->forgetGuards();
        app(MediaActions::class)->execute($gm, $campaign, 'music.start', $config);
        $this->actingAs($player)->get('/api/assets/'.$a['id'])->assertOk();
        $this->actingAs($gm)->deleteJson('/api/assets/'.$a['id'])->assertConflict();
    }

    public function test_references_do_not_disclose_other_gms_private_character_names(): void
    {
        $owner = auth()->user();
        $a = $this->upload();
        $other = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Private campaign']);
        $campaign->members()->attach($other, ['role' => 'gm']);
        Asset::findOrFail($a['id'])->update(['campaign_id' => $campaign->id]);
        $character = Character::create(['library_user_id' => $other->id, 'campaign_id' => $campaign->id, 'name' => 'Secret antagonist', 'portrait_asset_id' => $a['id'], 'kind' => 'npc', 'hp' => 10, 'max_hp' => 10]);
        $this->getJson('/api/assets/'.$a['id'].'/detail')->assertOk()->assertJsonMissing(['Secret antagonist'])->assertJsonPath('usage.0', 'Используется в другой библиотеке или кампании');
        $this->deleteJson('/api/assets/'.$a['id'])->assertConflict();
        $this->actingAs($other)->get('/api/assets/'.$a['id'])->assertOk();
        // A collaborating GM may keep an existing shared portrait while editing.
        app(CharacterActions::class)->validate($campaign, ['portrait_asset_id' => $a['id']], $character);
        $this->assertTrue(Validator::make(['icon' => 'asset:'.$a['id']], ['icon' => [new AssetIcon([])]])->passes());
        $campaign->delete();
        $this->actingAs($owner)->get('/api/assets/'.$a['id'])->assertOk();
        $this->assertSame($a['id'], (string) $character->fresh()->portrait_asset_id);
    }
}
