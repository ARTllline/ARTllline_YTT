<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\Token;
use App\Models\User;
use App\Policies\AssetPolicy;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class CharacterTest extends TestCase
{
    use DatabaseMigrations;

    private $gm;

    private $player;

    private $other;

    private $campaign;

    private $first;

    private $second;

    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([TabletopEvent::class]);
        [$this->gm, $this->player, $this->other] = User::factory()->count(3)->create()->all();
        $this->campaign = Campaign::create(['name' => 'Characters']);
        foreach ([[$this->gm, 'gm'], [$this->player, 'player'], [$this->other, 'player']] as [$user, $role]) {
            $this->campaign->members()->attach($user, ['role' => $role]);
        }
        $this->first = $this->campaign->scenes()->create(['name' => 'One']);
        $this->second = $this->campaign->scenes()->create(['name' => 'Two']);
        $this->campaign->forceFill(['active_scene_id' => $this->first->id])->save();
    }

    private function hero(): array
    {
        return $this->actingAs($this->gm)->postJson('/api/scenes/'.$this->first->id.'/tokens', [
            'name' => 'Керн', 'kind' => 'player_character', 'disposition' => 'friendly',
            'owner_user_id' => $this->player->id, 'hp' => 34, 'max_hp' => 41,
            'check_stats' => [['key' => 'perception', 'label' => 'Внимательность', 'modifier' => 3]], 'x' => 100, 'y' => 200,
        ])->assertOk()->json('token');
    }

    private function place(array $hero): array
    {
        return $this->actingAs($this->gm)->postJson('/api/scenes/'.$this->second->id.'/tokens', ['character_id' => $hero['characterId'], 'x' => 600, 'y' => 700])->assertOk()->json('token');
    }

    public function test_character_identity_is_shared_but_scene_transforms_are_independent(): void
    {
        $hero = $this->hero();
        $second = $this->place($hero);
        $this->assertDatabaseCount('characters', 1);
        $this->assertSame($hero['characterId'], $second['characterId']);
        foreach (['name', 'kind', 'disposition', 'ownerUserId', 'hp', 'maxHp', 'checkStats'] as $key) {
            $this->assertSame($hero[$key], $second[$key]);
        }
        $this->patchJson('/api/tokens/'.$hero['id'], ['name' => 'Керн Стойкий', 'x' => 333, 'rotation' => 90, 'size' => 120, 'is_hidden' => true,
            'check_stats' => [['key' => 'perception', 'label' => 'Внимательность', 'modifier' => 7]]])->assertOk();
        $this->getJson('/api/scenes/'.$this->second->id.'/snapshot')->assertJsonPath('tokens.0.name', 'Керн Стойкий')
            ->assertJsonPath('tokens.0.checkStats.0.modifier', 7)->assertJsonPath('tokens.0.x', 600)
            ->assertJsonPath('tokens.0.rotation', 0)->assertJsonPath('tokens.0.isHidden', false);
        $this->assertEquals(333, Token::find($hero['id'])->x);
        $this->assertEquals(600, Token::find($second['id'])->x);
    }

    public function test_existing_combat_hp_persists_across_scene_switches_and_retries_without_shadow_writes(): void
    {
        $hero = $this->hero();
        $second = $this->place($hero);
        $command = ['delta' => -9, 'clientMutationId' => (string) Str::uuid()];
        $this->postJson('/api/tokens/'.$hero['id'].'/hp', $command)->assertOk()->assertJsonPath('token.hp', 25);
        $this->postJson('/api/tokens/'.$hero['id'].'/hp', $command)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertSame(25, Character::sole()->hp);
        $this->assertEquals(34, Token::find($hero['id'])->getRawOriginal('hp'));
        Event::assertDispatched(TabletopEvent::class, fn ($e) => $e->channel === 'campaign.'.$this->campaign->id.'.scene.'.$this->second->id.'.gm' && ($e->envelope['payload']['token']['hp'] ?? null) === 25);
        $this->postJson('/api/campaigns/'.$this->campaign->id.'/activate', ['sceneId' => $this->second->id])->assertOk();
        $this->actingAs($this->player)->getJson('/api/scenes/'.$this->second->id.'/snapshot')->assertJsonPath('tokens.0.hp', 25);
        $this->actingAs($this->gm)->postJson('/api/tokens/'.$second['id'].'/hp', ['delta' => -999])->assertOk()->assertJsonPath('token.hp', 0);
        $this->postJson('/api/tokens/'.$hero['id'].'/hp', ['delta' => 999])->assertOk()->assertJsonPath('token.hp', 0);
        $this->postJson('/api/scenes/'.$this->second->id.'/adventuring', ['action' => 'revive', 'tokenId' => $second['id'], 'hp' => 41])->assertOk();
        $this->patchJson('/api/tokens/'.$second['id'], ['max_hp' => 20])->assertOk()->assertJsonPath('token.hp', 20);
        $this->assertSame(20, Token::find($hero['id'])->hp);
    }

    public function test_active_character_is_owned_campaign_scoped_and_survives_a_scene_without_representation(): void
    {
        $hero = $this->hero();
        $url = '/api/campaigns/'.$this->campaign->id;
        $this->actingAs($this->player)->putJson($url.'/active-character', ['character_id' => $hero['characterId']])->assertOk()->assertJsonPath('activeCharacterId', $hero['characterId']);
        $this->getJson('/api/scenes/'.$this->first->id.'/snapshot')->assertJsonPath('activeCharacterId', $hero['characterId'])->assertJsonPath('tokens.0.isOwner', true);
        $this->actingAs($this->gm)->postJson($url.'/activate', ['sceneId' => $this->second->id])->assertOk();
        $this->actingAs($this->player)->getJson('/api/scenes/'.$this->second->id.'/snapshot')->assertJsonPath('activeCharacterId', $hero['characterId'])->assertJsonCount(0, 'tokens')->assertJsonCount(1, 'characters');
        $second = $this->place($hero);
        $this->actingAs($this->player)->getJson('/api/scenes/'.$this->second->id.'/snapshot')->assertJsonPath('activeCharacterId', $hero['characterId'])->assertJsonPath('tokens.0.characterId', $hero['characterId']);
        $this->actingAs($this->other)->putJson($url.'/active-character', ['character_id' => $hero['characterId']])->assertForbidden();
        $this->getJson($url.'/characters')->assertJsonCount(0, 'characters');
        $this->postJson('/api/tokens/'.$second['id'].'/move', ['x' => 1, 'y' => 1])->assertForbidden();
        $this->patchJson('/api/tokens/'.$second['id'], ['owner_user_id' => $this->other->id])->assertForbidden();
        $this->postJson($url.'/characters', ['id' => $hero['characterId'], 'name' => 'Stolen', 'owner_user_id' => $this->other->id])->assertForbidden();
        $this->actingAs($this->gm)->patchJson('/api/tokens/'.$second['id'], ['owner_user_id' => $this->other->id])->assertOk();
        $this->actingAs($this->player)->getJson('/api/scenes/'.$this->second->id.'/snapshot')->assertJsonPath('activeCharacterId', null)->assertJsonCount(0, 'characters')->assertJsonPath('tokens.0.isOwner', false)->assertJsonMissingPath('tokens.0.checkStats')->assertJsonMissingPath('tokens.0.hp');
        $this->putJson($url.'/active-character', ['character_id' => $hero['characterId']])->assertForbidden();
        $this->postJson('/api/tokens/'.$second['id'].'/move', ['x' => 1, 'y' => 1])->assertForbidden();
    }

    public function test_duplicate_representation_and_cross_campaign_links_or_assignments_are_rejected_atomically(): void
    {
        $hero = $this->hero();
        $this->postJson('/api/scenes/'.$this->first->id.'/tokens', ['character_id' => $hero['characterId'], 'x' => 0, 'y' => 0])->assertUnprocessable();
        $this->postJson('/api/scenes/'.$this->first->id.'/selection', ['action' => 'duplicate', 'tokenIds' => [$hero['id']], 'propIds' => []])->assertUnprocessable();
        $foreign = Campaign::create(['name' => 'Foreign']);
        $foreign->members()->attach($this->gm, ['role' => 'gm']);
        $scene = $foreign->scenes()->create(['name' => 'Foreign']);
        $this->postJson('/api/scenes/'.$scene->id.'/tokens', ['character_id' => $hero['characterId'], 'x' => 0, 'y' => 0])->assertNotFound();
        $this->patchJson('/api/tokens/'.$hero['id'], ['character_id' => 999])->assertUnprocessable();
        $this->postJson('/api/campaigns/'.$this->campaign->id.'/characters', ['name' => 'Bad', 'owner_user_id' => $this->gm->id])->assertUnprocessable();
        $outsider = User::factory()->create();
        $this->postJson('/api/campaigns/'.$this->campaign->id.'/characters', ['name' => 'Bad', 'owner_user_id' => $outsider->id])->assertUnprocessable();
        $this->actingAs($this->player)->putJson('/api/campaigns/'.$foreign->id.'/active-character', ['character_id' => $hero['characterId']])->assertForbidden();
        $this->assertDatabaseCount('characters', 1);
        $this->assertDatabaseCount('tokens', 1);
    }

    public function test_standalone_npc_keeps_local_hp_and_deleting_representation_keeps_character(): void
    {
        $hero = $this->hero();
        $npc = $this->postJson('/api/scenes/'.$this->first->id.'/tokens', ['name' => 'Goblin', 'kind' => 'npc', 'x' => 0, 'y' => 0])->assertOk()->assertJsonPath('token.characterId', null)->json('token.id');
        $this->postJson('/api/tokens/'.$npc.'/hp', ['delta' => -3])->assertOk()->assertJsonPath('token.hp', 7);
        $this->assertSame(34, Character::sole()->hp);
        $this->assertEquals(7, Token::find($npc)->getRawOriginal('hp'));
        $this->deleteJson('/api/tokens/'.$hero['id'])->assertOk();
        $this->assertDatabaseCount('characters', 1);
        $this->postJson('/api/scenes/'.$this->first->id.'/tokens', ['character_id' => $hero['characterId'], 'x' => 99, 'y' => 88])->assertOk()->assertJsonPath('token.hp', 34);
    }

    public function test_character_portraits_are_authorized_and_protected_even_without_scene_tokens(): void
    {
        $hero = $this->hero();
        $asset = Asset::create(['campaign_id' => $this->campaign->id, 'uploaded_by' => $this->gm->id, 'kind' => 'token', 'name' => 'Portrait', 'original_name' => 'portrait.png', 'storage_path' => 'portrait.png', 'mime_type' => 'image/png', 'file_size' => 10, 'width' => 100, 'height' => 100]);
        $this->patchJson('/api/tokens/'.$hero['id'], ['token_image_asset_id' => $asset->id])->assertOk()->assertJsonPath('token.image.id', (string) $asset->id);
        $this->deleteJson('/api/tokens/'.$hero['id'])->assertOk();
        $this->deleteJson('/api/assets/'.$asset->id)->assertConflict();
        $this->assertTrue(app(AssetPolicy::class)->view($this->player, $asset));
        $this->assertFalse(app(AssetPolicy::class)->view($this->other, $asset));
        $this->actingAs($this->other)->getJson('/api/campaigns/'.$this->campaign->id.'/characters')->assertJsonCount(0, 'characters');
    }
}
