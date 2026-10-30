<?php

namespace Tests\Feature;

use App\Combat\ConditionRules;
use App\Compendium\SrdEquipmentMapper;
use App\Compendium\SrdKeys;
use App\Events\TabletopEvent;
use App\Items\ItemActions;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\Combat;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use App\Models\InventoryItem;
use App\Models\ItemDefinition;
use App\Models\LootContainer;
use App\Models\SceneProp;
use App\Models\User;
use App\Services\CharacterRules;
use App\Services\D20Roller;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\Support\SeedsCharacterCatalog;
use Tests\TestCase;

class ItemsLootGameplayTest extends TestCase
{
    use DatabaseMigrations,SeedsCharacterCatalog;

    private $gm;

    private $a;

    private $b;

    private $campaign;

    private $scene;

    private $hero;

    private $friend;

    private $actor;

    private $enemy;

    private $loot;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCharacterCatalog();
        Event::fake([TabletopEvent::class]);
        [$this->gm,$this->a,$this->b] = User::factory()->count(3)->create()->all();
        $this->campaign = Campaign::create(['name' => 'Items']);
        foreach ([$this->gm, $this->a, $this->b] as $u) {
            $this->campaign->members()->attach($u, ['role' => $u === $this->gm ? 'gm' : 'player']);
        }
        $this->scene = $this->campaign->scenes()->create(['name' => 'Arena', 'width' => 10000, 'height' => 10000, 'grid_size' => 50, 'distance_per_cell' => 5]);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $r = app(CharacterRules::class)->defaults();
        $r['scores']['str'] = 16;
        $r['scores']['dex'] = 14;
        $r['proficiency_bonus'] = 3;
        $this->hero = $this->campaign->characters()->create(['name' => 'A', 'owner_user_id' => $this->a->id, 'rules' => $r, 'ac' => 10, 'speed' => 30, 'hp' => 5, 'max_hp' => 50, 'resources' => [], 'abilities' => [], 'kind' => 'player_character']);
        $this->friend = $this->campaign->characters()->create(['name' => 'B', 'owner_user_id' => $this->b->id, 'rules' => $r, 'ac' => 10, 'speed' => 30, 'hp' => 50, 'max_hp' => 50, 'resources' => [], 'abilities' => [], 'kind' => 'player_character']);
        $this->actor = $this->scene->tokens()->create(['character_id' => $this->hero->id, 'name' => 'A', 'x' => 0, 'y' => 0]);
        $this->scene->tokens()->create(['character_id' => $this->friend->id, 'name' => 'B', 'x' => 0, 'y' => 50]);
        $this->enemy = $this->scene->tokens()->create(['name' => 'Target', 'x' => 50, 'y' => 0, 'hp' => 999, 'max_hp' => 999, 'ac' => 10]);
        foreach ([[$this->a, $this->hero], [$this->b, $this->friend]] as [$u,$c]) {
            DB::table('campaign_members')->where('campaign_id', $this->campaign->id)->where('user_id', $u->id)->update(['active_character_id' => $c->id]);
        }
        $prop = SceneProp::create(['scene_id' => $this->scene->id, 'asset_id' => null, 'name' => 'Chest', 'x' => 50, 'y' => 50]);
        $this->loot = LootContainer::create(['scene_id' => $this->scene->id, 'prop_id' => $prop->id, 'name' => 'Chest', 'created_by' => $this->gm->id, 'is_open' => true]);
        $this->actingAs($this->a);
    }

    private function definition(array $patch = []): ItemDefinition
    {
        $definition = (new ItemDefinition)->forceFill(array_replace(['campaign_id' => $this->campaign->id, 'name' => 'Item', 'icon' => 'item_sword', 'description' => '', 'category' => 'other', 'rarity' => 'common', 'width' => 1, 'height' => 1, 'max_stack' => 99, 'equipment_slots' => [], 'modifiers' => [], 'use_ability_id' => null], $patch));
        $definition->save();

        return $definition;
    }

    private function weapon(array $patch = []): ItemDefinition
    {
        return $this->definition(['name' => 'Longsword', 'category' => 'weapon', 'max_stack' => 1, 'equipment_slots' => ['main_hand'], 'gameplay' => ['weapon' => array_replace(['dice' => '1d8', 'damage_type' => 'slashing', 'properties' => ['versatile'], 'category' => 'martial', 'kind' => 'melee', 'range' => ['normal' => 5, 'long' => null], 'versatile_dice' => '1d10', 'attack_bonus' => 0, 'damage_bonus' => 0], $patch)]]);
    }

    private function give(ItemDefinition $d, int $qty = 1, ?Character $c = null): InventoryItem
    {
        return ($c ?? $this->hero)->inventory()->create(['item_definition_id' => $d->id, 'quantity' => $qty, 'x' => ($c ?? $this->hero)->inventory()->count() % 10, 'y' => 0, 'weapon_proficient' => true]);
    }

    private function inv(array $data, ?User $u = null, ?Character $c = null)
    {
        return $this->actingAs($u ?? $this->a)->postJson('/api/campaigns/'.$this->campaign->id.'/characters/'.($c ?? $this->hero)->id.'/inventory', $data + ['clientMutationId' => (string) Str::uuid()]);
    }

    private function useItem(InventoryItem $i, array $patch = [])
    {
        return $this->actingAs($this->a)->postJson('/api/scenes/'.$this->scene->id.'/inventory/use', array_replace(['inventoryItemId' => $i->id, 'characterId' => $this->hero->id, 'epoch' => 0, 'target' => ['kind' => 'token', 'id' => (string) $this->enemy->id], 'rollMode' => 'normal', 'clientMutationId' => (string) Str::uuid()], $patch));
    }

    private function loot(array $data, ?User $u = null)
    {
        return $this->actingAs($u ?? $this->a)->postJson('/api/campaigns/'.$this->campaign->id.'/loot', $data + ['clientMutationId' => (string) Str::uuid(), 'containerId' => $this->loot->id]);
    }

    public function test_equipped_weapon_resolves_current_definition_and_rules_without_authored_ability(): void
    {
        $d = $this->weapon();
        $i = $this->give($d);
        $this->inv(['action' => 'equip', 'itemId' => $i->id, 'slot' => 'main_hand'])->assertOk();
        $this->mock(D20Roller::class)->shouldReceive('roll')->twice()->andReturn(15);
        $r = $this->useItem($i, ['damage' => '20d20+99', 'weaponModifier' => 99, 'grip' => 'two'])->assertOk()->assertJsonPath('execution.roll.modifier', 6)->assertJsonPath('execution.damage.expression', '1d8')->assertJsonPath('execution.damage.modifier', 3)->json();
        $this->assertSame(1, $i->fresh()->quantity);
        $this->assertSame([], $this->hero->fresh()->abilities);
        $g = $d->gameplay;
        $g['weapon']['dice'] = '1d6';
        $d->update(['gameplay' => $g]);
        $this->useItem($i)->assertOk()->assertJsonPath('execution.damage.expression', '1d6');
        $this->inv(['action' => 'unequip', 'itemId' => $i->id])->assertOk();
        $this->useItem($i)->assertUnprocessable();
    }

    public function test_finesse_selects_higher_stat_ties_strength_and_allows_explicit_legal_choice(): void
    {
        $i = $this->give($this->weapon(['properties' => ['finesse'], 'versatile_dice' => null]));
        $this->inv(['action' => 'equip', 'itemId' => $i->id, 'slot' => 'main_hand'])->assertOk();
        $r = $this->hero->rules;
        $r['scores']['dex'] = 18;
        $this->hero->update(['rules' => $r]);
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(15);
        $this->useItem($i)->assertOk()->assertJsonPath('execution.roll.modifier', 7)->assertJsonPath('execution.damage.modifier', 4);
        $this->inv(['action' => 'configure', 'itemId' => $i->id, 'attack_ability' => 'str'])->assertOk();
        $this->useItem($i)->assertOk()->assertJsonPath('execution.roll.modifier', 6)->assertJsonPath('execution.damage.modifier', 3);
        $this->inv(['action' => 'configure', 'itemId' => $i->id, 'weapon_proficient' => true])->assertForbidden();
    }

    public function test_versatile_shield_and_two_handed_compatibility_are_authoritative(): void
    {
        $i = $this->give($this->weapon());
        $shield = $this->give($this->definition(['category' => 'shield', 'equipment_slots' => ['off_hand'], 'max_stack' => 1, 'gameplay' => ['armor' => ['category' => 'shield', 'ac_bonus' => 2, 'add_dex' => false, 'ac_semantics' => 'bonus']]]));
        $this->inv(['action' => 'equip', 'itemId' => $i->id, 'slot' => 'main_hand'])->assertOk();
        $this->inv(['action' => 'configure', 'itemId' => $i->id, 'grip' => 'two'])->assertOk();
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(15);
        $this->useItem($i)->assertOk()->assertJsonPath('execution.damage.expression', '1d10');
        $this->inv(['action' => 'equip', 'itemId' => $shield->id, 'slot' => 'off_hand'])->assertUnprocessable();
        $this->assertNull($shield->fresh()->equipped_slot);
        $this->inv(['action' => 'configure', 'itemId' => $i->id, 'grip' => 'one'])->assertOk();
        $this->inv(['action' => 'equip', 'itemId' => $shield->id, 'slot' => 'off_hand'])->assertOk();
        $this->useItem($i)->assertOk()->assertJsonPath('execution.damage.expression', '1d8');
        $this->inv(['action' => 'configure', 'itemId' => $i->id, 'grip' => 'two'])->assertUnprocessable();
    }

    public function test_ranged_ammo_misses_long_range_uuid_and_no_ammo(): void
    {
        $w = $this->give($this->weapon(['kind' => 'ranged', 'properties' => ['ammunition', 'two_handed', 'loading'], 'ammunition' => 'arrows', 'range' => ['normal' => 150, 'long' => 600], 'versatile_dice' => null]));
        $ammo = $this->give($this->definition(['category' => 'ammunition', 'gameplay' => ['ammunition' => 'arrows']]), 3);
        $this->inv(['action' => 'equip', 'itemId' => $w->id, 'slot' => 'main_hand'])->assertOk();
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(1);
        $uuid = (string) Str::uuid();
        $first = $this->useItem($w, ['clientMutationId' => $uuid])->assertOk()->assertJsonPath('execution.success', false)->json();
        $this->assertSame(2, $ammo->fresh()->quantity);
        $this->useItem($w, ['clientMutationId' => $uuid])->assertOk()->assertExactJson($first);
        $this->assertSame(2, $ammo->fresh()->quantity);
        $this->enemy->update(['x' => 2000]);
        $this->useItem($w)->assertOk()->assertJsonPath('execution.roll.rollMode', 'disadvantage');
        $this->assertSame(1, $ammo->fresh()->quantity);
        $this->enemy->update(['x' => 6100]);
        $this->useItem($w)->assertUnprocessable();
        $this->assertSame(1, $ammo->fresh()->quantity);
        $ammo->update(['quantity' => 0]);
        $this->enemy->update(['x' => 50]);
        $this->useItem($w)->assertUnprocessable();
        $this->getJson('/api/campaigns/'.$this->campaign->id.'/characters/'.$this->hero->id.'/inventory')->assertJsonFragment(['reason' => 'Нет боеприпасов: arrows.']);
    }

    public function test_thrown_uses_melee_ability_and_consumes_the_actual_weapon(): void
    {
        $w = $this->give($this->weapon(['properties' => ['thrown'], 'throw_range' => ['normal' => 20, 'long' => 60], 'versatile_dice' => null]));
        $this->inv(['action' => 'equip', 'itemId' => $w->id, 'slot' => 'main_hand'])->assertOk();
        $this->enemy->update(['x' => 300]);
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(15);
        $this->useItem($w, ['itemAction' => 'throw'])->assertOk()->assertJsonPath('execution.roll.modifier', 6)->assertJsonPath('execution.roll.rollMode', 'disadvantage');
        $this->assertNull($w->fresh()->character_id);
        $this->assertNotNull($w->fresh()->loot_container_id);
        $this->assertSame(1, $w->fresh()->quantity);
        $this->assertNull($w->fresh()->equipped_slot);
    }

    public function test_armor_formulas_negative_dex_shield_strength_and_unequip(): void
    {
        foreach ([['light_armor', 11, true, null, 13], ['medium_armor', 14, true, 2, 16], ['heavy_armor', 16, false, null, 16]] as [$cat,$base,$dex,$cap,$expected]) {
            $d = $this->definition(['category' => 'armor', 'max_stack' => 1, 'equipment_slots' => ['armor'], 'gameplay' => ['armor' => ['category' => $cat, 'base_ac' => $base, 'add_dex' => $dex, 'max_dex_bonus' => $cap, 'strength_minimum' => 17, 'stealth_disadvantage' => true]]]);
            $i = $this->give($d);
            $this->inv(['action' => 'equip', 'itemId' => $i->id, 'slot' => 'armor'])->assertOk()->assertJsonPath('character.derived.ac', $expected)->assertJsonPath('character.derived.speed', 20);
            $this->inv(['action' => 'unequip', 'itemId' => $i->id])->assertOk()->assertJsonPath('character.derived.ac', 10)->assertJsonPath('character.derived.speed', 30);
        }
        $r = $this->hero->rules;
        $r['scores']['dex'] = 8;
        $this->hero->update(['rules' => $r]);
        $this->inv(['action' => 'equip', 'itemId' => $i->id, 'slot' => 'armor'])->assertOk()->assertJsonPath('character.derived.ac', 16);
        $s = $this->give($this->definition(['category' => 'shield', 'max_stack' => 1, 'equipment_slots' => ['off_hand'], 'gameplay' => ['armor' => ['category' => 'shield', 'ac_bonus' => 2, 'add_dex' => false]]]));
        $this->inv(['action' => 'equip', 'itemId' => $s->id, 'slot' => 'off_hand'])->assertOk()->assertJsonPath('character.derived.ac', 18);
    }

    public function test_embedded_consumable_heals_and_consumes_once_without_character_ability(): void
    {
        $d = $this->definition(['category' => 'consumable', 'gameplay' => ['use' => ['consume' => true, 'ability' => ItemActions::potionAbility()]]]);
        $i = $this->give($d, 3);
        $uuid = (string) Str::uuid();
        $r = $this->useItem($i, ['target' => ['kind' => 'token', 'id' => $this->actor->id], 'clientMutationId' => $uuid])->assertOk()->json();
        $hp = $this->hero->fresh()->hp;
        $this->assertGreaterThan(5, $hp);
        $this->assertSame(2, $i->fresh()->quantity);
        $this->useItem($i, ['target' => ['kind' => 'token', 'id' => $this->actor->id], 'clientMutationId' => $uuid])->assertOk()->assertExactJson($r);
        $this->assertSame($hp, $this->hero->fresh()->hp);
        $this->assertSame(2, $i->fresh()->quantity);
    }

    public function test_loot_pickup_shared_state_stale_final_item_and_idempotency(): void
    {
        $d = $this->weapon();
        $i = $this->loot->items()->create(['item_definition_id' => $d->id, 'quantity' => 1]);
        $uuid = (string) Str::uuid();
        $cmd = ['action' => 'take', 'itemId' => $i->id, 'characterId' => $this->hero->id, 'clientMutationId' => $uuid];
        $first = $this->loot($cmd)->assertOk()->json();
        $this->loot($cmd)->assertOk()->assertExactJson($first);
        $this->loot(['action' => 'take', 'itemId' => $i->id, 'characterId' => $this->friend->id], $this->b)->assertConflict();
        $this->assertSame(1, InventoryItem::where('item_definition_id', $d->id)->sum('quantity'));
        $this->assertSame($this->hero->id, $i->fresh()->character_id);
        $this->assertNull($i->fresh()->loot_container_id);
    }

    public function test_take_all_is_all_or_nothing_when_bag_is_full(): void
    {
        $d = $this->definition(['max_stack' => 1]);
        for ($y = 0; $y < 6; $y++) {
            for ($x = 0; $x < 10; $x++) {
                if ($x !== 9 || $y !== 5) {
                    $this->hero->inventory()->create(['item_definition_id' => $d->id, 'quantity' => 1, 'x' => $x, 'y' => $y]);
                }
            }
        }
        foreach ([1, 2] as $n) {
            $this->loot->items()->create(['item_definition_id' => $d->id, 'quantity' => 1]);
        }
        $this->loot(['action' => 'take-all', 'characterId' => $this->hero->id])->assertUnprocessable();
        $this->assertSame(59, $this->hero->inventory()->count());
        $this->assertSame(2, $this->loot->items()->sum('quantity'));
    }

    public function test_owner_initiated_gift_drop_pickup_and_unauthorized_pull(): void
    {
        $d = $this->definition();
        $i = $this->give($d, 5);
        $this->inv(['action' => 'transfer', 'itemId' => $i->id, 'recipientId' => $this->friend->id, 'quantity' => 2])->assertOk();
        $this->assertSame(3, $i->fresh()->quantity);
        $incoming = $this->friend->inventory()->first();
        $this->assertSame(2, $incoming->quantity);
        $this->inv(['action' => 'transfer', 'itemId' => $incoming->id, 'recipientId' => $this->hero->id, 'quantity' => 1], $this->a, $this->friend)->assertForbidden();
        $uuid = (string) Str::uuid();
        $cmd = ['action' => 'drop', 'itemId' => $incoming->id, 'quantity' => 2, 'clientMutationId' => $uuid];
        $this->inv($cmd, $this->b, $this->friend)->assertOk();
        $this->inv($cmd, $this->b, $this->friend)->assertOk();
        $pile = LootContainer::where('kind', 'drop')->sole();
        $this->assertSame(2, $pile->items()->sum('quantity'));
        $this->actingAs($this->a)->postJson('/api/campaigns/'.$this->campaign->id.'/loot', ['action' => 'take-all', 'containerId' => $pile->id, 'characterId' => $this->hero->id, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->assertSame(5, $this->hero->inventory()->sum('quantity'));
    }

    public function test_hidden_closed_corpse_and_foreign_ownership_never_leak_contents(): void
    {
        $d = $this->definition(['name' => 'SECRET LOOT']);
        $this->loot->items()->create(['item_definition_id' => $d->id, 'quantity' => 3]);
        $this->loot->update(['is_open' => false]);
        $url = '/api/campaigns/'.$this->campaign->id.'/loot?containerId='.$this->loot->id;
        $this->getJson($url)->assertOk()->assertJsonCount(0, 'loot.items');
        $this->loot(['action' => 'open'])->assertOk()->assertJsonPath('loot.items.0.quantity', 3);
        $this->loot(['action' => 'take-all', 'characterId' => $this->friend->id])->assertForbidden();
        $this->loot->object()->update(['is_hidden' => true]);
        $this->getJson($url)->assertForbidden();
        $this->assertSame(3, $this->loot->items()->sum('quantity'));
    }

    public function test_compendium_copy_keeps_current_structured_rules_independent_of_library(): void
    {
        foreach (['equipment-longsword', 'equipment-shield', 'equipment-leather-armor', 'equipment-chain-mail'] as $fixture) {
            $raw = json_decode(file_get_contents(base_path('tests/Fixtures/compendium/'.$fixture.'.json')), true);
            $mapper = app(SrdEquipmentMapper::class);
            $n = $mapper->map($raw) + ['key' => SrdKeys::key($raw['index']), 'name' => $raw['name']];
            $entry = CompendiumEntry::create(['source_id' => CompendiumSource::first()->id, 'entity_type' => $mapper->type($raw), 'external_key' => $raw['index'], 'slug' => $raw['index'], 'name' => $raw['name'], 'raw_data' => $raw, 'normalized_data' => $n, 'checksum' => str_repeat('a', 64), 'normalization_version' => 1, 'imported_at' => now()]);
            $r = $this->actingAs($this->gm)->postJson('/api/campaigns/'.$this->campaign->id.'/compendium/copy', ['entry_id' => $entry->id, 'clientMutationId' => (string) Str::uuid()])->assertOk();
            $d = ItemDefinition::findOrFail($r->json('definition.id'));
            $this->assertNotNull($d->gameplay);
            $this->assertSame($entry->id, $d->compendium_entry_id);
            $snapshot = $d->gameplay;
            $entry->update(['normalized_data' => ['name' => 'changed']]);
            $this->assertSame($snapshot, $d->fresh()->gameplay);
            if ($fixture === 'equipment-longsword') {
                $this->assertSame('1d10', $d->gameplay['weapon']['versatile_dice']);
            }
            if ($fixture === 'equipment-shield') {
                $this->assertSame('shield', $d->category);
            }
        }
    }

    public function test_definition_edits_validate_current_hand_state_and_embedded_actions_are_private(): void
    {
        $d = $this->weapon();
        $w = $this->give($d);
        $shield = $this->give($this->definition(['category' => 'shield', 'max_stack' => 1, 'equipment_slots' => ['off_hand']]));
        $this->inv(['action' => 'equip', 'itemId' => $w->id, 'slot' => 'main_hand'])->assertOk();
        $this->inv(['action' => 'equip', 'itemId' => $shield->id, 'slot' => 'off_hand'])->assertOk();
        $data = $d->toArray();
        $data['gameplay']['weapon']['properties'] = ['two_handed'];
        $data['clientMutationId'] = (string) Str::uuid();
        $this->actingAs($this->gm)->postJson('/api/campaigns/'.$this->campaign->id.'/items', $data)->assertUnprocessable();
        $this->assertSame(['versatile'], $d->fresh()->gameplay['weapon']['properties']);
        $ability = ItemActions::potionAbility();
        $ability['check'] = ['stat_key' => 'wis', 'modifier' => 0, 'dc' => 19, 'dc_visible' => false, 'defense' => 'fixed'];
        $ability['category'] = 'check';
        $ability['result'] = ['type' => 'nothing', 'target' => null, 'amount' => 0];
        $cons = $this->definition(['category' => 'consumable', 'gameplay' => ['use' => ['consume' => true, 'ability' => $ability]]]);
        $this->give($cons);
        $json = $this->actingAs($this->a)->getJson('/api/campaigns/'.$this->campaign->id.'/characters/'.$this->hero->id.'/inventory')->assertOk()->json();
        $safe = collect($json['items'])->firstWhere('item_definition_id', $cons->id);
        $this->assertArrayNotHasKey('dc', $safe['definition']['gameplay']['use']['ability']['check']);
        $this->assertArrayNotHasKey('result', $safe['definition']['gameplay']['use']['ability']);
    }

    public function test_ammo_and_action_roll_back_for_invalid_attempt_and_durable_retry(): void
    {
        $w = $this->give($this->weapon(['kind' => 'ranged', 'properties' => ['ammunition', 'two_handed'], 'ammunition' => 'arrows', 'range' => ['normal' => 150, 'long' => 600]]));
        $ammo = $this->give($this->definition(['category' => 'ammunition', 'gameplay' => ['ammunition' => 'arrows']]), 3);
        $this->inv(['action' => 'equip', 'itemId' => $w->id, 'slot' => 'main_hand'])->assertOk();
        $combat = Combat::create(['scene_id' => $this->scene->id, 'created_by' => $this->gm->id]);
        $entry = $combat->combatants()->create(['token_id' => $this->actor->id, 'position' => 0]);
        $this->actingAs($this->gm)->postJson('/api/scenes/'.$this->scene->id.'/combat/begin', ['combatId' => (string) $combat->id, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->enemy->update(['x' => 7000]);
        $this->useItem($w)->assertUnprocessable();
        $this->assertSame(3, $ammo->fresh()->quantity);
        $this->assertTrue($entry->fresh()->action_available);
        $this->enemy->update(['x' => 50]);
        $this->mock(D20Roller::class)->shouldReceive('roll')->once()->andReturn(15);
        $uuid = (string) Str::uuid();
        $r = $this->useItem($w, ['clientMutationId' => $uuid])->assertOk()->json();
        DB::table('scene_mutation_receipts')->delete();
        $this->useItem($w, ['clientMutationId' => $uuid])->assertOk()->assertExactJson($r);
        $this->assertSame(2, $ammo->fresh()->quantity);
        $this->useItem($w)->assertUnprocessable();
        $this->assertSame(2, $ammo->fresh()->quantity);
    }

    public function test_take_all_merges_and_places_without_exposing_contents_in_scene(): void
    {
        $d = $this->definition(['max_stack' => 20]);
        $existing = $this->give($d, 18);
        $this->loot->items()->create(['item_definition_id' => $d->id, 'quantity' => 5]);
        $other = $this->weapon();
        $this->loot->items()->create(['item_definition_id' => $other->id, 'quantity' => 1]);
        $this->loot(['action' => 'take-all', 'characterId' => $this->hero->id])->assertOk();
        $this->assertSame(20, $existing->fresh()->quantity);
        $this->assertSame(24, $this->hero->inventory()->sum('quantity'));
        $this->assertSame(0, $this->loot->items()->where('quantity', '>', 0)->count());
        $snap = $this->actingAs($this->b)->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk();
        $snap->assertJsonPath('props.0.loot.empty', true)->assertJsonMissingPath('props.0.loot.items');
    }

    public function test_corpse_loot_is_manual_and_only_visible_after_defeat(): void
    {
        $c = LootContainer::create(['scene_id' => $this->scene->id, 'token_id' => $this->enemy->id, 'name' => 'Corpse', 'kind' => 'corpse', 'created_by' => $this->gm->id]);
        $d = $this->definition();
        $c->items()->create(['item_definition_id' => $d->id, 'quantity' => 3]);
        $url = '/api/campaigns/'.$this->campaign->id.'/loot?containerId='.$c->id;
        $this->getJson($url)->assertForbidden();
        $this->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertJsonMissingPath('tokens.2.loot');
        $this->enemy->update(['hp' => 0]);
        $this->getJson($url)->assertOk()->assertJsonCount(0, 'loot.items');
        $this->postJson('/api/campaigns/'.$this->campaign->id.'/loot', ['action' => 'open', 'containerId' => $c->id, 'clientMutationId' => (string) Str::uuid()])->assertOk()->assertJsonPath('loot.items.0.quantity', 3);
        $this->assertSame(0, $this->hero->inventory()->count());
    }

    public function test_medium_armor_keeps_negative_dex_and_stealth_reason(): void
    {
        $r = $this->hero->rules;
        $r['scores']['dex'] = 8;
        $this->hero->update(['rules' => $r]);
        $i = $this->give($this->definition(['category' => 'armor', 'max_stack' => 1, 'equipment_slots' => ['armor'], 'gameplay' => ['armor' => ['category' => 'medium_armor', 'base_ac' => 14, 'add_dex' => true, 'max_dex_bonus' => 2, 'stealth_disadvantage' => true]]]));
        $this->inv(['action' => 'equip', 'itemId' => $i->id, 'slot' => 'armor'])->assertOk()->assertJsonPath('character.derived.ac', 13);
        $ctx = app(ConditionRules::class)->context($this->actor, 'check', 'normal', null, 0, null, false, 'stealth');
        $this->assertSame('disadvantage', $ctx['mode']);
        $this->assertStringContainsString('Скрытность', $ctx['disadvantage'][0]['label']);
    }

    public function test_ranged_thrown_dart_moves_weapon_into_loot_and_gm_can_put_real_instances_in_chest(): void
    {
        $w = $this->give($this->weapon(['kind' => 'ranged', 'properties' => ['finesse', 'thrown'], 'range' => ['normal' => 20, 'long' => 60], 'versatile_dice' => null]));
        $this->inv(['action' => 'equip', 'itemId' => $w->id, 'slot' => 'main_hand'])->assertOk();
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(15);
        $this->useItem($w)->assertOk();
        $w->refresh();
        $this->assertNull($w->character_id);
        $this->assertNotNull($w->loot_container_id);
        $this->assertSame(1, $w->quantity);
        $this->assertNull($w->equipped_slot);
        $d = $this->definition();
        $i = $this->give($d, 3);
        $uuid = (string) Str::uuid();
        $cmd = ['action' => 'put', 'itemId' => $i->id, 'quantity' => 2, 'containerId' => $this->loot->id, 'clientMutationId' => $uuid];
        $this->inv($cmd)->assertForbidden();
        $this->inv($cmd, $this->gm)->assertOk();
        $this->inv($cmd, $this->gm)->assertOk();
        $this->assertSame(1, $i->fresh()->quantity);
        $this->assertSame(2, $this->loot->items()->where('item_definition_id', $d->id)->sum('quantity'));
    }
}
