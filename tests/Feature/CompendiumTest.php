<?php

namespace Tests\Feature;

use App\Compendium\CompendiumSync;
use App\Compendium\CopyCompendiumEntry;
use App\Compendium\SrdApi;
use App\Compendium\SrdSpellMapper;
use App\Models\Campaign;
use App\Models\CompendiumCopy;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use App\Models\ItemDefinition;
use App\Models\User;
use App\Services\CharacterGameplay;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Tests\TestCase;

class CompendiumTest extends TestCase
{
    use DatabaseMigrations;

    private function raw(string $path): array
    {
        return json_decode(file_get_contents(base_path('tests/Fixtures/compendium/'.str_replace('/', '-', $path).'.json')), true, 512, JSON_THROW_ON_ERROR);
    }

    private function records(): array
    {
        return array_map(fn ($p) => ['endpoint' => explode('/', $p)[0], 'data' => $this->raw($p)], [
            'spells/fireball', 'spells/fire-bolt', 'spells/burning-hands', 'equipment/longsword', 'equipment/shield',
            'equipment/chain-mail', 'equipment/leather-armor', 'monsters/goblin-warrior', 'conditions/poisoned', 'skills/perception', 'weapon-properties/versatile',
        ]);
    }

    private function import(?array $records = null, bool $dry = false, bool $force = false): array
    {
        return app(CompendiumSync::class)->import(CompendiumSource::firstOrFail(), $records ?? $this->records(), CompendiumSync::TYPES, $dry, $force);
    }

    private function entry(string $key): CompendiumEntry
    {
        return CompendiumEntry::where('external_key', $key)->firstOrFail();
    }

    private function campaign(): array
    {
        $gm = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Compendium']);
        $campaign->members()->attach($gm, ['role' => 'gm']);

        return [$gm, $campaign, '/api/campaigns/'.$campaign->id.'/compendium'];
    }

    public function test_sync_is_idempotent_tracks_versions_and_updates_changed_raw_without_duplicate_records(): void
    {
        $this->import();
        $this->assertDatabaseCount('compendium_entries', 11);
        $source = CompendiumSource::firstOrFail();
        $this->assertSame('5.2.1', $source->version);
        $this->assertSame('CC-BY-4.0', $source->license);
        $this->assertStringContainsString('Wizards of the Coast LLC', $source->metadata['attribution']);
        $this->assertCount(8, $source->type_synced_at);
        $this->assertNotNull($source->last_synced_at);
        $entry = $this->entry('fireball');
        $this->assertEquals($this->raw('spells/fireball'), $entry->raw_data);
        $importedAt = $entry->imported_at->toISOString();
        $this->travel(1)->hours();
        $counts = $this->import();
        $this->assertSame(3, $counts['spells']['unchanged']);
        $this->assertSame($importedAt, $entry->fresh()->imported_at->toISOString());
        $changed = $this->records();
        $changed[0]['data']['damage']['damage_at_slot_level']['3'] = '9d6';
        $changed[0]['data']['new_upstream_field'] = ['preserved' => true];
        $this->import($changed);
        $this->assertDatabaseCount('compendium_entries', 11);
        $fresh = $entry->fresh();
        $this->assertSame($entry->id, $fresh->id);
        $this->assertNotSame($entry->checksum, $fresh->checksum);
        $this->assertSame('9d6', $fresh->normalized_data['damage']['expression']);
        $this->assertTrue($fresh->raw_data['new_upstream_field']['preserved']);
        $this->assertSame(3, $this->import(null, true)['spells']['updated'] + $this->import(null, true)['spells']['unchanged']);
    }

