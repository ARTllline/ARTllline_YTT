<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\InventoryItem;
use App\Models\ItemDefinition;
use App\Models\User;
use App\Services\InventoryGrid;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class PlayerInventoryTest extends TestCase
{
    use DatabaseMigrations;

    private $gm;

    private $player;

    private $other;

    private $campaign;

    private $hero;

    private $scene;

    private $heal;

    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([TabletopEvent::class]);
        [$this->gm,$this->player,$this->other] = User::factory()->count(3)->create()->all();
        $this->campaign = Campaign::create(['name' => 'RPG']);
        foreach ([[$this->gm, 'gm'], [$this->player, 'player'], [$this->other, 'player']] as [$u,$role]) {
            $this->campaign->members()->attach($u, ['role' => $role]);
        }
        $this->scene = $this->campaign->scenes()->create(['name' => 'Table']);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $this->heal = ['id' => (string) Str::uuid(), 'name' => 'Potion action', 'icon' => 'potion', 'description' => 'Heal', 'category' => 'utility', 'target' => 'self', 'check' => null, 'costs' => [], 'damage' => null, 'result' => ['type' => 'heal', 'target' => null, 'amount' => 8], 'sort_order' => 0, 'enabled' => true, 'item_only' => true];
        $this->hero = $this->campaign->characters()->create(['name' => 'Hero', 'owner_user_id' => $this->player->id, 'hp' => 10, 'max_hp' => 41, 'ac' => 17, 'speed' => 30, 'check_stats' => [['key' => 'notice', 'label' => 'Notice', 'modifier' => 3]], 'resources' => [], 'abilities' => [$this->heal]]);
        DB::table('campaign_members')->where('campaign_id', $this->campaign->id)->where('user_id', $this->player->id)->update(['active_character_id' => $this->hero->id]);
    }

    private function definition(array $over = []): ItemDefinition
    {
        return ItemDefinition::forceCreate(['campaign_id' => $this->campaign->id, 'name' => 'Sword', 'icon' => 'item_sword', 'description' => 'Steel', 'category' => 'weapon', 'rarity' => 'common', 'width' => 1, 'height' => 3, 'max_stack' => 1, 'equipment_slots' => ['main_hand'], 'modifiers' => [], ...$over]);
    }

    private function give(ItemDefinition $d, int $quantity = 1): InventoryItem
    {
        $this->command(['action' => 'give', 'definitionId' => $d->id, 'quantity' => $quantity], true)->assertOk();

        return $this->hero->inventory()->where('item_definition_id', $d->id)->firstOrFail();
    }

    private function url(): string
    {
        return '/api/campaigns/'.$this->campaign->id.'/characters/'.$this->hero->id.'/inventory';
    }

    private function command(array $data, bool $gm = false)
    {
        return $this->actingAs($gm ? $this->gm : $this->player)->postJson($this->url(), ['clientMutationId' => (string) Str::uuid(), ...$data]);
    }

    private function useItem(InventoryItem $i, string $uuid)
    {
        return $this->actingAs($this->player)->postJson('/api/scenes/'.$this->scene->id.'/inventory/use', ['clientMutationId' => $uuid, 'characterId' => $this->hero->id, 'inventoryItemId' => $i->id, 'target' => null, 'epoch' => 0, 'rollMode' => 'normal']);
    }

    public function test_inventory_ownership_and_receipt_replay_are_reauthorized(): void
    {
        $i = $this->give($this->definition());
        $this->actingAs($this->other)->getJson($this->url())->assertForbidden();
        $this->actingAs($this->player)->getJson('/api/campaigns/'.$this->campaign->id.'/items')->assertForbidden();
        $this->command(['action' => 'give', 'definitionId' => $i->item_definition_id, 'quantity' => 1])->assertForbidden();
        $this->command(['action' => 'move', 'itemId' => (string) Str::uuid(), 'x' => 3, 'y' => 0])->assertNotFound();
        $data = ['action' => 'move', 'itemId' => $i->id, 'x' => 3, 'y' => 0, 'clientMutationId' => (string) Str::uuid()];
        $this->command($data)->assertOk();
        $this->hero->update(['owner_user_id' => $this->other->id]);
        $this->command($data)->assertForbidden();
        $this->actingAs($this->player)->getJson($this->url())->assertForbidden();
    }

    public function test_spatial_bounds_collisions_swaps_stacks_split_and_arrange(): void
    {
        $sword = $this->give($this->definition());
        $shield = $this->give($this->definition(['name' => 'Shield', 'width' => 2, 'height' => 2, 'equipment_slots' => ['off_hand']]));
        $this->command(['action' => 'move', 'itemId' => $shield->id, 'x' => 9, 'y' => 0])->assertUnprocessable();
        $this->command(['action' => 'move', 'itemId' => $sword->id, 'x' => 5, 'y' => 0])->assertOk();
        $potion = $this->give($this->definition(['name' => 'Potion', 'width' => 1, 'height' => 1, 'max_stack' => 10, 'equipment_slots' => [], 'use_ability_id' => $this->heal['id']]), 3);
        $this->command(['action' => 'split', 'itemId' => $potion->id, 'quantity' => 1])->assertOk();
        $split = $this->hero->inventory()->where('item_definition_id', $potion->item_definition_id)->where('id', '!=', $potion->id)->firstOrFail();
        $this->command(['action' => 'move', 'itemId' => $split->id, 'x' => $potion->fresh()->x, 'y' => $potion->fresh()->y])->assertOk();
        $this->assertSame(3, $potion->fresh()->quantity);
        $this->assertSame(0, $split->fresh()->quantity);
        $this->command(['action' => 'arrange'])->assertOk();
        $all = $this->hero->inventory()->with('definition')->get()->toArray();
        foreach ($all as $item) {
            if ($item['quantity'] > 0) {
                $this->assertTrue(app(InventoryGrid::class)->fits($all, $item['definition'], $item['x'], $item['y'], [$item['id']]));
            }
        }
    }

    public function test_equipment_is_compatible_and_derived_stats_never_overwrite_base_values(): void
    {
        $shield = $this->give($this->definition(['name' => 'Shield', 'width' => 2, 'height' => 2, 'equipment_slots' => ['off_hand'], 'modifiers' => ['ac' => 2, 'speed' => 5, 'checks' => ['notice' => 1]]]));
        $this->command(['action' => 'equip', 'itemId' => $shield->id, 'slot' => 'head'])->assertUnprocessable();
        $this->command(['action' => 'equip', 'itemId' => $shield->id, 'slot' => 'off_hand'])->assertOk()->assertJsonPath('character.ac', 19)->assertJsonPath('character.speed', 35)->assertJsonPath('character.checkStats.0.modifier', 4);
        $this->assertEquals(17, $this->hero->fresh()->getRawOriginal('ac'));
        $this->assertEquals(19, $this->hero->fresh()->ac);
        $token = $this->scene->tokens()->create(['name' => 'Hero', 'character_id' => $this->hero->id, 'x' => 1, 'y' => 1]);
        $this->assertEquals(19, $token->fresh()->ac);
        $this->actingAs($this->gm)->getJson('/api/campaigns/'.$this->campaign->id.'/characters')->assertOk()->assertJsonPath('characters.0.ac', 17);
        $this->command(['action' => 'move', 'itemId' => $shield->id, 'x' => 4, 'y' => 3])->assertOk()->assertJsonPath('character.ac', 17);
        $this->assertNull($shield->fresh()->equipped_slot);
    }

    public function test_consumption_is_atomic_durable_and_uses_the_existing_executor(): void
    {
        $potion = $this->give($this->definition(['name' => 'Potion', 'width' => 1, 'height' => 1, 'max_stack' => 10, 'equipment_slots' => [], 'use_ability_id' => $this->heal['id']]), 3);
        $uuid = (string) Str::uuid();
        $first = $this->useItem($potion, $uuid)->assertOk()->assertJsonPath('execution.healing', 8)->json('execution');
        $this->assertSame(2, $potion->fresh()->quantity);
        $this->assertSame(18, $this->hero->fresh()->hp);
        $this->useItem($potion, $uuid)->assertOk()->assertJsonPath('execution', $first);
        DB::table('scene_mutation_receipts')->delete();
        $this->useItem($potion, $uuid)->assertOk()->assertJsonPath('execution', $first);
        $this->assertSame(2, $potion->fresh()->quantity);
        $this->assertSame(18, $this->hero->fresh()->hp);
        $this->useItem($potion, (string) Str::uuid())->assertOk();
        $this->useItem($potion, (string) Str::uuid())->assertOk();
        $this->assertSame(0, $potion->fresh()->quantity);
        $this->useItem($potion, (string) Str::uuid())->assertNotFound();
        $this->actingAs($this->player)->postJson('/api/scenes/'.$this->scene->id.'/abilities/execute', ['clientMutationId' => (string) Str::uuid(), 'characterId' => $this->hero->id, 'abilityId' => $this->heal['id'], 'target' => null, 'epoch' => 0, 'rollMode' => 'normal'])->assertForbidden();
    }

    public function test_failed_use_does_not_consume_and_typed_hotbar_rejects_forged_items(): void
    {
        $potion = $this->give($this->definition(['width' => 1, 'height' => 1, 'max_stack' => 10, 'equipment_slots' => [], 'use_ability_id' => $this->heal['id']]), 2);
        $slots = array_fill(0, 32, null);
        $slots[5] = ['sourceType' => 'inventory_item', 'sourceId' => $potion->id];
        $url = '/api/campaigns/'.$this->campaign->id.'/characters/'.$this->hero->id.'/hotbar';
        $this->actingAs($this->player)->putJson($url, ['version' => 2, 'slots' => $slots])->assertOk()->assertJsonPath('slots.5.sourceType', 'inventory_item');
        $slots[5]['sourceId'] = (string) Str::uuid();
        $this->putJson($url, ['version' => 2, 'slots' => $slots])->assertUnprocessable();
        $ability = $this->heal;
        $ability['costs'] = [['key' => 'missing', 'amount' => 1]];
        $this->hero->update(['abilities' => [$ability]]);
        $this->useItem($potion, (string) Str::uuid())->assertUnprocessable();
        $this->assertSame(2, $potion->fresh()->quantity);
        $this->assertSame(10, $this->hero->fresh()->hp);
    }

    public function test_spell_metadata_allows_the_same_class_across_spells_and_enforces_preparation(): void
    {
        $spells = [];
        foreach ([0, 1, 2] as $level) {
            $spells[] = [...$this->heal, 'id' => (string) Str::uuid(), 'item_only' => false,
                'spell' => ['level' => $level, 'school' => 'Evocation', 'classes' => ['Wizard'], 'known' => true, 'prepared' => $level !== 2]];
        }
        $url = '/api/campaigns/'.$this->campaign->id.'/characters';
        $this->actingAs($this->gm)->postJson($url, ['clientMutationId' => (string) Str::uuid(), 'id' => $this->hero->id, 'name' => 'Hero', 'abilities' => $spells])->assertOk();
        $this->actingAs($this->player)->postJson('/api/scenes/'.$this->scene->id.'/abilities/execute', [
            'clientMutationId' => (string) Str::uuid(), 'characterId' => $this->hero->id, 'abilityId' => $spells[2]['id'], 'epoch' => 0, 'target' => null, 'rollMode' => 'normal',
        ])->assertForbidden();
        $spells[0]['spell']['classes'] = ['Wizard', 'Wizard'];
        $this->actingAs($this->gm)->postJson($url, ['clientMutationId' => (string) Str::uuid(), 'id' => $this->hero->id, 'name' => 'Hero', 'abilities' => $spells])->assertUnprocessable();
    }

    public function test_item_ids_and_receipts_cannot_be_reused_across_characters(): void
    {
        $item = $this->give($this->definition());
        $otherHero = $this->campaign->characters()->create(['name' => 'Other', 'owner_user_id' => $this->player->id]);
        $otherUrl = '/api/campaigns/'.$this->campaign->id.'/characters/'.$otherHero->id.'/inventory';
        $data = ['action' => 'move', 'itemId' => $item->id, 'x' => 6, 'y' => 0, 'clientMutationId' => (string) Str::uuid()];
        $this->command($data)->assertOk();
        $this->postJson($otherUrl, $data)->assertConflict();
        $data['clientMutationId'] = (string) Str::uuid();
        $this->postJson($otherUrl, $data)->assertNotFound();
        $this->assertSame(6, $item->fresh()->x);
    }

    public function test_valid_swap_and_collision_rollback_and_definition_resize(): void
    {
        $sword = $this->give($this->definition());
        $shield = $this->give($this->definition(['name' => 'Shield', 'width' => 2, 'height' => 2]));
        $this->command(['action' => 'move', 'itemId' => $shield->id, 'x' => 5, 'y' => 0])->assertOk();
        $this->command(['action' => 'move', 'itemId' => $sword->id, 'x' => 5, 'y' => 0])->assertOk();
        $this->assertSame(0, $shield->fresh()->x);
        $this->assertSame(5, $sword->fresh()->x);
        $scroll = $this->give($this->definition(['name' => 'Scroll', 'width' => 1, 'height' => 1]));
        $this->command(['action' => 'move', 'itemId' => $scroll->id, 'x' => 6, 'y' => 0])->assertOk();
        $this->command(['action' => 'move', 'itemId' => $sword->id, 'x' => 1, 'y' => 0])->assertUnprocessable();
        $this->assertSame(5, $sword->fresh()->x);
        $d = $shield->definition->toArray();
        unset($d['campaign_id'], $d['created_at'], $d['updated_at']);
        $d['width'] = 4;
        $this->command(['action' => 'move', 'itemId' => $sword->id, 'x' => 3, 'y' => 0])->assertOk();
        $this->actingAs($this->gm)->postJson('/api/campaigns/'.$this->campaign->id.'/items', ['clientMutationId' => (string) Str::uuid(), ...$d])->assertUnprocessable();
        $this->assertSame(2, $shield->definition->fresh()->width);
    }

    public function test_equipped_items_swap_between_compatible_slots(): void
    {
        $ring = $this->definition(['name' => 'Ring', 'width' => 1, 'height' => 1, 'equipment_slots' => ['ring_1', 'ring_2']]);
        $this->give($ring, 2);
        [$first, $second] = $this->hero->inventory()->where('item_definition_id', $ring->id)->orderBy('id')->get()->all();
        $this->command(['action' => 'equip', 'itemId' => $first->id, 'slot' => 'ring_1'])->assertOk();
        $this->command(['action' => 'equip', 'itemId' => $second->id, 'slot' => 'ring_2'])->assertOk();
        $this->command(['action' => 'equip', 'itemId' => $first->id, 'slot' => 'ring_2'])->assertOk();
        $this->assertSame('ring_2', $first->fresh()->equipped_slot);
        $this->assertSame('ring_1', $second->fresh()->equipped_slot);
    }

    public function test_full_bag_rejects_unequip_without_losing_equipment(): void
    {
        $sword = $this->give($this->definition());
        $this->command(['action' => 'equip', 'itemId' => $sword->id, 'slot' => 'main_hand'])->assertOk();
        $this->give($this->definition(['name' => 'Small', 'width' => 1, 'height' => 1, 'equipment_slots' => []]), 60);
        $this->command(['action' => 'unequip', 'itemId' => $sword->id])->assertUnprocessable();
        $this->assertSame('main_hand', $sword->fresh()->equipped_slot);
        $this->assertSame(61, $this->hero->inventory()->where('quantity', '>', 0)->count());
    }
}
