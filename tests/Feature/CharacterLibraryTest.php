<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\ItemDefinition;
use App\Models\User;
use App\Services\CharacterRules;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\Support\SeedsCharacterCatalog;
use Tests\TestCase;

class CharacterLibraryTest extends TestCase
{
    use RefreshDatabase, SeedsCharacterCatalog;

    public function test_library_and_builder_work_without_any_campaign_and_keep_private_ownership(): void
    {
        $this->seedCharacterCatalog();
        $gm = User::factory()->create();
        $other = User::factory()->create();
        $this->actingAs($gm)->get('/control')->assertOk();
        $this->get('/control/characters/new')->assertOk();
        $this->getJson('/api/library/character-rules/catalog')->assertOk()->assertJsonPath('defaults.proficiency_bonus', 2);
        $rules = app(CharacterRules::class)->defaults();
        $rules['scores']['str'] = 16;
        $payload = ['name' => 'Independent', 'campaign_id' => null, 'rules' => $rules, 'origin' => ['species' => 'Elf'], 'clientMutationId' => (string) Str::uuid()];
        $id = $this->postJson('/api/library/characters', $payload)->assertOk()->assertJsonPath('character.campaignId', null)->assertJsonPath('character.derived.abilityModifiers.str', 3)->json('character.id');
        $this->postJson('/api/library/characters', $payload)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertDatabaseCount('characters', 1);
        $this->assertDatabaseCount('campaigns', 0);
        $this->assertDatabaseHas('characters', ['id' => $id, 'library_user_id' => $gm->id, 'campaign_id' => null]);
        $this->postJson('/api/library/characters', ['id' => $id, 'name' => 'Edited', 'campaign_id' => null, 'hp' => 0])->assertOk()->assertJsonPath('character.lifecycle.status', 'dying');
        $this->postJson('/api/library/character-rules/preview', ['id' => $id, 'rules' => $rules])->assertOk();
        $this->getJson('/api/library/characters')->assertOk()->assertJsonCount(1, 'characters')->assertJsonPath('characters.0.name', 'Edited');
        $this->actingAs($other)->getJson('/api/library/characters')->assertOk()->assertJsonCount(0, 'characters');
        $this->get('/control/characters/'.$id)->assertNotFound();
        $this->postJson('/api/library/character-rules/preview', ['id' => $id])->assertNotFound();
        $this->postJson('/api/library/characters', ['id' => $id, 'name' => 'Stolen', 'campaign_id' => null])->assertNotFound();
        $this->deleteJson('/api/library/characters/'.$id)->assertNotFound();
        $this->actingAs($gm)->deleteJson('/api/library/characters/'.$id)->assertOk();
        $this->assertDatabaseCount('characters', 0);
    }

