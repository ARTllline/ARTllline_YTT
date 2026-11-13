<?php

namespace Tests\Feature;

use App\Compendium\CompendiumSync;
use App\Compendium\Unified\UnifiedJson;
use App\Compendium\Unified\UnifiedPackage;
use App\Compendium\Unified\UnifiedReview;
use App\Compendium\Unified\UnifiedSrdAdapter;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;
use Tests\Support\UnifiedCompendiumTestCase;

class UnifiedCompendiumDryRunTest extends UnifiedCompendiumTestCase
{
    public function test_pending_review_is_not_approval_and_dry_run_issues_only_selects_without_changing_rows_or_timestamps(): void
    {
        $before = DB::table('compendium_sources')->get()->toJson();
        $queries = [];
        DB::listen(function ($query) use (&$queries) {
            $queries[] = $query->sql;
        });
        $plan = $this->runPlan();
        $this->assertTrue($plan['validation_passed']);
        $this->assertSame(['created' => 0, 'updated' => 0, 'unchanged' => 0, 'rejected' => 3], $plan['counts']);
        $this->assertSame(3, $plan['proposed_counts_before_review']['created']);
        $this->assertFalse($plan['review_ready']);
        foreach ($plan['records'] as $row) {
            $this->assertSame(['browse' => false, 'copy' => false, 'execute' => false], $row['gates']);
        }
        foreach ($queries as $query) {
            $this->assertStringStartsWith('select ', strtolower($query));
        }
        $this->assertSame($before, DB::table('compendium_sources')->get()->toJson());
        $this->assertDatabaseCount('compendium_entries', 0);
        $this->assertDatabaseCount('assets', 0);
        $this->assertDatabaseCount('compendium_copies', 0);
    }

    public function test_offline_does_not_query_the_database_or_claim_new_or_existing_identities(): void
    {
        $queries = [];
        DB::listen(function ($q) use (&$queries) {
            $queries[] = $q->sql;
        });
        $plan = $this->runPlan(true);
        $this->assertSame([], $queries);
        $this->assertNull($plan['source_exists']);
        $this->assertFalse($plan['catalog_checked']);
        $this->assertSame(3, $plan['proposed_counts_before_review']['not_compared']);
        $this->assertNull($plan['records'][0]['diff']);
    }

    public function test_missing_source_is_not_created_and_even_reviewed_records_cannot_be_import_ready(): void
    {
        CompendiumSource::where('key', 'srd-2024')->delete();
        $before = DB::table('compendium_sources')->get()->toJson();
        foreach ($this->manifest['selection'] as $selected) {
            $this->manifest['reviews'][] = ['id' => $selected['id'], 'checksum' => $selected['checksum'], 'reviewer' => 'Fixture reviewer',
                'evidence' => 'Synthetic fixture only', 'browse' => true, 'copy' => false, 'execute' => false] + $this->reviewEvidence($selected['id']);
        }
        $this->writePackage();
        $plan = $this->runPlan();
        $this->assertFalse($plan['source_exists']);
        $this->assertFalse($plan['review_ready']);
        $this->assertSame(3, $plan['counts']['rejected']);
        $this->assertSame('catalog_not_checked_or_source_missing', $plan['records'][0]['reason']);
        $this->assertSame($before, DB::table('compendium_sources')->get()->toJson());
        $this->assertDatabaseCount('compendium_entries', 0);
    }

    public function test_uses_existing_mappers_preserves_source_review_and_keeps_unsupported_fields_visible(): void
    {
        $plan = $this->runPlan();
        [$weapon, $shield, $spell] = array_column($plan['records'], 'normalized');
        $this->assertSame('1d8', $weapon['damage']['expression']);
        $this->assertSame('sap', $weapon['weapon_mastery']);
        $this->assertSame(2, $shield['armor']['ac_bonus']);
        $this->assertNull($shield['armor']['base_ac']);
        $this->assertSame('8d6', $spell['damage']['expression']);
        $this->assertEquals(150, $spell['range']['distance']);
        $this->assertSame('dnd-2024', $spell['content']['ruleset']);
        $this->assertFalse($spell['content']['exact_rules_revision_verified']);
        $this->assertFalse($spell['content']['review']['upstream']['approved']);
        $this->assertContains('weapon_mastery_reference_only', $plan['records'][0]['unsupported_fields']);
        $this->assertContains('translation_not_human_verified', $plan['records'][2]['review_required']);
    }

