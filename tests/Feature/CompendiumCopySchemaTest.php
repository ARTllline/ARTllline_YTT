<?php

namespace Tests\Feature;

use App\Compendium\CompendiumSync;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use App\Models\User;
use App\Services\CharacterRules;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\Support\SeedsCharacterCatalog;
use Tests\TestCase;

class CompendiumCopySchemaTest extends TestCase
{
    use RefreshDatabase, SeedsCharacterCatalog;

    public function test_legacy_schema_rejects_copy_atomically_and_additive_migration_enables_private_idempotent_copies(): void
    {
        $this->assertSame(':memory:', DB::connection()->getDatabaseName());
        $this->seedCharacterCatalog();
        Event::fake();
        $gm = User::factory()->create();
        $player = User::factory()->create();
        $source = CompendiumSource::where('key', 'srd-2024')->firstOrFail();
        app(CompendiumSync::class)->import($source, [
            ['endpoint' => 'equipment', 'data' => json_decode(file_get_contents(base_path('tests/Fixtures/compendium/equipment-shield.json')), true)],
        ], ['armor']);
        $entry = CompendiumEntry::where('external_key', 'shield')->firstOrFail();
        $original = $entry->toArray();
        $migration = require database_path('migrations/2026_11_12_170000_add_compendium_copy_contracts.php');
        $migration->down();
        $campaign = Campaign::create(['name' => 'Isolated schema fixture']);
        $legacyId = DB::table('compendium_copies')->insertGetId([
            'campaign_id' => $campaign->id, 'compendium_entry_id' => $entry->id,
            'target_type' => 'item', 'target_key' => (string) Str::uuid(),
            'source_checksum' => $entry->checksum, 'source_reference' => '{}',
            'snapshot' => json_encode(['raw_data' => $entry->raw_data]), 'created_at' => now(),
        ]);
        $legacy = (array) DB::table('compendium_copies')->find($legacyId);
        $payload = ['entryId' => $entry->id, 'clientMutationId' => (string) Str::uuid()];
        $this->actingAs($gm)->postJson('/api/library/items/compendium', $payload)->assertStatus(503);
        $this->assertDatabaseCount('library_items', 0);
        $this->assertDatabaseCount('compendium_copies', 1);
        $this->assertDatabaseMissing('scene_mutation_receipts', ['client_mutation_id' => $payload['clientMutationId']]);

        $migration->up();
        $this->assertTrue(Schema::hasColumn('item_definitions', 'content'));
        $this->assertSame($legacy + ['owner_user_id' => null], (array) DB::table('compendium_copies')->find($legacyId));
        $copy = $this->postJson('/api/library/items/compendium', $payload)->assertOk()->json('definition');
        $this->postJson('/api/library/items/compendium', $payload)->assertOk()->assertHeader('Idempotent-Replay', 'true')->assertJsonPath('definition.id', $copy['id']);
        $this->assertDatabaseCount('library_items', 1);
        $this->assertDatabaseCount('compendium_copies', 2);
        $receipt = DB::table('compendium_copies')->where('target_type', 'library_item')->first();
        $this->assertNull($receipt->campaign_id);
        $this->assertEquals($gm->id, $receipt->owner_user_id);
        $snapshot = $receipt->snapshot;
        $edited = array_replace($copy, ['name' => 'My shield', 'clientMutationId' => (string) Str::uuid()]);
        $this->postJson('/api/library/items', $edited)->assertOk();
        $this->getJson('/api/library/items')->assertOk()->assertJsonPath('definitions.0.name', 'My shield');
        $this->assertSame($original, $entry->fresh()->toArray());
        $this->assertSame($snapshot, DB::table('compendium_copies')->find($receipt->id)->snapshot);

        $hero = Character::forceCreate(['library_user_id' => $gm->id, 'name' => 'Schema hero', 'kind' => 'player_character',
            'hp' => 10, 'max_hp' => 10, 'ac' => 10, 'speed' => 30, 'rules' => app(CharacterRules::class)->defaults(), 'abilities' => [], 'resources' => []]);
        $grant = ['action' => 'give', 'libraryItemId' => $copy['id'], 'quantity' => 1, 'slot' => 'off_hand', 'clientMutationId' => (string) Str::uuid()];
        $given = $this->postJson('/api/library/characters/'.$hero->id.'/inventory', $grant)->assertOk()->assertJsonPath('character.ac', 12);
        $this->postJson('/api/library/characters/'.$hero->id.'/inventory', $grant)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertDatabaseCount('inventory_items', 1);
        $item = $given->json('items.0');
        $this->postJson('/api/library/items', array_replace($edited, ['name' => 'Changed template', 'clientMutationId' => (string) Str::uuid()]))->assertOk();
        $this->getJson('/api/library/characters/'.$hero->id.'/inventory')->assertOk()->assertJsonPath('items.0.definition.name', 'My shield')->assertJsonPath('character.ac', 12);
        $this->postJson('/api/library/characters/'.$hero->id.'/inventory', ['action' => 'unequip', 'itemId' => $item['id'], 'clientMutationId' => (string) Str::uuid()])->assertOk()->assertJsonPath('character.ac', 10);

        $this->actingAs($player)->getJson('/api/library/items')->assertOk()->assertJsonCount(0, 'definitions');
        $this->postJson('/api/library/items', $edited + ['unused' => true])->assertNotFound();
        $this->postJson('/api/library/characters/'.$hero->id.'/inventory', $grant)->assertNotFound();
        // The same mutation UUID in another owner's scope creates their own copy.
        $other = $this->postJson('/api/library/items/compendium', $payload)->assertOk()->json('definition');
        $this->assertNotSame($copy['id'], $other['id']);
        $this->assertSame($original, $entry->fresh()->toArray());
    }
}