    public function test_campaign_assignment_reuses_runtime_and_cannot_be_changed_while_linked(): void
    {
        Event::fake([TabletopEvent::class]);
        [$gm, $player] = User::factory()->count(2)->create()->all();
        $campaign = Campaign::create(['name' => 'Assigned']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $campaign->members()->attach($player, ['role' => 'player']);
        $scene = $campaign->scenes()->create(['name' => 'Play']);
        $this->actingAs($gm);
        $id = $this->postJson('/api/library/characters', ['name' => 'Hero', 'campaign_id' => null])->assertOk()->json('character.id');
        $this->postJson('/api/library/characters', ['id' => $id, 'name' => 'Hero', 'campaign_id' => $campaign->id, 'owner_user_id' => $player->id])->assertOk()->assertJsonPath('character.campaignId', (string) $campaign->id);
        $this->actingAs($player)->getJson('/api/campaigns/'.$campaign->id.'/characters')->assertOk()->assertJsonPath('characters.0.id', $id);
        $this->putJson('/api/campaigns/'.$campaign->id.'/active-character', ['character_id' => $id])->assertOk();
        $this->actingAs($gm);
        $token = $this->postJson('/api/scenes/'.$scene->id.'/tokens', ['character_id' => $id, 'x' => 20, 'y' => 20])->assertOk()->json('token.id');
        $this->postJson('/api/library/characters', ['id' => $id, 'name' => 'Hero', 'campaign_id' => null])->assertConflict();
        $this->assertDatabaseHas('characters', ['id' => $id, 'campaign_id' => $campaign->id]);
        $this->postJson('/api/library/characters', ['id' => $id, 'name' => 'Renamed', 'campaign_id' => $campaign->id, 'hp' => 7])->assertOk();
        $this->getJson('/api/scenes/'.$scene->id.'/snapshot')->assertOk()->assertJsonPath('characters.0.hp', 7)->assertJsonPath('tokens.0.characterId', $id);
        DB::table('tokens')->where('id', $token)->delete();
        $this->postJson('/api/library/characters', ['id' => $id, 'name' => 'Renamed', 'campaign_id' => null, 'owner_user_id' => null])->assertOk()->assertJsonPath('character.ownerUserId', null);
        $this->assertDatabaseHas('campaign_members', ['campaign_id' => $campaign->id, 'user_id' => $player->id, 'active_character_id' => null]);
        $this->actingAs($player)->getJson('/api/campaigns/'.$campaign->id.'/characters')->assertOk()->assertJsonCount(0, 'characters');
        $this->getJson('/api/library/characters')->assertOk()->assertJsonCount(0, 'characters');
    }

    public function test_assignments_and_global_fields_cannot_cross_permissions_or_include_npcs(): void
    {
        [$gm, $other] = User::factory()->count(2)->create()->all();
        $campaign = Campaign::create(['name' => 'Other']);
        $campaign->members()->attach($other, ['role' => 'gm']);
        $this->actingAs($gm)->postJson('/api/library/characters', ['name' => 'Bad assignment', 'campaign_id' => $campaign->id])->assertForbidden();
        $this->postJson('/api/library/characters', ['name' => 'Bad player', 'campaign_id' => null, 'owner_user_id' => $other->id])->assertUnprocessable();
        $this->postJson('/api/library/characters', ['name' => 'Bad loadout', 'campaign_id' => null, 'starting_spells' => [1]])->assertUnprocessable();
        $this->postJson('/api/library/characters', ['name' => 'NPC', 'campaign_id' => null, 'kind' => 'npc'])->assertUnprocessable();
        $npc = $campaign->characters()->create(['name' => 'NPC', 'kind' => 'npc']);
        $this->actingAs($other)->getJson('/api/library/characters')->assertOk()->assertJsonCount(0, 'characters');
        $this->get('/control/characters/'.$npc->id)->assertNotFound();
        $this->assertDatabaseCount('characters', 1);
    }

    public function test_deleting_a_campaign_does_not_delete_its_library_character(): void
    {
        $gm = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Temporary']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $this->actingAs($gm);
        $id = $this->postJson('/api/library/characters', ['name' => 'Survivor', 'campaign_id' => $campaign->id])->assertOk()->json('character.id');
        $campaign->delete();
        $this->assertDatabaseHas('characters', ['id' => $id, 'campaign_id' => null, 'library_user_id' => $gm->id]);
        $this->getJson('/api/library/characters')->assertOk()->assertJsonPath('characters.0.id', $id);
    }

    public function test_transfer_preserves_identity_and_requires_removing_active_campaign_inventory(): void
    {
        Event::fake([TabletopEvent::class]);
        $gm = User::factory()->create();
        $from = Campaign::create(['name' => 'From']);
        $to = Campaign::create(['name' => 'To']);
        foreach ([$from, $to] as $campaign) {
            $campaign->members()->attach($gm, ['role' => 'gm']);
        }
        $item = (new ItemDefinition)->forceFill(['campaign_id' => $from->id, 'name' => 'Rope', 'icon' => 'book', 'category' => 'misc', 'rarity' => 'common', 'width' => 1, 'height' => 1, 'max_stack' => 10, 'equipment_slots' => [], 'modifiers' => []]);
        $item->save();
        $this->actingAs($gm);
        $id = $this->postJson('/api/library/characters', ['name' => 'Traveller', 'campaign_id' => $from->id, 'starting_items' => [['definitionId' => $item->id, 'quantity' => 1]]])->assertOk()->json('character.id');
        $payload = ['id' => $id, 'name' => 'Traveller', 'campaign_id' => $to->id];
        $this->postJson('/api/library/characters', $payload)->assertConflict();
        $this->assertDatabaseHas('characters', ['id' => $id, 'campaign_id' => $from->id, 'library_user_id' => $gm->id]);
        $inventory = Character::findOrFail($id)->inventory()->firstOrFail();
        $this->postJson('/api/campaigns/'.$from->id.'/characters/'.$id.'/inventory', ['action' => 'remove', 'itemId' => $inventory->id, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->postJson('/api/library/characters', $payload)->assertOk()->assertJsonPath('character.id', $id)->assertJsonPath('character.campaignId', (string) $to->id);
        $this->assertDatabaseMissing('inventory_items', ['character_id' => $id]);
        $this->getJson('/api/campaigns/'.$from->id.'/characters')->assertOk()->assertJsonCount(0, 'characters');
        $this->getJson('/api/campaigns/'.$to->id.'/characters')->assertOk()->assertJsonPath('characters.0.id', $id);
        $this->getJson('/api/library/characters')->assertOk()->assertJsonCount(1, 'characters');
    }

    public function test_campaign_co_gm_keeps_editor_access_without_taking_library_ownership(): void
    {
        [$owner, $collaborator] = User::factory()->count(2)->create()->all();
        $campaign = Campaign::create(['name' => 'Shared preparation']);
        $campaign->members()->attach($owner, ['role' => 'gm']);
        $campaign->members()->attach($collaborator, ['role' => 'gm']);
        $this->actingAs($owner);
        $id = $this->postJson('/api/library/characters', ['name' => 'Shared hero', 'campaign_id' => $campaign->id])->assertOk()->json('character.id');
        $this->actingAs($collaborator)->get('/control/characters/'.$id)->assertOk();
        $this->getJson('/api/library/characters')->assertOk()->assertJsonPath('characters.0.id', $id);
        $this->postJson('/api/library/characters', ['id' => $id, 'name' => 'Prepared together', 'campaign_id' => $campaign->id])->assertOk();
        $this->assertDatabaseHas('characters', ['id' => $id, 'library_user_id' => $owner->id]);
        $this->postJson('/api/library/characters', ['id' => $id, 'name' => 'Cannot claim', 'campaign_id' => null])->assertForbidden();
        $campaign->members()->detach($collaborator);
        $this->getJson('/api/library/characters')->assertOk()->assertJsonCount(0, 'characters');
        $this->get('/control/characters/'.$id)->assertNotFound();
        $this->actingAs($owner)->getJson('/api/library/characters')->assertOk()->assertJsonPath('characters.0.id', $id);
    }
}