    public function test_diff_retains_equipment_id_and_does_not_overwrite_user_or_unselected_content(): void
    {
        $source = CompendiumSource::where('key', 'srd-2024')->firstOrFail();
        $raw = $this->details['srd:equipment:longsword:2024']['record']['raw'];
        app(CompendiumSync::class)->import($source, [['endpoint' => 'equipment', 'data' => $raw]], ['weapons']);
        $weapon = CompendiumEntry::firstOrFail();
        $weapon->update(['entity_type' => 'items']); // source reclassification retains ID
        $owner = User::factory()->create();
        $shield = CompendiumEntry::create(['source_id' => $source->id, 'entity_type' => 'armor', 'external_key' => 'shield', 'slug' => 'personal',
            'name' => 'Personal shield', 'raw_data' => [], 'normalized_data' => [], 'checksum' => str_repeat('f', 64), 'normalization_version' => 1, 'library_user_id' => $owner->id, 'imported_at' => now()]);
        $shield->replicate()->fill(['source_id' => CompendiumSource::where('key', 'custom-library')->value('id'), 'name' => 'Custom source shield'])->save();
        $before = DB::table('compendium_entries')->get()->toJson();
        $plan = $this->runPlan();
        $this->assertSame($weapon->id, $plan['records'][0]['existing_entry_id']);
        $this->assertSame('updated', $plan['records'][0]['proposed_state']);
        $this->assertSame(['before' => 'items', 'after' => 'weapons'], $plan['records'][0]['diff']['entity_type']);
        $this->assertSame('existing_identity_conflict_or_user_content', $plan['records'][1]['reason']);
        $this->assertSame($before, DB::table('compendium_entries')->get()->toJson());
        $this->assertSame('Personal shield', $shield->fresh()->name);
    }

    public function test_local_review_is_checksum_bound_and_repeat_plan_is_unchanged_without_execution_permission(): void
    {
        $selected = $this->manifest['selection'][0];
        $this->manifest['reviews'] = [['id' => $selected['id'], 'checksum' => $selected['checksum'], 'reviewer' => 'Fixture reviewer',
            'evidence' => 'Synthetic fixture review only', 'browse' => true, 'copy' => false, 'execute' => false] + $this->reviewEvidence($selected['id'])];
        $this->writePackage();
        $package = app(UnifiedPackage::class)->read($this->root, $this->root.'/manifest.json');
        $data = app(UnifiedSrdAdapter::class)->prepare($package['records'][0], $this->manifest, $this->root);
        unset($data['gates'], $data['review_required'], $data['unsupported_fields'], $data['coverage'], $data['projection_checksum']);
        $data['normalized_data']['content']['import_receipt'] = ['writer' => 'unified-srd-2024', 'digest' => UnifiedReview::digest($data), 'slug' => 'longsword'];
        $entry = CompendiumEntry::create($data + ['slug' => 'longsword', 'source_id' => CompendiumSource::where('key', 'srd-2024')->value('id'), 'imported_at' => now()]);
        $before = $entry->fresh()->toJson();
        $plan = $this->runPlan();
        $this->assertSame(1, $plan['counts']['unchanged']);
        $this->assertSame([], $plan['records'][0]['diff']);
        $this->assertFalse($plan['records'][0]['gates']['execute']);
        $this->assertSame($plan, $this->runPlan());
        $this->assertSame($before, $entry->fresh()->toJson());
        $this->details[$selected['id']]['record']['raw']['damage']['damage_dice'] = '2d8';
        $this->writePackage(); // selection repinned, old approval deliberately retained
        $row = $this->runPlan()['records'][0];
        $this->assertSame('rejected', $row['state']);
        $this->assertFalse($row['gates']['browse']);
        $this->assertContains('local_review_checksum_stale', $row['review_required']);
    }

