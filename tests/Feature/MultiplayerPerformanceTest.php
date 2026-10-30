<?php

namespace Tests\Feature;

use App\Actions\CharacterActions;
use App\Models\Campaign;
use App\Models\InventoryItem;
use App\Models\ItemDefinition;
use App\Models\User;
use App\Services\CharacterRules;
use App\Spells\SpellEffects;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Tests\Support\SeedsCharacterCatalog;
use Tests\TestCase;

class MultiplayerPerformanceTest extends TestCase
{
    use DatabaseMigrations, SeedsCharacterCatalog;

    public function test_projection_reads_expire_after_success_and_exception(): void
    {
        $reads = app(SpellEffects::class);
        $value = 1;
        $load = fn () => $value;
        $this->assertSame(1, $reads->project(fn () => $reads->read('value', $load)));
        $value = 2;
        $this->assertSame(2, $reads->project(fn () => $reads->read('value', fn () => $value)));
        try {
            $reads->project(function () use ($reads) {
                $reads->read('value', fn () => 7);
                throw new \RuntimeException('test');
            });
        } catch (\RuntimeException) {
        }
        $this->assertSame(3, $reads->read('value', fn () => 3));
        $this->assertNull($reads->project(fn () => $reads->read('absent', fn () => null)));
    }

    public function test_roster_reuses_effect_reads_only_for_one_projection(): void
    {
        $this->seedCharacterCatalog();
        $gm = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Performance']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        foreach (range(1, 4) as $i) {
            $campaign->characters()->create(['name' => 'Hero '.$i, 'hp' => 10, 'max_hp' => 20, 'speed' => 30, 'rules' => app(CharacterRules::class)->defaults()]);
        }
        $queries = [];
        DB::listen(function ($event) use (&$queries) {
            $queries[] = $event->sql;
        });
        $service = app(CharacterActions::class);
        $roster = $service->roster($campaign, $gm);
        $this->assertCount(4, $roster['characters']);
        $this->assertCount(1, array_filter($queries, fn ($sql) => str_contains($sql, 'from "spell_effects"')));
        $this->assertCount(1, array_filter($queries, fn ($sql) => str_contains($sql, 'from "inventory_items"')));
        $campaign->characters()->whereKey($roster['characters'][0]['id'])->update(['hp' => 3]);
        $queries = [];
        $next = $service->roster($campaign, $gm);
        $this->assertSame(3, $next['characters'][0]['hp']);
        $this->assertCount(1, array_filter($queries, fn ($sql) => str_contains($sql, 'from "spell_effects"')));
    }

    public function test_inventory_identity_tracks_items_and_definitions_without_hp_invalidation(): void
    {
        $campaign = Campaign::create(['name' => 'Inventory']);
        $hero = $campaign->characters()->create(['name' => 'Hero', 'hp' => 10, 'max_hp' => 20]);
        $definition = new ItemDefinition(['name' => 'Potion', 'category' => 'consumable', 'icon' => 'potion', 'rarity' => 'common', 'width' => 1, 'height' => 1, 'equipment_slots' => [], 'modifiers' => []]);
        $definition->campaign_id = $campaign->id;
        $definition->save();
        $item = InventoryItem::create(['character_id' => $hero->id, 'item_definition_id' => $definition->id, 'quantity' => 2, 'x' => 0, 'y' => 0]);
        $identity = fn () => app(CharacterActions::class)->projection($hero->fresh(), false)['inventoryRevision'];
        $before = $identity();
        $hero->update(['hp' => 9]);
        $this->assertSame($before, $identity());
        $item->update(['quantity' => 1]);
        $quantity = $identity();
        $this->assertNotSame($before, $quantity);
        $definition->update(['name' => 'Renamed potion']);
        $this->assertNotSame($quantity, $identity());
        $ability = ['id' => 'item', 'name' => 'Item action', 'enabled' => true, 'sort_order' => 0, 'item_only' => true, 'check' => ['stat_key' => 'wis', 'dc' => 12]];
        $hero->update(['abilities' => [$ability]]);
        $public = $identity();
        $ability['check']['dc'] = 19;
        $hero->update(['abilities' => [$ability]]);
        $this->assertSame($public, $identity(), 'An inventory identity must not fingerprint a secret DC.');
        $ability['name'] = 'Updated item action';
        $hero->update(['abilities' => [$ability]]);
        $this->assertNotSame($public, $identity());
    }

    public function test_production_and_unrequested_responses_do_not_expose_diagnostics(): void
    {
        $this->get('/up')->assertOk()->assertHeaderMissing('Server-Timing')->assertHeaderMissing('X-YTT-Request-ID');
        $this->app['env'] = 'production';
        $this->withHeaders(['X-YTT-Perf' => '1'])->get('/up')->assertOk()->assertHeaderMissing('Server-Timing')->assertHeaderMissing('X-YTT-Request-ID');
        $this->app['env'] = 'testing';
    }
}
