<?php

namespace Tests\Feature;

use App\Compendium\CompendiumSync;
use App\Events\TabletopEvent;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\Combat;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use App\Models\LootContainer;
use App\Models\User;
use App\Services\CharacterRules;
use App\Services\D20Roller;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\Support\SeedsCharacterCatalog;
use Tests\TestCase;

class NpcLibraryTest extends TestCase
{
    use RefreshDatabase, SeedsCharacterCatalog;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCharacterCatalog();
        Event::fake([TabletopEvent::class]);
    }

    private function send(string $path, array $data = [])
    {
        return $this->postJson('/api/'.$path, $data + ['clientMutationId' => (string) Str::uuid()]);
    }

    private function npc(array $patch = []): Character
    {
        $id = $this->send('library/npcs', $patch + ['name' => 'Scout', 'hp' => 18, 'max_hp' => 18, 'ac' => 13, 'speed' => 30,
            'rules' => app(CharacterRules::class)->defaults(), 'combat_profile' => ['resistances' => ['fire']]])->assertOk()->json('character.id');

        return Character::findOrFail($id);
    }

    public function test_create_duplicate_private_edit_and_shared_item_spell_assignments(): void
    {
        [$gm, $other] = User::factory()->count(2)->create()->all();
        $this->actingAs($gm)->get('/control/npcs')->assertOk();
        $c = $this->npc();
        $this->getJson('/api/library/characters')->assertJsonCount(0, 'characters');
        $this->getJson('/api/library/npcs')->assertJsonPath('characters.0.name', 'Scout');
        $id = $this->send('library/items', ['name' => 'Ward', 'description' => '', 'icon' => 'item_ring', 'category' => 'trinket', 'rarity' => 'common',
            'width' => 1, 'height' => 1, 'max_stack' => 1, 'equipment_slots' => ['ring_1'], 'modifiers' => ['ac' => 2], 'use_ability_id' => null])->assertOk()->json('definition.id');
        $this->send('library/characters/'.$c->id.'/inventory', ['action' => 'give', 'libraryItemId' => $id, 'quantity' => 1, 'slot' => 'ring_1'])->assertOk();
        app(CompendiumSync::class)->import(CompendiumSource::firstOrFail(), json_decode(file_get_contents(base_path('tests/Fixtures/compendium/spells-2024.json')), true), ['spells']);
        $spell = CompendiumEntry::where('entity_type', 'spells')->where('external_key', 'fire-bolt')->firstOrFail();
        $this->send('library/characters/'.$c->id.'/spells', ['action' => 'add', 'entryId' => $spell->id])->assertOk();
        $this->send('library/characters/'.$c->id.'/spells', ['action' => 'configure', 'abilityId' => $c->fresh()->abilities[0]['id'], 'prepared' => true])->assertOk();
        $payload = ['npcId' => $c->id, 'clientMutationId' => (string) Str::uuid()];
        $copy = $this->send('library/npcs/copy', $payload)->assertOk()->json('character.id');
        $this->send('library/npcs/copy', $payload)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertSame(2, Character::where('kind', 'npc')->count());
        $clone = Character::findOrFail($copy);
        $this->assertEquals(15, $clone->ac);
        $this->assertCount(1, $clone->abilities);
        $this->assertNotEquals($c->inventory()->first()->item_definition_id, $clone->inventory()->first()->item_definition_id);
        $this->send('library/npcs', ['id' => $copy, 'name' => 'Variant', 'hp' => 12, 'max_hp' => 20])->assertOk();
        $this->assertSame(18, $c->fresh()->hp);
        $this->send('library/characters', ['id' => $c->id, 'name' => 'Wrong editor', 'campaign_id' => null])->assertNotFound();
        $this->send('library/npcs', ['name' => 'Invalid', 'spellcasting' => ['slots' => [1 => ['max' => 1, 'current' => 2]]]])->assertUnprocessable();
        $this->actingAs($other)->get('/control/npcs/'.$c->id)->assertNotFound();
        $this->getJson('/api/library/npcs')->assertJsonCount(0, 'characters');
        $this->send('library/npcs', ['id' => $c->id, 'name' => 'Stolen'])->assertNotFound();
        $this->send('library/npcs/copy', ['npcId' => $c->id])->assertNotFound();
        $this->send('library/characters/'.$c->id.'/inventory', ['action' => 'give', 'libraryItemId' => $id, 'quantity' => 1])->assertNotFound();
    }

    public function test_srd_copy_preserves_source_and_only_base_attack_damage_executes(): void
    {
        $gm = User::factory()->create();
        $this->actingAs($gm);
        $raw = json_decode(file_get_contents(base_path('tests/Fixtures/compendium/monsters-goblin-warrior.json')), true);
        app(CompendiumSync::class)->import(CompendiumSource::where('key', 'srd-2024')->firstOrFail(), [['endpoint' => 'monsters', 'data' => $raw]], ['monsters']);
        $entry = CompendiumEntry::where('entity_type', 'monsters')->firstOrFail();
        $before = $entry->getAttributes();
        $this->getJson('/api/library/npcs/monsters?search=Goblin')->assertOk()->assertJsonPath('entries.0.id', $entry->id);
        $r = $this->send('library/npcs/copy', ['entryId' => $entry->id])->assertOk();
        $c = Character::findOrFail($r->json('character.id'));
        $this->assertNull($c->campaign_id);
        $this->assertSame($gm->id, $c->library_user_id);
        $this->assertSame($entry->checksum, $c->npc_source['checksum']);
        $this->assertSame($raw['dexterity'], $c->rules['scores']['dex']);
        $attack = collect($c->abilities)->firstWhere('name', 'Scimitar');
        $this->assertCount(1, $attack['damage_components']);
        $this->assertSame('1d6+2', $attack['damage_components'][0]['dice']);
        $this->send('library/npcs', ['id' => $c->id, 'name' => 'Custom Goblin'])->assertOk();
        $this->assertSame($before, $entry->fresh()->getAttributes());

        $campaign = Campaign::create(['name' => 'NPC combat']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $scene = $campaign->scenes()->create(['name' => 'Arena', 'grid_size' => 50, 'distance_per_cell' => 5]);
        $campaign->forceFill(['active_scene_id' => $scene->id])->save();
        $placed = $this->send('scenes/'.$scene->id.'/npcs', ['npcId' => $c->id, 'x' => 0, 'y' => 0])->assertOk()->json('token');
        $target = $scene->tokens()->create(['name' => 'Target', 'x' => 50, 'y' => 0, 'hp' => 100, 'max_hp' => 100, 'ac' => 12]);
        $combat = Combat::create(['scene_id' => $scene->id, 'created_by' => $gm->id]);
        $actorEntry = $combat->combatants()->create(['token_id' => $placed['id'], 'position' => 0]);
        $combat->combatants()->create(['token_id' => $target->id, 'position' => 1]);
        $this->send('scenes/'.$scene->id.'/combat/begin', ['combatId' => (string) $combat->id])->assertOk();
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(15);
        $command = ['characterId' => $placed['characterId'], 'abilityId' => $attack['id'], 'epoch' => 0, 'rollMode' => 'normal',
            'target' => ['kind' => 'token', 'id' => $target->id], 'clientMutationId' => (string) Str::uuid()];
        $this->send('scenes/'.$scene->id.'/abilities/execute', $command)->assertOk()->assertJsonPath('execution.roll.modifier', 4)->assertJsonPath('execution.roll.success', true);
        $remaining = $target->fresh()->hp;
        $this->assertLessThan(100, $remaining);
        $this->assertFalse($actorEntry->fresh()->action_available);
        $this->send('scenes/'.$scene->id.'/abilities/execute', $command)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertEquals($remaining, $target->fresh()->hp);
        $this->getJson('/api/scenes/'.$scene->id.'/snapshot')->assertOk()->assertJsonPath('combat.status', 'active');
        $this->assertEquals($entry->normalized_data['hp'], $c->fresh()->hp);
    }

    public function test_place_in_two_campaigns_combat_reload_replay_loot_and_portrait_visibility(): void
    {
        Storage::fake('campaigns');
        [$gm, $player] = User::factory()->count(2)->create()->all();
        $this->actingAs($gm);
        $portrait = $this->postJson('/api/library/npc-portraits', ['file' => UploadedFile::fake()->image('npc.png', 64, 64)])->assertOk()->json('asset.id');
        $c = $this->npc(['portrait_asset_id' => $portrait, 'npc_loot_backpack' => true, 'spellcasting' => ['slots' => [1 => ['max' => 2, 'current' => 2]]]]);
        $item = $this->send('library/items', ['name' => 'Loot ring', 'description' => '', 'icon' => 'item_ring', 'category' => 'trinket', 'rarity' => 'common',
            'width' => 1, 'height' => 1, 'max_stack' => 1, 'equipment_slots' => [], 'modifiers' => [], 'use_ability_id' => null])->assertOk()->json('definition.id');
        $this->send('library/characters/'.$c->id.'/inventory', ['action' => 'give', 'libraryItemId' => $item, 'quantity' => 1])->assertOk();
        $tokens = [];
        foreach (['One', 'Two'] as $name) {
            $campaign = Campaign::create(['name' => $name]);
            $campaign->members()->attach($gm, ['role' => 'gm']);
            $campaign->members()->attach($player, ['role' => 'player']);
            $scene = $campaign->scenes()->create(['name' => 'Scene']);
            $campaign->forceFill(['active_scene_id' => $scene->id])->save();
            $data = ['npcId' => $c->id, 'x' => 50, 'y' => 50, 'clientMutationId' => (string) Str::uuid()];
            $result = $this->send('scenes/'.$scene->id.'/npcs', $data)->assertOk();
            $this->send('scenes/'.$scene->id.'/npcs', $data)->assertOk()->assertHeader('Idempotent-Replay', 'true');
            $this->assertSame(1, $scene->tokens()->count());
            $token = $scene->tokens()->firstOrFail();
            $tokens[] = $token;
            $this->assertEquals($portrait, $token->character->portrait_asset_id);
            $this->assertSame(1, LootContainer::where('token_id', $token->id)->firstOrFail()->items()->sum('quantity'));
            $this->assertSame(0, $token->character->inventory()->count());
            $this->send('tokens/'.$token->id.'/hp', ['delta' => -4])->assertOk()->assertJsonPath('token.hp', 14);
            $this->getJson('/api/scenes/'.$scene->id.'/snapshot')->assertOk()->assertJsonPath('tokens.0.hp', 14)->assertJsonPath('tokens.0.combatProfile.resistances.0', 'fire');
            $this->getJson('/api/campaigns/'.$campaign->id.'/characters')->assertOk()->assertJsonPath('characters.0.spellcasting.slots.1.current', 2);
            $this->actingAs($player)->getJson('/api/scenes/'.$scene->id.'/snapshot')->assertOk()->assertJsonMissingPath('tokens.0.combatProfile')->assertJsonCount(0, 'characters');
            $this->get('/api/assets/'.$portrait)->assertOk();
            $this->get('/api/assets/'.$token->character->portrait_asset_id)->assertOk();
            $loot = LootContainer::where('token_id', $token->id)->firstOrFail();
            $this->getJson('/api/campaigns/'.$campaign->id.'/loot?containerId='.$loot->id)->assertForbidden();
            $this->send('scenes/'.$scene->id.'/npcs', $data)->assertForbidden();
            $this->actingAs($gm)->patchJson('/api/tokens/'.$token->id, ['is_hidden' => true])->assertOk();
            $this->actingAs($player)->get('/api/assets/'.$token->character->portrait_asset_id)->assertForbidden();
            $this->getJson('/api/scenes/'.$scene->id.'/snapshot')->assertJsonCount(0, 'tokens');
            $this->actingAs($gm);
        }
        $this->assertNotEquals($tokens[0]->character_id, $tokens[1]->character_id);
        $this->assertSame(18, $c->fresh()->hp);
        $this->assertSame(1, $c->inventory()->sum('quantity'));
        $this->assertEquals(Asset::find($portrait)->storage_path, $tokens[0]->character->portraitAsset->storage_path);
        Event::assertDispatched(TabletopEvent::class);
    }
}
