<?php

namespace Tests\Feature;

use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\ItemDefinition;
use App\Models\LibraryItem;
use App\Models\LootContainer;
use App\Models\SceneProp;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class ContainerPreparationTest extends TestCase
{
    use DatabaseMigrations;

    private $gm;

    private $player;

    private $campaign;

    private $scene;

    private $loot;

    private $template;

    private $hero;

    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([TabletopEvent::class]);
        [$this->gm, $this->player] = User::factory()->count(2)->create()->all();
        $this->campaign = Campaign::create(['name' => 'Preparation']);
        $this->campaign->members()->attach($this->gm, ['role' => 'gm']);
        $this->campaign->members()->attach($this->player, ['role' => 'player']);
        $this->scene = $this->campaign->scenes()->create(['name' => 'Chest']);
        $this->campaign->forceFill(['active_scene_id' => $this->scene->id])->save();
        $prop = SceneProp::create(['scene_id' => $this->scene->id, 'name' => 'Chest', 'x' => 100, 'y' => 100]);
        $this->loot = LootContainer::create(['scene_id' => $this->scene->id, 'prop_id' => $prop->id, 'name' => 'Chest', 'created_by' => $this->gm->id]);
        $this->template = (new LibraryItem)->forceFill(['user_id' => $this->gm->id, 'definition' => ['name' => 'Secret reward', 'icon' => 'item_potion', 'description' => '', 'category' => 'other', 'rarity' => 'common', 'width' => 1, 'height' => 1, 'max_stack' => 20, 'equipment_slots' => [], 'modifiers' => [], 'use_ability_id' => null]]);
        $this->template->save();
        $this->hero = $this->campaign->characters()->create(['name' => 'Hero', 'owner_user_id' => $this->player->id, 'kind' => 'player_character', 'hp' => 10, 'max_hp' => 10]);
        $this->actingAs($this->gm);
    }

    private function command(array $data, ?User $user = null)
    {
        return $this->actingAs($user ?? $this->gm)->postJson('/api/campaigns/'.$this->campaign->id.'/loot', $data + ['clientMutationId' => (string) Str::uuid(), 'containerId' => $this->loot->id]);
    }

    private function give(int $quantity = 3): array
    {
        return $this->command(['action' => 'give', 'libraryItemId' => $this->template->id, 'quantity' => $quantity, 'expectedVersion' => $this->loot->fresh()->version])->assertOk()->json();
    }

    private function history(array $change, ?User $user = null, $scene = null)
    {
        return $this->actingAs($user ?? $this->gm)->postJson('/api/scenes/'.($scene ?? $this->scene)->id.'/edit-history', ['changes' => [$change], 'clientMutationId' => (string) Str::uuid()]);
    }

    public function test_library_snapshots_quantity_replacement_and_retry_are_independent_and_atomic(): void
    {
        $original = $this->template->definition;
        $given = $this->give();
        $item = $given['loot']['items'][0];
        $this->assertNotSame($this->template->id, $item['definition']['id']);
        $this->assertEquals($this->campaign->id, ItemDefinition::findOrFail($item['definition']['id'])->campaign_id);
        $change = ['action' => 'quantity', 'itemId' => $item['id'], 'quantity' => 5, 'expectedVersion' => 1, 'clientMutationId' => (string) Str::uuid()];
        $first = $this->command($change)->assertOk()->json();
        $this->command($change)->assertOk()->assertJsonPath('loot.version', $first['loot']['version']);
        $this->assertSame(5, $this->loot->items()->sum('quantity'));
        $this->command(['action' => 'quantity', 'itemId' => $item['id'], 'quantity' => 21, 'expectedVersion' => 2])->assertUnprocessable();
        $next = $this->template->replicate();
        $next->definition = array_replace($original, ['name' => 'Sword', 'max_stack' => 1]);
        $next->save();
        $this->command(['action' => 'replace', 'itemId' => $item['id'], 'libraryItemId' => $next->id, 'quantity' => 5, 'expectedVersion' => 2])->assertOk()->assertJsonCount(5, 'loot.items');
        $this->assertSame($original, $this->template->fresh()->definition);
        $this->template->update(['definition' => array_replace($original, ['name' => 'Changed template'])]);
        $this->assertSame('Secret reward', ItemDefinition::findOrFail($item['definition']['id'])->name);
    }

    public function test_player_permissions_stale_edits_and_duplicate_pickup_preserve_transferred_items(): void
    {
        $item = $this->give()['loot']['items'][0];
        foreach (['give', 'quantity', 'replace', 'remove'] as $op) {
            $this->command(['action' => $op, 'libraryItemId' => $this->template->id, 'itemId' => $item['id'], 'quantity' => 1, 'expectedVersion' => 1], $this->player)->assertForbidden();
        }
        $this->command(['action' => 'open'], $this->player)->assertOk();
        $take = ['action' => 'take', 'itemId' => $item['id'], 'quantity' => 3, 'characterId' => $this->hero->id];
        $this->command($take, $this->player)->assertOk();
        $this->command($take, $this->player)->assertConflict();
        $this->command(['action' => 'quantity', 'itemId' => $item['id'], 'quantity' => 9, 'expectedVersion' => 1])->assertConflict();
        $this->assertSame(3, $this->hero->inventory()->sum('quantity'));
        $this->assertSame(0, $this->loot->items()->sum('quantity'));
        $this->getJson('/api/campaigns/'.$this->campaign->id.'/loot?containerId='.$this->loot->id)->assertOk()->assertJsonCount(0, 'loot.items');
    }

    public function test_history_restores_exact_instances_but_cannot_resurrect_pickup_or_accept_forged_snapshots(): void
    {
        $given = $this->give();
        $edit = $given['preparationEdit'];
        $id = $given['loot']['items'][0]['id'];
        $this->history($edit, $this->player)->assertForbidden();
        $this->history($edit)->assertOk();
        $this->assertSame(0, $this->loot->items()->sum('quantity'));
        $redo = array_replace($edit, ['expected' => $edit['value'], 'value' => $edit['expected']]);
        $this->history($redo)->assertOk();
        $this->assertSame($id, $this->loot->items()->where('quantity', '>', 0)->firstOrFail()->id);
        $foreignScene = $this->campaign->scenes()->create(['name' => 'Other']);
        $this->history($edit, null, $foreignScene)->assertNotFound();
        $forged = $edit;
        $forged['value']['snapshot'] .= 'corrupt';
        $this->history($forged)->assertUnprocessable();
        $this->command(['action' => 'open'], $this->player)->assertOk();
        $this->command(['action' => 'take-all', 'characterId' => $this->hero->id], $this->player)->assertOk();
        $this->history($edit)->assertConflict();
        $this->assertSame(3, $this->hero->inventory()->sum('quantity'));
    }

    public function test_foreign_templates_and_definitions_reject_without_removing_the_replaced_item(): void
    {
        $given = $this->give();
        $other = $this->template->replicate();
        $other->user_id = $this->player->id;
        $other->save();
        $this->command(['action' => 'replace', 'libraryItemId' => $other->id, 'itemId' => $given['loot']['items'][0]['id'], 'quantity' => 1, 'expectedVersion' => 1])->assertNotFound();
        $this->command(['action' => 'give', 'quantity' => 1])->assertUnprocessable();
        $this->assertSame(3, $this->loot->items()->sum('quantity'));
        $this->assertSame(1, $this->loot->fresh()->version);
    }

    public function test_closed_contents_and_history_stay_out_of_player_snapshots_and_realtime(): void
    {
        $this->give();
        $this->actingAs($this->player)->getJson('/api/campaigns/'.$this->campaign->id.'/loot?containerId='.$this->loot->id)->assertOk()->assertJsonCount(0, 'loot.items');
        $snapshot = $this->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk()->json();
        $this->assertStringNotContainsString('Secret reward', json_encode($snapshot));
        Event::assertDispatched(TabletopEvent::class, function ($event) {
            $this->assertStringNotContainsString('preparationEdit', json_encode($event->broadcastWith()));
            $this->assertStringNotContainsString('Secret reward', json_encode($event->broadcastWith()));

            return true;
        });
    }
}