    public function test_normalized_spell_equipment_monster_condition_and_skill_semantics(): void
    {
        $this->import();
        $n = $this->entry('fireball')->normalized_data;
        $this->assertSame(3, $n['spell_level']);
        $this->assertSame('evocation', $n['school']);
        $this->assertEquals(150, $n['range']['distance']);
        $this->assertSame('sphere', $n['area']['shape']);
        $this->assertEquals(20, $n['area']['size']);
        $this->assertSame('dex', $n['saving_throw']['ability']);
        $this->assertSame('half', $n['saving_throw']['on_success']);
        $this->assertSame('8d6', $n['damage']['expression']);
        $this->assertFalse($n['concentration']);
        $this->assertSame('Action', $n['casting_time']);
        $weapon = $this->entry('longsword');
        $this->assertSame('weapons', $weapon->entity_type);
        $this->assertSame(['versatile'], $weapon->normalized_data['weapon_properties']);
        $this->assertSame('sap', $weapon->normalized_data['weapon_mastery']);
        $this->assertSame('slashing', $weapon->normalized_data['damage']['damage_type']);
        $shield = $this->entry('shield')->normalized_data['armor'];
        $this->assertSame('bonus', $shield['ac_semantics']);
        $this->assertSame(2, $shield['ac_bonus']);
        $this->assertNull($shield['base_ac']);
        $chain = $this->entry('chain-mail')->normalized_data['armor'];
        $this->assertSame('heavy_armor', $chain['category']);
        $this->assertSame(16, $chain['base_ac']);
        $this->assertFalse($chain['add_dex']);
        $monster = $this->entry('goblin-warrior')->normalized_data;
        $this->assertSame('fey', $monster['creature_type']);
        $this->assertSame(15, $monster['ability_scores']['dex']);
        $this->assertSame(6, $monster['skills']['stealth']);
        $this->assertEquals(30, $monster['speed']['walk']['feet']);
        $this->assertCount(2, $monster['actions']);
        $this->assertSame('poisoned', $this->entry('poisoned')->normalized_data['key']);
        $this->assertSame('wis', $this->entry('perception')->normalized_data['ability']);
    }

