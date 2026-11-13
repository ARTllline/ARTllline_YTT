<?php

namespace Tests\Feature;

use App\Compendium\CompendiumContent;
use App\Compendium\CompendiumSync;
use App\Compendium\Unified\UnifiedCatalogPlan;
use App\Compendium\Unified\UnifiedPackage;
use App\Compendium\Unified\UnifiedReview;
use App\Compendium\Unified\UnifiedSrdAdapter;
use App\Events\TabletopEvent;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\CompendiumCopy;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use App\Models\ItemDefinition;
use App\Models\User;
use App\Services\CharacterRules;
use App\Services\D20Roller;
use App\Spells\SpellAudit;
use App\Spells\SpellCasting;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Support\SeedsCharacterCatalog;
use Tests\Support\UnifiedCompendiumTestCase;

class CompendiumConsumersTest extends UnifiedCompendiumTestCase
{
    use SeedsCharacterCatalog;

    private User $gm;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCharacterCatalog();
        Event::fake([TabletopEvent::class]);
        $this->gm = User::factory()->create();
        $this->actingAs($this->gm);
        $rows = json_decode(file_get_contents(base_path('tests/Fixtures/content/srd-2024-consumers.json')), true, 128, JSON_THROW_ON_ERROR)['records'];
        $this->details = [];
        $this->manifest['selection'] = [];
        foreach ($rows as $row) {
            $id = $row['id'];
            $kind = $row['kind'];
            $raw = $row['raw'];
            $key = $raw['index'];
            $detail = ['record' => ['edition' => '2024', 'stable_version_id' => $kind.':'.$key.':2024',
                'name_en' => $row['en'], 'name_ru' => $row['ru'], 'description_en' => $row['description_en'], 'description_ru' => $row['description_ru'],
                'source' => ['index' => $key, 'commit' => $this->manifest['export']['srd_commit'], 'rules_reference' => 'SRD 5.2/5.2.1; synthetic fixture', 'url' => 'https://www.dnd5eapi.co'.$raw['url']],
                'raw' => $raw, 'icon' => null, 'import_review' => ['approved' => false, 'automation_allowed' => false],
                'localization' => ['human_verified' => false], 'rules_audit' => ['full_semantic_review' => false]],
                'group' => ['id' => $kind.':'.$key], 'assets' => []];
            $selection = ['id' => $id, 'kind' => $kind, 'entity_type' => $row['entity_type'], 'external_key' => $row['external_key'], 'checksum' => ''];
            if ($row['correction']) {
                $selection['correction'] = $row['correction'];
                $selection['content_checksum'] = UnifiedSrdAdapter::checksum($detail + ['ytt_correction' => $row['correction']]);
            }
            $this->details[$id] = $detail;
            $this->manifest['selection'][] = $selection;
        }
        $this->writePackage();
    }

    private function entry(string $key, bool $reviewed = true, bool $execute = false, bool $copy = true): CompendiumEntry
    {
        $package = app(UnifiedPackage::class)->read($this->root, $this->root.'/manifest.json');
        $input = collect($package['records'])->first(fn ($r) => $r['selection']['id'] === $key || $r['selection']['external_key'] === $key);
        $adapter = app(UnifiedSrdAdapter::class);
        $data = $adapter->prepare($input, $this->manifest, $this->root);
        $manifest = $this->manifest;
        if ($reviewed) {
            $manifest['reviews'] = [['id' => $input['selection']['id'], 'checksum' => $data['checksum'], 'projection_checksum' => $data['projection_checksum'],
                'confirmed' => true, 'confirmed_at' => '2026-11-12T12:00:00+00:00', 'reviewer' => 'Synthetic fixture reviewer ONLY', 'evidence' => 'Isolated SQLite consumer test; not a B/C approval',
                'languages' => ['en', 'ru'], 'browse' => true, 'copy' => $copy, 'execute' => $execute, 'execution_checksum' => $data['normalized_data']['content']['execution']['checksum']]];
            $data = $adapter->prepare($input, $manifest, $this->root);
        }
        $fields = array_intersect_key($data, array_flip(UnifiedCatalogPlan::FIELDS));
        $fields['normalized_data']['content']['import_receipt'] = ['writer' => 'unified-srd-2024', 'digest' => UnifiedReview::digest($fields), 'slug' => Str::slug($data['name'])];

        return CompendiumEntry::create($fields + ['slug' => Str::slug($data['name']), 'source_id' => CompendiumSource::where('key', 'srd-2024')->value('id'), 'imported_at' => now()]);
    }

    private function hero(string $kind = 'player_character'): Character
    {
        return Character::forceCreate(['library_user_id' => $this->gm->id, 'name' => 'Consumer fixture', 'kind' => $kind,
            'ac' => 10, 'hp' => 1, 'max_hp' => 40, 'rules' => app(CharacterRules::class)->defaults(), 'abilities' => [], 'resources' => []]);
    }

    protected function tearDown(): void
    {
        // Explicitly disposable data only, so protective migration down() methods
        // never need to destroy campaign-less user data to satisfy NOT NULL.
        if (isset($this->gm)) {
            $this->assertSame('sqlite', DB::connection()->getDriverName());
            $this->assertSame(':memory:', DB::connection()->getDatabaseName());
            DB::table('compendium_copies')->whereNull('campaign_id')->orWhere('owner_user_id', $this->gm->id)->delete();
            DB::table('scene_mutation_receipts')->whereNull('campaign_id')->delete();
            Character::whereNull('campaign_id')->delete();
            DB::table('inventory_items')->whereIn('item_definition_id', ItemDefinition::whereNotNull('content')->pluck('id'))->delete();
            ItemDefinition::whereNotNull('content')->delete();
            ItemDefinition::whereNull('campaign_id')->delete();
        }
        parent::tearDown();
    }

    private function libraryCopy(CompendiumEntry $entry): array
    {
        return $this->postJson('/api/library/items/compendium', ['entryId' => $entry->id, 'clientMutationId' => (string) Str::uuid()])->assertOk()->json('definition');
    }

    public function test_all_reference_rarities_survive_library_copy_edit_and_reload_without_execution(): void
    {
        foreach (['Very Rare' => 'very_rare', 'Very Rare (+3)' => 'very_rare', 'Rarity Varies' => 'varies',
            'Uncommon (+1), Rare (+2), or Very Rare (+3)' => 'varies', 'Artifact' => 'artifact', 'Mystery' => 'unknown'] as $source => $expected) {
            $id = 'srd:magic_item:bag-of-holding:2024';
            $this->details[$id]['record']['raw']['rarity'] = ['name' => $source];
            foreach ($this->manifest['selection'] as &$selected) {
                if ($selected['id'] === $id) {
                    unset($selected['correction'], $selected['content_checksum']);
                }
            }
            unset($selected);
            $this->writePackage();
            $entry = $this->entry($id);
            $copy = $this->libraryCopy($entry);
            $this->assertSame($expected, $copy['rarity']);
            $this->assertSame($source, $copy['content']['rarity_text']);
            $this->assertSame('items', $copy['content']['catalog_type']);
            $this->assertSame([], $copy['equipment_slots']);
            $this->assertFalse($copy['content']['gates']['execute']);
            $this->postJson('/api/library/items', $copy + ['clientMutationId' => (string) Str::uuid()])->assertOk()->assertJsonPath('definition.rarity', $expected);
            $this->getJson('/api/library/items')->assertOk()->assertJsonFragment(['rarity' => $expected]);
            // Free the fixture identity without deleting provenance referenced by copies.
            $entry->update(['external_key' => 'synthetic-rarity:'.$entry->id]);
        }
        $this->assertDatabaseCount('library_items', 6);
    }

    public function test_existing_v4_approval_still_displays_and_copies_after_v5_support(): void
    {
        $this->manifest['adapter_version'] = 4;
        $this->writePackage();
        $entry = $this->entry('longsword');
        $before = $entry->fresh()->getAttributes();
        $copy = $this->libraryCopy($entry);
        $this->assertSame('weapons', $copy['content']['catalog_type']);
        $this->assertFalse($copy['content']['gates']['execute']);
        $this->assertEquals($before, $entry->fresh()->getAttributes());
    }

    public function test_visual_catalog_filters_and_independent_library_copies(): void
    {
        $entries = [];
        foreach ($this->manifest['selection'] as $selection) {
            $key = $selection['external_key'];
            $entries[$selection['id']] = $this->entry($selection['id'], true,
                in_array($key, ['longsword', 'chain-mail', 'leather-armor', 'shield', 'arrows', 'potion-of-healing', 'cure-wounds', 'healing-word', 'fireball'], true),
                $key !== 'wish');
        }
        $sword = collect($entries)->firstWhere('external_key', 'longsword');
        $fireball = collect($entries)->firstWhere('external_key', 'fireball');
        $items = $this->getJson('/api/library/items/compendium')->assertOk()->json();
        $spells = $this->getJson('/api/library/spells?origin=system')->assertOk()->json();
        $weapons = $this->getJson('/api/library/items/compendium?type=weapons')->assertOk();
        $this->assertSame([$sword->id], array_column($weapons->json('entries'), 'id'));
        $weapons->assertJsonStructure(['entries' => [['source' => ['name', 'version', 'license', 'attribution']]]]);
        $this->getJson('/api/library/items/compendium?type=invalid')->assertUnprocessable();
        $this->getJson('/api/library/spells?origin=invalid')->assertUnprocessable();
        $itemCopy = $this->libraryCopy($sword);
        $spell = collect($spells['entries'])->firstWhere('id', $fireball->id);
        $spellCopy = $this->postJson('/api/library/spells', ['copyFrom' => $spell['id'], 'ability' => $spell['ability'],
            'clientMutationId' => (string) Str::uuid()])->assertOk()->json('entry');
        $this->getJson('/api/library/spells?origin=custom')->assertOk()->assertJsonCount(1, 'entries')->assertJsonPath('entries.0.id', $spellCopy['id']);
        $this->getJson('/api/library/spells?origin=system&search=Fireball')->assertOk()->assertJsonCount(1, 'entries')->assertJsonPath('entries.0.id', $spell['id']);
        $this->getJson('/api/library/spells?origin=custom&level=0')->assertOk()->assertJsonCount(0, 'entries');
        $stranger = User::factory()->create();
        $this->actingAs($stranger)->getJson('/api/library/spells?origin=custom')->assertOk()->assertJsonCount(0, 'entries');
        $this->actingAs($this->gm);

        // Export real API responses only on request, from this SQLite :memory: test.
        // The browser harness intercepts API calls and never connects to live MySQL.
        if (getenv('YTT_CONTENT_UX_FIXTURE') === '1') {
            $this->assertSame(':memory:', DB::connection()->getDatabaseName());
            $directory = base_path('artifacts/content-ux');
            File::ensureDirectoryExists($directory);
            file_put_contents($directory.'/api-fixture.json', json_encode([
                'items' => $items, 'spells' => $spells, 'itemCopy' => $itemCopy, 'spellCopy' => $spellCopy,
                'characterCatalog' => $this->getJson('/api/library/character-rules/catalog')->assertOk()->json(),
                'itemTypes' => collect($entries)->filter(fn ($e) => $e->entity_type !== 'spells')->mapWithKeys(fn ($e) => [$e->id => $e->entity_type]),
            ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
        }

        // Catalog changes must not rewrite either saved working copy.
        $sword->update(['name' => 'Catalog revision', 'checksum' => str_repeat('0', 64)]);
        $fireball->update(['name' => 'Catalog revision', 'checksum' => str_repeat('0', 64)]);
        $this->getJson('/api/library/items')->assertOk()->assertJsonPath('definitions.0.name', $itemCopy['name']);
        $this->getJson('/api/library/spells?origin=custom')->assertOk()->assertJsonPath('entries.0.ability.name', $spellCopy['ability']['name']);
        $edited = $spellCopy['ability'];
        $edited['name'] = 'My independent Fireball';
        $this->postJson('/api/library/spells', ['id' => $spellCopy['id'], 'ability' => $edited,
            'clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->assertSame('Catalog revision', $fireball->fresh()->name);
        $this->assertSame($spellCopy['ability']['spell']['content'], CompendiumEntry::findOrFail($spellCopy['id'])->normalized_data['ability']['spell']['content']);
    }

    public function test_pending_stale_and_browse_only_content_cannot_be_copied_or_disclosed(): void
    {
        $entry = $this->entry('cure-wounds', false);
        $hero = $this->hero();
        $this->getJson('/api/library/spells?search=Cure%20Wounds')->assertOk()->assertJsonCount(0, 'entries');
        $this->postJson('/api/library/characters/'.$hero->id.'/spells', ['action' => 'add', 'entryId' => $entry->id, 'clientMutationId' => (string) Str::uuid()])->assertUnprocessable();
        $item = $this->entry('longsword', true, false, false);
        $this->getJson('/api/library/items/compendium?search=Longsword')->assertOk()->assertJsonPath('entries.0.copyable', false);
        $this->postJson('/api/library/items/compendium', ['entryId' => $item->id, 'clientMutationId' => (string) Str::uuid()])->assertUnprocessable();
        $item->update(['name' => 'Tampered after review']);
        $this->getJson('/api/library/items/compendium')->assertOk()->assertJsonCount(0, 'entries');
        $this->assertDatabaseCount('library_items', 0);
        $this->assertDatabaseCount('compendium_copies', 0);
    }

    public function test_all_fifteen_envelopes_display_and_audit_without_remapping_raw_or_creating_effects(): void
    {
        foreach ($this->manifest['selection'] as $selection) {
            $entry = $this->entry($selection['id']);
            $gates = app(CompendiumContent::class)->gates($entry);
            $this->assertTrue($gates['browse']);
            $this->assertFalse($gates['execute']);
            if ($entry->entity_type !== 'spells') {
                $d = app(CompendiumContent::class)->item($entry);
                $this->assertSame([], $d->equipment_slots);
                $this->assertArrayNotHasKey('use', $d->gameplay);
            }
        }
        $this->getJson('/api/library/items/compendium')->assertOk()->assertJsonPath('total', 8);
        $this->getJson('/api/library/spells')->assertOk()->assertJsonPath('total', 7)->assertJsonPath('entries.0.ability.spell.coverage', 'MANUAL');
        $audit = app(SpellAudit::class)->run();
        $this->assertSame([], $audit['errors']);
        $this->assertSame(7, $audit['counts']['MANUAL']);
        $pilot = json_decode(file_get_contents(resource_path('data/content/srd-2024-pilot.manifest.json')), true);
        $this->assertSame([], $pilot['reviews']);
        $this->assertSame([], $pilot['baseline_reviews']);
    }

    public function test_bag_copy_retains_uncommon_full_text_and_campaignless_provenance_and_is_private(): void
    {
        $entry = $this->entry('magic-item:bag-of-holding');
        $payload = ['entryId' => $entry->id, 'clientMutationId' => (string) Str::uuid()];
        $d = $this->postJson('/api/library/items/compendium', $payload)->assertOk()->assertJsonPath('definition.rarity', 'uncommon')->json('definition');
        $this->postJson('/api/library/items/compendium', $payload)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $receipt = CompendiumCopy::firstOrFail();
        $this->assertNull($receipt->campaign_id);
        $this->assertSame($this->gm->id, $receipt->owner_user_id);
        $this->assertSame('dnd-2024', $receipt->source_reference['ruleset']);
        $this->assertSame($entry->checksum, $receipt->source_reference['checksum']);
        $this->assertSame($entry->raw_data, $receipt->snapshot['raw_data']);
        $this->assertGreaterThan(1000, strlen($d['content']['reference']));
        $this->actingAs(User::factory()->create())->getJson('/api/library/items')->assertOk()->assertJsonCount(0, 'definitions');
    }

    public function test_supported_equipment_and_item_copies_work_for_pc_and_npc_without_shared_state(): void
    {
        $armor = $this->libraryCopy($this->entry('chain-mail', true, true));
        $sword = $this->libraryCopy($this->entry('longsword', true, true));
        $this->assertSame('1d8', $sword['gameplay']['weapon']['dice']);
        $this->assertSame('1d10', $sword['gameplay']['weapon']['versatile_dice']);
        $pc = $this->hero();
        $npc = $this->hero('npc');
        foreach ([$pc, $npc] as $hero) {
            $this->postJson('/api/library/characters/'.$hero->id.'/inventory', ['action' => 'give', 'libraryItemId' => $armor['id'], 'quantity' => 1, 'slot' => 'armor', 'clientMutationId' => (string) Str::uuid()])
                ->assertOk()->assertJsonPath('character.ac', 16);
        }
        $a = $pc->inventory()->firstOrFail();
        $b = $npc->inventory()->firstOrFail();
        $this->assertNotSame($a->item_definition_id, $b->item_definition_id);
        $this->postJson('/api/library/characters/'.$pc->id.'/inventory', ['action' => 'unequip', 'itemId' => $a->id, 'clientMutationId' => (string) Str::uuid()])->assertOk()->assertJsonPath('character.ac', 10);
        $this->getJson('/api/library/characters/'.$npc->id.'/inventory')->assertOk()->assertJsonPath('character.ac', 16);
    }

    public function test_execute_false_spells_are_manual_and_cannot_be_upgraded_by_configuration_or_catalog_changes(): void
    {
        $entry = $this->entry('cure-wounds');
        $hero = $this->hero();
        $command = ['action' => 'add', 'entryId' => $entry->id, 'clientMutationId' => (string) Str::uuid()];
        $this->postJson('/api/library/characters/'.$hero->id.'/spells', $command)->assertOk();
        $this->postJson('/api/library/characters/'.$hero->id.'/spells', $command)->assertOk();
        $this->assertCount(1, $hero->fresh()->abilities);
        $a = $hero->fresh()->abilities[0];
        $this->assertSame('MANUAL', $a['spell']['coverage']);
        $this->assertSame('nothing', $a['result']['type']);
        $a['spell']['coverage'] = 'FULL';
        $this->expectException(HttpException::class);
        app(SpellCasting::class)->validate($hero, $a, 1);
    }

    public function test_reviewed_spell_execution_profile_is_frozen_and_survives_catalog_updates(): void
    {
        $entry = $this->entry('cure-wounds', true, true);
        $hero = $this->hero('npc');
        $this->postJson('/api/library/characters/'.$hero->id.'/spells', ['action' => 'add', 'entryId' => $entry->id, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $a = $hero->fresh()->abilities[0];
        $this->assertSame('2d8', $a['result']['dice']);
        $this->assertSame('2d8', $a['spell']['scaling']['healing']['per_level']);
        $this->assertTrue($a['spell']['content']['gates']['execute']);
        $before = $hero->fresh()->abilities;
        $entry->update(['name' => 'Catalog changed', 'checksum' => str_repeat('0', 64)]);
        $this->assertSame($before, $hero->fresh()->abilities);
        $this->assertSame('dnd-2024', CompendiumCopy::firstOrFail()->source_reference['ruleset']);
    }

    public function test_campaign_copy_accepts_envelope_and_preserves_existing_npc_flow(): void
    {
        $entry = $this->entry('magic-item:bag-of-holding');
        $campaign = Campaign::create(['name' => 'Isolated consumer campaign']);
        $campaign->members()->attach($this->gm, ['role' => 'gm']);
        $this->postJson('/api/campaigns/'.$campaign->id.'/compendium/copy', ['entry_id' => $entry->id, 'clientMutationId' => (string) Str::uuid()])
            ->assertOk()->assertJsonPath('definition.rarity', 'uncommon')->assertJsonPath('copy.source_reference.ruleset', 'dnd-2024');
        $this->assertDatabaseCount('item_definitions', 1);
    }

    public function test_new_envelope_spell_and_potion_apply_healing_and_consume_independent_resources(): void
    {
        $hero = $this->hero('npc');
        $campaign = Campaign::create(['name' => 'Isolated effect fixture']);
        $campaign->members()->attach($this->gm, ['role' => 'gm']);
        $scene = $campaign->scenes()->create(['name' => 'Disposable scene', 'grid_size' => 50, 'distance_per_cell' => 5]);
        $campaign->forceFill(['active_scene_id' => $scene->id])->save();
        $hero->forceFill(['campaign_id' => $campaign->id])->save();
        $token = $scene->tokens()->create(['character_id' => $hero->id, 'name' => 'Fixture NPC', 'x' => 0, 'y' => 0]);
        $entry = $this->entry('cure-wounds', true, true);
        $this->postJson('/api/campaigns/'.$campaign->id.'/compendium/copy', ['entry_id' => $entry->id, 'character_id' => $hero->id, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $a = $hero->fresh()->abilities[0];
        $a['spell']['prepared'] = true;
        $hero->update(['abilities' => [$a]]);
        $state = app(SpellCasting::class)->state($hero->fresh());
        $state['slots'][1] = ['max' => 2, 'current' => 2];
        $rules = $hero->rules;
        $rules['spellcasting_ability'] = 'wis';
        $hero->update(['spellcasting' => $state, 'rules' => $rules]);
        $command = ['characterId' => $hero->id, 'abilityId' => $a['id'], 'castLevel' => 1, 'epoch' => 0,
            'target' => ['kind' => 'token', 'id' => (string) $token->id], 'rollMode' => 'normal', 'clientMutationId' => (string) Str::uuid()];
        $this->postJson('/api/scenes/'.$scene->id.'/abilities/execute', $command)->assertOk();
        $this->assertGreaterThan(1, $hero->fresh()->hp);
        $this->assertSame(1, $hero->fresh()->spellcasting['slots'][1]['current']);
        $this->postJson('/api/scenes/'.$scene->id.'/abilities/execute', $command)->assertOk();
        $this->assertSame(1, $hero->fresh()->spellcasting['slots'][1]['current']);
        $potionEntry = $this->entry('potion-of-healing', true, true);
        $potion = $this->postJson('/api/campaigns/'.$campaign->id.'/compendium/copy', ['entry_id' => $potionEntry->id, 'clientMutationId' => (string) Str::uuid()])->assertOk()->json('definition');
        $this->postJson('/api/campaigns/'.$campaign->id.'/characters/'.$hero->id.'/inventory', ['action' => 'give', 'definitionId' => $potion['id'], 'quantity' => 2, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $hero->update(['hp' => 1]);
        $item = $hero->inventory()->firstOrFail();
        $this->postJson('/api/scenes/'.$scene->id.'/inventory/use', ['characterId' => $hero->id, 'inventoryItemId' => $item->id, 'epoch' => 0,
            'target' => ['kind' => 'token', 'id' => (string) $token->id], 'rollMode' => 'normal', 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $this->assertGreaterThan(1, $hero->fresh()->hp);
        $this->assertSame(1, $item->fresh()->quantity);
        $this->assertSame(1, $hero->fresh()->spellcasting['slots'][1]['current']);
        $weaponEntry = $this->entry('longsword', true, true);
        $weapon = $this->postJson('/api/campaigns/'.$campaign->id.'/compendium/copy', ['entry_id' => $weaponEntry->id, 'clientMutationId' => (string) Str::uuid()])->assertOk()->json('definition');
        $this->postJson('/api/campaigns/'.$campaign->id.'/characters/'.$hero->id.'/inventory', ['action' => 'give', 'definitionId' => $weapon['id'], 'quantity' => 1, 'slot' => 'main_hand', 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $weaponItem = $hero->inventory()->where('item_definition_id', $weapon['id'])->firstOrFail();
        $enemy = $scene->tokens()->create(['name' => 'Fixture target', 'x' => 50, 'y' => 0, 'hp' => 40, 'max_hp' => 40, 'ac' => 10]);
        $this->mock(D20Roller::class)->shouldReceive('roll')->andReturn(15);
        $this->postJson('/api/scenes/'.$scene->id.'/inventory/use', ['characterId' => $hero->id, 'inventoryItemId' => $weaponItem->id, 'epoch' => 0,
            'target' => ['kind' => 'token', 'id' => (string) $enemy->id], 'rollMode' => 'normal', 'clientMutationId' => (string) Str::uuid()])->assertOk()->assertJsonPath('execution.damage.expression', '1d8');
        $this->assertLessThan(40, $enemy->fresh()->hp);
        $this->assertSame(1, $weaponItem->fresh()->quantity);
    }

    public function test_manual_profiles_cannot_gain_damage_and_execution_approval_is_separate_and_checksum_bound(): void
    {
        $wish = $this->entry('wish', true, true);
        $a = app(CompendiumContent::class)->ability($wish);
        $this->assertFalse($a['spell']['content']['gates']['execute']);
        $this->assertSame('MANUAL', $a['spell']['coverage']);
        $this->assertArrayNotHasKey('damage_components', $a);
        $this->assertSame('nothing', $a['result']['type']);
        $cure = $this->entry('cure-wounds', true, true);
        $n = $cure->normalized_data;
        $n['content']['review']['local']['execution_checksum'] = str_repeat('0', 64);
        $cure->update(['normalized_data' => $n]);
        $gates = app(CompendiumContent::class)->gates($cure->fresh());
        $this->assertTrue($gates['copy']);
        $this->assertFalse($gates['execute']);
    }

    public function test_editing_a_reference_copy_cannot_remove_its_execution_boundary(): void
    {
        $entry = $this->entry('cure-wounds');
        $a = app(CompendiumContent::class)->ability($entry);
        $response = $this->postJson('/api/library/spells', ['copyFrom' => $entry->id, 'ability' => $a, 'clientMutationId' => (string) Str::uuid()])->assertOk();
        $privateId = $response->json('entry.id');
        unset($a['spell']['content']);
        $a['spell']['coverage'] = 'FULL';
        $a['target'] = 'token';
        $a['result'] = ['type' => 'heal', 'target' => null, 'amount' => 0, 'dice' => '2d8'];
        $this->postJson('/api/library/spells', ['id' => $privateId, 'ability' => $a, 'clientMutationId' => (string) Str::uuid()])->assertUnprocessable();
        $saved = CompendiumEntry::findOrFail($privateId)->normalized_data['ability'];
        $this->assertSame('MANUAL', $saved['spell']['coverage']);
        $this->assertFalse($saved['spell']['content']['gates']['execute']);
    }

    public function test_schema_rollback_refuses_to_discard_versioned_copy_provenance(): void
    {
        $this->libraryCopy($this->entry('magic-item:bag-of-holding'));
        $migration = require base_path('database/migrations/2026_11_12_170000_add_compendium_copy_contracts.php');
        $this->expectException(\RuntimeException::class);
        $migration->down();
    }

    public function test_execution_confirmation_requires_an_explicit_profile_pin_and_refuses_manual_profiles(): void
    {
        $entry = $this->entry('cure-wounds');
        $review = $entry->normalized_data['content']['review']['local'];
        $args = ['root' => $this->root, '--manifest' => $this->root.'/manifest.json', '--id' => 'srd:spell:cure-wounds:2024',
            '--checksum' => $entry->checksum, '--projection-checksum' => $review['projection_checksum'], '--reviewer' => 'Synthetic fixture ONLY', '--evidence' => 'SQLite contract test only',
            '--languages' => 'en,ru', '--copy' => true, '--execute' => true, '--confirm' => true, '--output' => $this->root.'/execution-fixture.json'];
        $this->artisan('compendium:unified-confirm', $args)->assertFailed();
        $args['--execution-checksum'] = $entry->normalized_data['content']['execution']['checksum'];
        $this->artisan('compendium:unified-confirm', $args)->assertSuccessful();
        $package = app(UnifiedPackage::class)->read($this->root, $args['--output']);
        $prepared = app(UnifiedSrdAdapter::class)->prepare($package['records'][0], $package['manifest'], $this->root);
        $this->assertTrue($prepared['gates']['execute']);
        $wish = $this->entry('wish');
        $args['--id'] = 'srd:spell:wish:2024';
        $args['--checksum'] = $wish->checksum;
        $args['--projection-checksum'] = $wish->normalized_data['content']['review']['local']['projection_checksum'];
        $args['--execution-checksum'] = $wish->normalized_data['content']['execution']['checksum'];
        $args['--output'] = $this->root.'/forbidden-wish-execution.json';
        $this->artisan('compendium:unified-confirm', $args)->assertFailed();
        $this->assertFileDoesNotExist($args['--output']);
    }

    public function test_legacy_api_refresh_cannot_erase_controlled_reviews_even_with_force(): void
    {
        $entry = $this->entry('cure-wounds');
        $source = $entry->source;
        $before = $entry->fresh()->getAttributes();
        $sourceBefore = $source->getAttributes();
        foreach ([false, true] as $force) {
            try {
                app(CompendiumSync::class)->import($source, [['endpoint' => 'spells', 'data' => $entry->raw_data['record']['raw']]], ['spells'], force: $force);
                $this->fail('Legacy API sync removed the content boundary.');
            } catch (\InvalidArgumentException $e) {
                $this->assertStringContainsString('controlled Unified', $e->getMessage());
            }
            $this->assertEquals($before, $entry->fresh()->getAttributes());
            $this->assertSame($sourceBefore, $source->fresh()->getAttributes());
        }
    }
}