    public function test_rejects_unpinned_changes_invalid_mechanics_and_unsafe_assets(): void
    {
        $id = $this->manifest['selection'][0]['id'];
        $original = $this->details[$id];
        $mutations = [
            fn (&$d) => $d['record']['raw']['weight'] = '3',
            fn (&$d) => $d['record']['raw']['damage']['damage_dice'] = '1d8; phpinfo()',
            fn (&$d) => $d['record']['source']['commit'] = str_repeat('f', 40),
            fn (&$d) => $d['record']['raw']['url'] = '/api/2014/equipment/longsword',
            fn (&$d) => $d['assets']['icons/test.png'] = '../secret.png',
        ];
        foreach ($mutations as $mutate) {
            $this->details[$id] = $original;
            $mutate($this->details[$id]);
            $this->writePackage();
            $plan = $this->runPlan();
            $this->assertFalse($plan['validation_passed']);
            $this->assertSame('validation_failed', $plan['records'][0]['reason']);
        }
        $this->details[$id] = $original;
        $this->writePackage();
        $this->details[$id]['record']['raw']['weight'] = 4;
        $this->writePackage(false);
        $this->assertStringContainsString('checksum changed', $this->runPlan()['records'][0]['errors'][0]);
    }

    public function test_rejects_other_corpora_duplicate_selection_and_broken_links_before_database_access(): void
    {
        $original = $this->manifest;
        foreach (['srd:spell:cure-wounds:2014', 'bg3:entity:Target_Technical'] as $id) {
            $this->manifest = $original;
            $this->manifest['selection'][0]['id'] = $id;
            file_put_contents($this->root.'/manifest.json', json_encode($this->manifest));
            try {
                $this->runPlan(true);
                $this->fail('Other corpus accepted.');
            } catch (ValidationException $e) {
                $this->assertArrayHasKey('selection.0.id', $e->errors());
            }
        }
        $this->manifest = $original;
        $this->manifest['selection'][] = $this->manifest['selection'][0];
        $this->writePackage();
        try {
            $this->runPlan(true);
            $this->fail('Duplicate accepted.');
        } catch (ValidationException $e) {
            $this->assertArrayHasKey('selection.0.id', $e->errors());
        }
        $this->manifest = $original;
        $this->details[$original['selection'][0]['id']]['relations'] = [['missing:target', 'edition', []]];
        $this->writePackage();
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Broken relation');
        $this->runPlan(true);
    }

    public function test_rejects_duplicate_index_id_and_unsafe_shard_name_instead_of_following_paths(): void
    {
        $path = $this->root.'/data/index.js';
        $reader = app(UnifiedJson::class);
        $original = $reader->read($path, 'acceptIndex');
        foreach (['duplicate', 'traversal'] as $case) {
            $index = $original;
            if ($case === 'duplicate') {
                $index['records'][] = $index['records'][0];
            } else {
                $index['records'][0]['shard'] = '../../manifest';
            }
            file_put_contents($path, 'acceptIndex('.json_encode($index).');');
            try {
                $this->runPlan(true);
                $this->fail('Invalid index accepted.');
            } catch (InvalidArgumentException $e) {
                $this->assertStringContainsString($case === 'duplicate' ? 'duplicate index' : 'identity/type/shard', $e->getMessage());
            }
        }
    }

    public function test_parser_never_executes_javascript_and_rejects_duplicate_json_keys_oversize_and_paths(): void
    {
        $reader = app(UnifiedJson::class);
        foreach (['acceptIndex({}); file_put_contents("pwned", "yes");', 'acceptIndex({"id":1,"\\u0069d":2});', 'acceptIndex({"number":NaN});', 'acceptIndex({"x":new Date()});'] as $text) {
            file_put_contents($this->root.'/bad.js', $text);
            try {
                $reader->read($this->root.'/bad.js', 'acceptIndex');
                $this->fail('Invalid JSON program accepted.');
            } catch (InvalidArgumentException|\JsonException $e) {
                $this->assertNotEmpty($e->getMessage());
            }
        }
        $this->assertFileDoesNotExist(base_path('pwned'));
        try {
            $reader->read($this->root.'/bad.js', limit: 2);
            $this->fail('Oversized input accepted.');
        } catch (InvalidArgumentException $e) {
            $this->assertStringContainsString('size limit', $e->getMessage());
        }
        $this->expectException(InvalidArgumentException::class);
        $reader->inside($this->root, '../manifest.json');
    }