    public function test_copy_flows_are_editable_offline_and_resync_never_updates_campaign_content_or_provenance(): void
    {
        $this->import();
        $damageRecords = array_values(array_filter(json_decode(file_get_contents(base_path('tests/Fixtures/compendium/character-catalog.json')), true), fn ($r) => $r['endpoint'] === 'damage-types'));
        app(CompendiumSync::class)->import(CompendiumSource::firstOrFail(), $damageRecords, ['rules']);

        [$gm, $campaign, $base] = $this->campaign();
        $hero = $campaign->characters()->create(['name' => 'Hero']);
        Http::preventStrayRequests();
        $this->actingAs($gm);
        $command = ['entry_id' => $this->entry('fireball')->id, 'character_id' => $hero->id, 'clientMutationId' => (string) Str::uuid()];
        $spell = $this->postJson($base.'/copy', $command)->assertOk()->assertJsonPath('copy.source_reference.version', '5.2.1')->json('ability');
        $this->postJson($base.'/copy', $command)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertCount(1, $hero->fresh()->abilities);
        $this->assertTrue($spell['enabled']);
        $this->assertSame('PARTIAL', $spell['spell']['coverage']);
        $this->assertSame('effect', $spell['category']);
        $this->assertSame('circle', $spell['area']['shape']);
        $this->assertSame('8d6', $spell['damage_components'][0]['dice']);
        $item = $this->postJson($base.'/copy', ['entry_id' => $this->entry('longsword')->id, 'clientMutationId' => (string) Str::uuid()])->assertOk()->json('definition');
        $npc = $this->postJson($base.'/copy', ['entry_id' => $this->entry('goblin-warrior')->id, 'clientMutationId' => (string) Str::uuid()])->assertOk()->json('character');
        $this->assertSame('npc', $npc['kind']);
        $this->assertSame(15, (int) $npc['ac']);
        $this->assertSame(10, $npc['hp']);
        $spell['name'] = 'Custom Fireball';
        $this->postJson('/api/campaigns/'.$campaign->id.'/characters', ['id' => $hero->id, 'name' => 'Hero', 'rules' => null, 'abilities' => [$spell], 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $item['name'] = 'Custom sword';
        $this->postJson('/api/campaigns/'.$campaign->id.'/items', $item + ['clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->postJson('/api/campaigns/'.$campaign->id.'/characters', ['id' => $npc['id'], 'name' => 'Custom goblin', 'rules' => null, 'hp' => 7, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $snapshots = CompendiumCopy::orderBy('id')->get()->toArray();
        $changed = $this->records();
        foreach ($changed as &$record) {
            $record['data']['name'] = 'Upstream changed';
        }
        unset($record);
        $this->import($changed);
        $this->assertSame('Custom Fireball', $hero->fresh()->abilities[0]['name']);
        $this->assertSame('Custom sword', ItemDefinition::findOrFail($item['id'])->name);
        $this->assertSame('Custom goblin', $campaign->characters()->findOrFail($npc['id'])->name);
        $this->assertSame(7, $campaign->characters()->findOrFail($npc['id'])->hp);
        $this->assertEquals($snapshots, CompendiumCopy::orderBy('id')->get()->toArray());
        $this->getJson($base.'?search=Upstream&type=spells')->assertOk()->assertJsonPath('total', 3);
        $this->getJson($base.'/'.$command['entry_id'])->assertOk()->assertJsonPath('copies.0.snapshot.normalized_data.name', 'Fireball');
        Http::assertNothingSent();
    }

    public function test_gm_only_browse_copy_scope_and_replay_after_role_revocation(): void
    {
        $this->import();
        [$gm, $campaign, $base] = $this->campaign();
        $player = User::factory()->create();
        $campaign->members()->attach($player, ['role' => 'player']);
        $other = Campaign::create(['name' => 'Other']);
        $foreign = $other->characters()->create(['name' => 'Foreign']);
        $command = ['entry_id' => $this->entry('fireball')->id, 'character_id' => $foreign->id, 'clientMutationId' => (string) Str::uuid()];
        $this->actingAs($gm)->postJson($base.'/copy', $command)->assertNotFound();
        $this->actingAs($player)->getJson($base)->assertForbidden();
        $this->getJson($base.'/'.$command['entry_id'])->assertForbidden();
        $this->postJson($base.'/copy', $command)->assertForbidden();
        $this->actingAs(User::factory()->create())->getJson($base)->assertForbidden();
        $itemCommand = ['entry_id' => $this->entry('shield')->id, 'clientMutationId' => (string) Str::uuid()];
        $this->actingAs($gm)->postJson($base.'/copy', $itemCommand)->assertOk();
        $campaign->members()->updateExistingPivot($gm, ['role' => 'player']);
        $this->postJson($base.'/copy', $itemCommand)->assertForbidden();
        $this->assertDatabaseCount('compendium_copies', 1);
    }

    public function test_cli_uses_api_only_for_import_and_dry_run_force_and_type_filters_are_explicit(): void
    {
        $raw = $this->raw('spells/fireball');
        Http::preventStrayRequests();
        Http::fake([
            SrdApi::BASE.'/spells' => Http::response(['count' => 1, 'results' => [['index' => 'fireball', 'name' => 'Fireball', 'url' => '/api/2024/spells/fireball']]]),
            SrdApi::BASE.'/spells/fireball' => Http::response($raw),
        ]);
        $this->artisan('compendium:sync', ['--type' => ['spells'], '--dry-run' => true])->assertExitCode(0);
        $this->assertDatabaseCount('compendium_entries', 0);
        $this->assertNull(CompendiumSource::firstOrFail()->type_synced_at);
        $this->artisan('compendium:sync', ['--type' => ['spells']])->assertExitCode(0);
        $this->artisan('compendium:sync', ['--type' => ['spells']])->assertExitCode(0);
        $this->assertDatabaseCount('compendium_entries', 1);
        $this->assertNull(CompendiumSource::firstOrFail()->last_synced_at);
        $this->assertArrayHasKey('spells', CompendiumSource::firstOrFail()->type_synced_at);
        $before = $this->entry('fireball')->imported_at;
        $this->travel(2)->hours();
        $this->artisan('compendium:sync', ['--type' => ['spells'], '--force' => true])->assertExitCode(0);
        $this->assertTrue($this->entry('fireball')->imported_at->greaterThan($before));
        $this->artisan('compendium:sync', ['--type' => ['no-such-type']])->assertExitCode(1);
    }

    public function test_failed_remote_sync_is_atomic_and_never_marks_a_source_complete(): void
    {
        Http::fake([SrdApi::BASE.'/spells' => Http::response(['count' => 1, 'results' => [['index' => 'fireball', 'name' => 'Fireball', 'url' => '/api/2024/spells/fireball']]]),
            SrdApi::BASE.'/spells/fireball' => Http::response(['message' => 'Unavailable'], 503)]);
        $this->artisan('compendium:sync', ['--type' => ['spells']])->assertExitCode(1);
        $this->assertDatabaseCount('compendium_entries', 0);
        $this->assertNull(CompendiumSource::firstOrFail()->last_synced_at);
    }

    public function test_equipment_alias_has_one_record_per_remote_identity_and_search_escapes_wildcards(): void
    {
        $sync = app(CompendiumSync::class);
        $types = $sync->types(['equipment']);
        $this->assertSame(['items', 'weapons', 'armor'], $types);
        $this->assertSame(['equipment'], $sync->endpoints($types));
        $sync->import(CompendiumSource::firstOrFail(), $this->records(), $types);
        $this->assertDatabaseCount('compendium_entries', 4);
        [$gm, , $base] = $this->campaign();
        $this->actingAs($gm)->getJson($base.'?search=sword&type=weapons')->assertOk()->assertJsonPath('total', 1)->assertJsonMissingPath('entries.0.raw_data');
        $this->getJson($base.'?search=%25')->assertOk()->assertJsonPath('total', 0);
        $this->getJson($base.'?type=bad')->assertUnprocessable();
    }

    public function test_all_fixture_spells_map_into_existing_ability_contract_without_executing_rules(): void
    {
        $this->import();
        $damageRecords = array_values(array_filter(json_decode(file_get_contents(base_path('tests/Fixtures/compendium/character-catalog.json')), true), fn ($r) => $r['endpoint'] === 'damage-types'));
        app(CompendiumSync::class)->import(CompendiumSource::firstOrFail(), $damageRecords, ['rules']);
        [, $campaign] = $this->campaign();
        $hero = $campaign->characters()->create(['name' => 'Hero']);
        foreach (CompendiumEntry::where('entity_type', 'spells')->get() as $entry) {
            $ability = app(CopyCompendiumEntry::class)->spell($entry->normalized_data, 0);
            $data = ['abilities' => [$ability]];
            $this->assertFalse(Validator::make($data, CharacterGameplay::rules())->fails(), $entry->name);
            app(CharacterGameplay::class)->validate($campaign, $data, $hero);
            $this->assertTrue($ability['enabled']);
            $this->assertFalse($ability['spell']['prepared']);
            $this->assertSame([], $ability['costs']);
        }
    }

    public function test_touch_spell_secondary_cone_is_preserved_in_metadata_without_becoming_casting_geometry(): void
    {
        $raw = $this->raw('spells/dragons-breath');
        $normalized = ['name' => $raw['name']] + app(SrdSpellMapper::class)->map($raw);
        $ability = app(CopyCompendiumEntry::class)->spell($normalized, 0);
        $this->assertSame('cone', $normalized['area']['shape']);
        $this->assertSame('touch', $normalized['range']['kind']);
        $this->assertNull($ability['area']);
        $this->assertNull($ability['damage']);
        $this->assertTrue($ability['enabled']);
        $this->assertFalse($ability['spell']['prepared']);
        $this->assertFalse(Validator::make(['abilities' => [$ability]], CharacterGameplay::rules())->fails());
    }

    public function test_equipment_reclassification_retains_identity_and_creates_no_duplicate_remote_record(): void
    {
        $raw = $this->raw('equipment/longsword');
        $this->import([['endpoint' => 'equipment', 'data' => $raw]]);
        $entry = $this->entry('longsword');
        unset($raw['equipment_categories']);
        $this->import([['endpoint' => 'equipment', 'data' => $raw]]);
        $this->assertDatabaseCount('compendium_entries', 1);
        $this->assertSame('items', $entry->fresh()->entity_type);
    }
}
