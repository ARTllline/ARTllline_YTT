<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\ItemDefinition;
use App\Models\LibraryItem;
use App\Models\User;
use App\Services\CharacterRules;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\Support\SeedsCharacterCatalog;
use Tests\TestCase;

class ItemLibraryTest extends TestCase
{
    use RefreshDatabase, SeedsCharacterCatalog;

    private function definition(array $patch = []): array
    {
        return array_replace(['name' => 'Ward', 'icon' => 'item_ring', 'description' => 'A protective ring', 'category' => 'trinket', 'rarity' => 'rare', 'width' => 1, 'height' => 1, 'max_stack' => 1, 'equipment_slots' => ['ring_1', 'ring_2'], 'modifiers' => ['ac' => 2], 'use_ability_id' => null], $patch);
    }

    private function command(Character $c, array $data)
    {
        return $this->postJson('/api/library/characters/'.$c->id.'/inventory', $data + ['clientMutationId' => (string) Str::uuid()]);
    }

    public function test_global_templates_grant_independent_instances_before_campaign_and_reuse_runtime_after_assignment(): void
    {
        Event::fake([TabletopEvent::class]);
        $gm = User::factory()->create();
        $player = User::factory()->create();
        $this->actingAs($gm)->get('/control/items')->assertOk();
        $template = $this->postJson('/api/library/items', $this->definition())->assertOk()->json('definition.id');
        $copy = $this->postJson('/api/library/items', $this->definition(['name' => 'Ward variant', 'modifiers' => ['ac' => 3]]))->assertOk()->json('definition.id');
        $this->assertNotSame($template, $copy);
        $this->assertSame(2, LibraryItem::findOrFail($template)->definition['modifiers']['ac']);
        $c = Character::forceCreate(['library_user_id' => $gm->id, 'name' => 'Hero', 'kind' => 'player_character', 'ac' => 10, 'rules' => app(CharacterRules::class)->defaults()]);
        $payload = ['action' => 'give', 'libraryItemId' => $template, 'quantity' => 1, 'slot' => 'ring_1', 'clientMutationId' => (string) Str::uuid()];
        $item = $this->command($c, $payload)->assertOk()->assertJsonPath('character.ac', 12)->assertJsonPath('items.0.equipped_slot', 'ring_1')->json('items.0.id');
        $this->command($c, $payload)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertDatabaseCount('inventory_items', 1);
        $this->postJson('/api/library/items', $this->definition(['id' => $template, 'name' => 'Changed template', 'modifiers' => ['ac' => 9]]))->assertOk();
        $this->getJson('/api/library/characters/'.$c->id.'/inventory')->assertOk()->assertJsonPath('items.0.definition.name', 'Ward')->assertJsonPath('character.ac', 12);
        $this->command($c, ['action' => 'equip', 'itemId' => $item, 'slot' => 'ring_2'])->assertOk()->assertJsonPath('items.0.equipped_slot', 'ring_2');
        $campaign = Campaign::create(['name' => 'First']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $campaign->members()->attach($player, ['role' => 'player']);
        $scene = $campaign->scenes()->create(['name' => 'Session']);
        $this->postJson('/api/library/characters', ['id' => $c->id, 'name' => $c->name, 'campaign_id' => $campaign->id, 'owner_user_id' => $player->id])->assertOk();
        $this->postJson('/api/scenes/'.$scene->id.'/tokens', ['character_id' => $c->id, 'x' => 20, 'y' => 20])->assertOk();
        $this->actingAs($player)->getJson('/api/campaigns/'.$campaign->id.'/characters/'.$c->id.'/inventory')->assertOk()->assertJsonPath('items.0.id', $item)->assertJsonPath('character.ac', 12);
        $this->postJson('/api/campaigns/'.$campaign->id.'/characters/'.$c->id.'/inventory', ['action' => 'unequip', 'itemId' => $item, 'clientMutationId' => (string) Str::uuid()])->assertOk()->assertJsonPath('character.ac', 10);
        $this->assertEquals(9, LibraryItem::findOrFail($template)->definition['modifiers']['ac']);
        $this->actingAs($gm)->getJson('/api/scenes/'.$scene->id.'/snapshot')->assertOk()->assertJsonPath('tokens.0.ac', 10);
        Event::assertDispatched(TabletopEvent::class);
    }

    public function test_private_access_and_invalid_drop_roll_back_the_entire_grant(): void
    {
        [$gm, $other] = User::factory()->count(2)->create()->all();
        $this->actingAs($gm);
        $id = $this->postJson('/api/library/items', $this->definition())->assertOk()->json('definition.id');
        $c = Character::forceCreate(['library_user_id' => $gm->id, 'name' => 'Hero', 'kind' => 'player_character']);
        $this->command($c, ['action' => 'give', 'libraryItemId' => $id, 'quantity' => 1, 'slot' => 'armor'])->assertUnprocessable();
        $this->assertDatabaseCount('inventory_items', 0);
        $this->assertDatabaseCount('item_definitions', 0);
        $this->command($c, ['action' => 'give', 'libraryItemId' => $id, 'quantity' => 1, 'x' => 9, 'y' => 5])->assertOk()->assertJsonPath('items.0.x', 9)->assertJsonPath('items.0.y', 5);
        $this->command($c, ['action' => 'give', 'libraryItemId' => $id, 'quantity' => 1, 'x' => 9, 'y' => 5])->assertUnprocessable();
        $this->assertDatabaseCount('inventory_items', 1);
        $this->assertDatabaseCount('item_definitions', 1);
        $this->actingAs($other)->getJson('/api/library/items')->assertOk()->assertJsonCount(0, 'definitions');
        $this->postJson('/api/library/items', $this->definition(['id' => $id]))->assertNotFound();
        $this->getJson('/api/library/characters/'.$c->id.'/inventory')->assertNotFound();
        $this->command($c, ['action' => 'give', 'libraryItemId' => $id, 'quantity' => 1])->assertNotFound();
        $owned = Character::forceCreate(['library_user_id' => $other->id, 'name' => 'Other', 'kind' => 'player_character']);
        $this->command($owned, ['action' => 'give', 'libraryItemId' => $id, 'quantity' => 1])->assertNotFound();
        $this->assertDatabaseCount('inventory_items', 1);
    }

    public function test_library_copies_can_be_used_in_two_campaigns_without_sharing_quantity_or_equipment(): void
    {
        Event::fake([TabletopEvent::class]);
        $gm = User::factory()->create();
        $this->actingAs($gm);
        $id = $this->postJson('/api/library/items', $this->definition(['max_stack' => 20, 'equipment_slots' => [], 'modifiers' => []]))->assertOk()->json('definition.id');
        $characters = [];
        foreach (['One', 'Two'] as $name) {
            $campaign = Campaign::create(['name' => $name]);
            $campaign->members()->attach($gm, ['role' => 'gm']);
            $c = $campaign->characters()->create(['library_user_id' => $gm->id, 'name' => $name, 'kind' => 'player_character']);
            $this->command($c, ['action' => 'give', 'libraryItemId' => $id, 'quantity' => 5])->assertOk();
            $characters[] = $c;
        }
        $this->assertNotEquals($characters[0]->inventory()->first()->item_definition_id, $characters[1]->inventory()->first()->item_definition_id);
        $this->command($characters[0], ['action' => 'remove', 'itemId' => $characters[0]->inventory()->first()->id])->assertOk();
        $this->assertEquals(5, $characters[1]->inventory()->first()->quantity);
        $this->assertEquals(20, LibraryItem::findOrFail($id)->definition['max_stack']);
        $this->assertDatabaseCount('library_items', 1);
        $this->assertEquals(2, ItemDefinition::whereNull('campaign_id')->count());
    }

    public function test_direct_equip_with_full_backpack_and_instance_charges_do_not_mutate_other_copies(): void
    {
        $gm = User::factory()->create();
        $this->actingAs($gm);
        $id = $this->postJson('/api/library/items', $this->definition())->assertOk()->json('definition.id');
        $c = Character::forceCreate(['library_user_id' => $gm->id, 'name' => 'Prepared', 'kind' => 'player_character']);
        $this->command($c, ['action' => 'give', 'libraryItemId' => $id, 'quantity' => 60])->assertOk()->assertJsonCount(60, 'items');
        $response = $this->command($c, ['action' => 'give', 'libraryItemId' => $id, 'quantity' => 1, 'slot' => 'ring_1'])->assertOk();
        $equipped = collect($response->json('items'))->firstWhere('equipped_slot', 'ring_1');
        $this->command($c, ['action' => 'configure', 'itemId' => $equipped['id'], 'charges' => 3])->assertOk();
        $this->assertDatabaseHas('inventory_items', ['id' => $equipped['id'], 'charges' => 3]);
        $this->assertEquals(60, $c->inventory()->whereNull('charges')->count());
        $this->assertArrayNotHasKey('charges', LibraryItem::findOrFail($id)->definition);
        $this->command($c, ['action' => 'give', 'libraryItemId' => $id, 'quantity' => 1, 'slot' => 'ring_1'])->assertUnprocessable();
        $this->assertEquals(61, $c->inventory()->count());
        $this->assertEquals(3, $c->inventory()->where('equipped_slot', 'ring_1')->first()->charges);
    }

    public function test_repeated_give_merges_compatible_stacks_and_invalid_weapon_drop_is_atomic(): void
    {
        $this->seedCharacterCatalog();
        $gm = User::factory()->create();
        $this->actingAs($gm);
        $c = Character::forceCreate(['library_user_id' => $gm->id, 'name' => 'Hero', 'kind' => 'player_character']);
        $id = $this->postJson('/api/library/items', $this->definition(['max_stack' => 20, 'equipment_slots' => []]))->assertOk()->json('definition.id');
        $this->command($c, ['action' => 'give', 'libraryItemId' => $id, 'quantity' => 5])->assertOk();
        $this->command($c, ['action' => 'give', 'libraryItemId' => $id, 'quantity' => 5])->assertOk()->assertJsonCount(1, 'items')->assertJsonPath('items.0.quantity', 10);
        $shield = $this->postJson('/api/library/items', $this->definition(['equipment_slots' => ['off_hand']]))->assertOk()->json('definition.id');
        $this->command($c, ['action' => 'give', 'libraryItemId' => $shield, 'quantity' => 1, 'slot' => 'off_hand'])->assertOk();
        $weapon = $this->postJson('/api/library/items', $this->definition(['category' => 'weapon', 'equipment_slots' => ['main_hand'], 'gameplay' => ['weapon' => ['dice' => '2d6', 'damage_type' => 'slashing', 'kind' => 'melee', 'category' => 'martial', 'properties' => ['two_handed']]]]))->assertOk()->json('definition.id');
        $this->command($c, ['action' => 'give', 'libraryItemId' => $weapon, 'quantity' => 1, 'slot' => 'main_hand'])->assertUnprocessable();
        $this->assertEquals(2, $c->inventory()->count());
        $this->assertEquals(2, ItemDefinition::count());
    }

    public function test_library_inventory_receipt_rechecks_campaign_gm_authority(): void
    {
        $gm = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Shared']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $c = $campaign->characters()->create(['name' => 'Owned', 'kind' => 'player_character']);
        $c->forceFill(['library_user_id' => $gm->id])->save();
        $this->actingAs($gm);
        $id = $this->postJson('/api/library/items', $this->definition())->assertOk()->json('definition.id');
        $payload = ['action' => 'give', 'libraryItemId' => $id, 'quantity' => 1, 'clientMutationId' => (string) Str::uuid()];
        $this->command($c, $payload)->assertOk();
        $campaign->members()->updateExistingPivot($gm->id, ['role' => 'player']);
        $this->command($c, $payload)->assertForbidden();
        $this->getJson('/api/library/characters/'.$c->id.'/inventory')->assertForbidden();
        $this->assertDatabaseCount('inventory_items', 1);
    }

    public function test_duplicate_consumable_snapshot_is_used_in_session_after_template_edit(): void
    {
        $this->seedCharacterCatalog();
        Event::fake([TabletopEvent::class]);
        $gm = User::factory()->create();
        $this->actingAs($gm);
        $data = $this->definition(['name' => 'Healing draught', 'category' => 'consumable', 'max_stack' => 20, 'equipment_slots' => [], 'modifiers' => [],
            'gameplay' => ['use' => ['consume' => true, 'ability' => \App\Items\ItemActions::potionAbility()]]]);
        $original = $this->postJson('/api/library/items', $data)->assertOk()->json('definition.id');
        $data['name'] = 'Draught variant';
        $copy = $this->postJson('/api/library/items', $data)->assertOk()->json('definition.id');
        $c = Character::forceCreate(['library_user_id' => $gm->id, 'name' => 'Hero', 'kind' => 'player_character', 'hp' => 1, 'max_hp' => 50, 'abilities' => [], 'resources' => []]);
        $item = $this->command($c, ['action' => 'give', 'libraryItemId' => $copy, 'quantity' => 2])->assertOk()->json('items.0.id');
        $data['id'] = $copy;
        $data['gameplay']['use']['ability']['result']['dice'] = '1';
        $this->postJson('/api/library/items', $data)->assertOk();
        $campaign = Campaign::create(['name' => 'Draught session']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $this->postJson('/api/library/characters', ['id' => $c->id, 'name' => $c->name, 'campaign_id' => $campaign->id])->assertOk();
        $scene = $campaign->scenes()->create(['name' => 'Room', 'width' => 1000, 'height' => 1000, 'grid_size' => 50, 'distance_per_cell' => 5]);
        $campaign->forceFill(['active_scene_id' => $scene->id])->save();
        $token = $scene->tokens()->create(['name' => 'Hero', 'character_id' => $c->id, 'x' => 0, 'y' => 0]);
        $command = ['inventoryItemId' => $item, 'characterId' => $c->id, 'epoch' => 0, 'target' => ['kind' => 'token', 'id' => $token->id], 'rollMode' => 'normal', 'clientMutationId' => (string) Str::uuid()];
        $this->postJson('/api/scenes/'.$scene->id.'/inventory/use', $command)->assertOk();
        $this->assertGreaterThanOrEqual(5, $c->fresh()->hp);
        $this->assertEquals(1, $c->inventory()->findOrFail($item)->quantity);
        $this->assertSame('2d4+2', LibraryItem::findOrFail($original)->definition['gameplay']['use']['ability']['result']['dice']);
        Event::assertDispatched(TabletopEvent::class);
    }
}