    public function test_cli_requires_explicit_manifest_and_creates_reviewable_report_without_database_writes(): void
    {
        $this->artisan('compendium:unified-dry-run', ['root' => $this->root])->assertFailed();
        $this->artisan('compendium:unified-dry-run', ['root' => $this->root, '--manifest' => $this->root.'/manifest.json', '--offline' => true, '--report' => $this->root.'/report.json'])->assertSuccessful();
        $report = json_decode(file_get_contents($this->root.'/report.json'), true, 128, JSON_THROW_ON_ERROR);
        $this->assertSame(0, $report['database_writes']);
        $this->assertFalse($report['import_available']);
        $this->artisan('compendium:unified-dry-run', ['root' => $this->root, '--manifest' => $this->root.'/manifest.json', '--offline' => true, '--report' => $this->root.'/report.json'])->assertFailed();
        $this->assertDatabaseCount('compendium_entries', 0);
    }

    public function test_magic_item_and_equipment_with_same_upstream_index_remain_distinct(): void
    {
        $id = 'srd:magic_item:shield:2024';
        $this->details[$id] = $this->details['srd:equipment:shield:2024'];
        $record = &$this->details[$id]['record'];
        $record['stable_version_id'] = 'magic_item:shield:2024';
        $record['source']['url'] = 'https://www.dnd5eapi.co/api/2024/magic-items/shield';
        $record['raw'] = ['index' => 'shield', 'name' => 'Shield', 'url' => '/api/2024/magic-items/shield', 'rarity' => ['name' => 'Rare']];
        $this->details[$id]['group']['id'] = 'magic_item:shield';
        $this->manifest['selection'][] = ['id' => $id, 'kind' => 'magic_item', 'entity_type' => 'items', 'external_key' => 'magic-item:shield', 'checksum' => ''];
        $this->writePackage();
        $plan = $this->runPlan();
        $this->assertTrue($plan['validation_passed']);
        $this->assertSame('shield', $plan['records'][1]['identity']['external_key']);
        $this->assertSame('magic-item:shield', $plan['records'][3]['identity']['external_key']);
        $this->assertSame('magic_item', $plan['records'][3]['normalized']['subtype']);
        $this->assertSame('Rare', $plan['records'][3]['normalized']['rarity']);
    }

    public function test_asset_bytes_hash_and_mime_are_checked_without_registering_or_copying_images(): void
    {
        File::makeDirectory($this->root.'/assets');
        $image = imagecreatetruecolor(2, 2);
        ob_start();
        imagepng($image);
        $bytes = ob_get_clean();
        imagedestroy($image);
        $hash = hash('sha256', $bytes);
        $file = $this->root.'/assets/'.$hash.'.png';
        file_put_contents($file, $bytes);
        $id = $this->manifest['selection'][0]['id'];
        $this->details[$id]['record']['icon'] = ['path' => 'icons/'.$hash.'.png', 'sha256' => $hash];
        $this->details[$id]['assets'] = ['icons/'.$hash.'.png' => 'assets/'.$hash.'.png'];
        $this->writePackage();
        $plan = $this->runPlan();
        $this->assertTrue($plan['validation_passed']);
        $this->assertSame($hash, $plan['records'][0]['normalized']['content']['visual']['verified_sha256']);
        $this->assertNull($plan['records'][0]['normalized']['content']['visual']['asset']);
        $this->assertSame($bytes, file_get_contents($file));
        file_put_contents($file, 'tampered');
        $this->assertFalse($this->runPlan()['validation_passed']);
        $badHash = hash('sha256', 'not a PNG');
        file_put_contents($this->root.'/assets/'.$badHash.'.png', 'not a PNG');
        $this->details[$id]['record']['icon'] = ['path' => 'icons/'.$badHash.'.png', 'sha256' => $badHash];
        $this->details[$id]['assets'] = ['icons/'.$badHash.'.png' => 'assets/'.$badHash.'.png'];
        $this->writePackage();
        $this->assertFalse($this->runPlan()['validation_passed']);
        $this->assertDatabaseCount('assets', 0);
    }
}
