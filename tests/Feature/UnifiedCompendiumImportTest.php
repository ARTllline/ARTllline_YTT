<?php

namespace Tests\Feature;

use App\Compendium\CompendiumSync;
use App\Compendium\Unified\UnifiedDryRun;
use App\Compendium\Unified\UnifiedImport;
use App\Compendium\Unified\UnifiedPackage;
use App\Compendium\Unified\UnifiedSrdAdapter;
use App\Models\Campaign;
use App\Models\CompendiumCopy;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use RuntimeException;
use Tests\Support\UnifiedCompendiumTestCase;

/** All writer calls below use DatabaseMigrations + SQLite :memory:, never MySQL. */
class UnifiedCompendiumImportTest extends UnifiedCompendiumTestCase
{
    private function approveFixtures(): void
    {
        $this->manifest['reviews'] = [];
        $this->writePackage();
        foreach ($this->manifest['selection'] as $selected) {
            $this->manifest['reviews'][] = ['id' => $selected['id'], 'checksum' => $selected['content_checksum'] ?? $selected['checksum'],
                'reviewer' => 'Synthetic test reviewer', 'evidence' => 'Isolated fixture only; never pilot approval',
                'browse' => true, 'copy' => true, 'execute' => false] + $this->reviewEvidence($selected['id']);
        }
        $this->writePackage();
    }

    private function applyFixtures(?string $checksum = null): array
    {
        return app(UnifiedImport::class)->apply($this->root, $this->root.'/manifest.json', $checksum ?? $this->runPlan()['plan_checksum']);
    }

    public function test_import_is_atomic_idempotent_and_preserves_other_sources_and_user_copies(): void
    {
        $this->assertSame('sqlite', DB::connection()->getDriverName());
        $this->assertSame(':memory:', config('database.connections.sqlite.database'));
        $this->approveFixtures();
        $sourceBefore = DB::table('compendium_sources')->get()->toJson();
        $this->assertSame(['create' => 3, 'update' => 0, 'skip' => 0], $this->applyFixtures());
        $entry = CompendiumEntry::where('external_key', 'longsword')->firstOrFail();
        $owner = User::factory()->create();
        $personal = $entry->replicate()->fill(['source_id' => CompendiumSource::where('key', 'custom-library')->value('id'), 'library_user_id' => $owner->id, 'name' => 'Personal blade']);
        $personal->save();
        $campaign = Campaign::create(['name' => 'Isolated import copy']);
        CompendiumCopy::create(['campaign_id' => $campaign->id, 'compendium_entry_id' => $entry->id, 'target_type' => 'item', 'target_key' => 'independent-copy',
            'source_checksum' => $entry->checksum, 'source_reference' => ['test' => true], 'snapshot' => ['name' => 'GM modified copy', 'normalized_data' => $entry->normalized_data], 'created_at' => now()]);
        $copies = DB::table('compendium_copies')->get()->toJson();
        $rows = DB::table('compendium_entries')->get()->toJson();
        $this->travel(1)->hours();
        $this->assertSame(['create' => 0, 'update' => 0, 'skip' => 3], $this->applyFixtures());
        $this->assertSame($rows, DB::table('compendium_entries')->get()->toJson());
        $this->assertSame($sourceBefore, DB::table('compendium_sources')->get()->toJson());
        $this->assertSame($copies, DB::table('compendium_copies')->get()->toJson());
        $this->details[$this->manifest['selection'][0]['id']]['record']['raw']['weight'] = 4;
        $this->writePackage();
        $this->approveFixtures();
        $this->assertSame(['create' => 0, 'update' => 1, 'skip' => 2], $this->applyFixtures());
        $this->assertSame($copies, DB::table('compendium_copies')->get()->toJson());
        $this->assertSame('Personal blade', $personal->fresh()->name);
        $this->assertDatabaseCount('assets', 0);
    }

    public function test_legacy_api_adoption_retains_id_and_local_edit_becomes_conflict(): void
    {
        $source = CompendiumSource::where('key', 'srd-2024')->firstOrFail();
        app(CompendiumSync::class)->import($source, [['endpoint' => 'equipment', 'data' => $this->details[$this->manifest['selection'][0]['id']]['record']['raw']]], ['weapons']);
        $entry = CompendiumEntry::firstOrFail();
        $this->approveFixtures();
        $this->assertSame('update', $this->runPlan()['records'][0]['action']);
        $this->assertSame(['create' => 2, 'update' => 1, 'skip' => 0], $this->applyFixtures());
        $this->assertSame($entry->id, CompendiumEntry::where('external_key', 'longsword')->value('id'));
        $entry->refresh()->update(['name' => 'GM custom sword']);
        $before = DB::table('compendium_entries')->get()->toJson();
        $this->assertSame('conflict', $this->runPlan()['records'][0]['action']);
        try {
            $this->applyFixtures();
            $this->fail('Local edit overwritten.');
        } catch (InvalidArgumentException $e) {
            $this->assertStringContainsString('conflict', $e->getMessage());
        }
        $this->assertSame($before, DB::table('compendium_entries')->get()->toJson());
    }

    public function test_pending_and_stale_review_and_changed_projection_cannot_write_any_rows(): void
    {
        try {
            $this->applyFixtures();
            $this->fail('Unreviewed data imported.');
        } catch (InvalidArgumentException $e) {
            $this->assertStringContainsString('unconfirmed', $e->getMessage());
        }
        $this->approveFixtures();
        $this->details[$this->manifest['selection'][0]['id']]['record']['raw']['weight'] = 4;
        $this->writePackage();
        $this->assertFalse($this->runPlan()['records'][0]['gates']['browse']);
        try {
            $this->applyFixtures();
            $this->fail('Stale approval imported.');
        } catch (InvalidArgumentException) {
            $this->assertDatabaseCount('compendium_entries', 0);
        }
        $this->approveFixtures();
        $this->manifest['reviews'][0]['projection_checksum'] = str_repeat('0', 64);
        $this->writePackage();
        $this->assertFalse($this->runPlan()['records'][0]['gates']['browse']);
        $this->expectException(InvalidArgumentException::class);
        $this->applyFixtures();
    }

    public function test_db_change_after_preview_invalidates_plan_even_when_review_is_current(): void
    {
        $this->approveFixtures();
        $plan = $this->runPlan()['plan_checksum'];
        $this->applyFixtures($plan);
        $before = DB::table('compendium_entries')->get()->toJson();
        try {
            $this->applyFixtures($plan);
            $this->fail('Stale live plan accepted.');
        } catch (InvalidArgumentException $e) {
            $this->assertStringContainsString('Plan changed', $e->getMessage());
        }
        $this->assertSame($before, DB::table('compendium_entries')->get()->toJson());
    }

    public function test_user_owned_and_ambiguous_entries_block_the_whole_batch(): void
    {
        $this->approveFixtures();
        $source = CompendiumSource::where('key', 'srd-2024')->firstOrFail();
        $raw = $this->details[$this->manifest['selection'][0]['id']]['record']['raw'];
        app(CompendiumSync::class)->import($source, [['endpoint' => 'equipment', 'data' => $raw]], ['weapons']);
        $entry = CompendiumEntry::firstOrFail();
        $entry->update(['library_user_id' => User::factory()->create()->id]);
        $before = DB::table('compendium_entries')->get()->toJson();
        try {
            $this->applyFixtures();
            $this->fail('User content overwritten.');
        } catch (InvalidArgumentException) {
            $this->assertSame($before, DB::table('compendium_entries')->get()->toJson());
        }
        $entry->update(['library_user_id' => null]);
        $entry->replicate()->fill(['entity_type' => 'items'])->save();
        $this->assertSame('conflict', $this->runPlan()['records'][0]['action']);
        $this->expectException(InvalidArgumentException::class);
        $this->applyFixtures();
    }

    public function test_reviewed_checksum_change_needs_new_approval_and_preserves_existing_ids(): void
    {
        $this->approveFixtures();
        $this->applyFixtures();
        $id = $this->manifest['selection'][0]['id'];
        $entry = CompendiumEntry::where('external_key', 'longsword')->firstOrFail();
        $before = DB::table('compendium_entries')->get()->toJson();
        $this->details[$id]['record']['raw']['weight'] = 4;
        $this->writePackage();
        try {
            $this->applyFixtures();
            $this->fail('Old approval accepted.');
        } catch (InvalidArgumentException) {
            $this->assertSame($before, DB::table('compendium_entries')->get()->toJson());
        }
        $this->approveFixtures();
        $this->assertSame(['create' => 0, 'update' => 1, 'skip' => 2], $this->applyFixtures());
        $this->assertSame($entry->id, CompendiumEntry::where('external_key', 'longsword')->value('id'));
    }

    public function test_browse_only_review_is_not_enough_for_writer_and_language_scope_is_mandatory(): void
    {
        $this->approveFixtures();
        $this->manifest['reviews'][0]['copy'] = false;
        $this->writePackage();
        try {
            $this->applyFixtures();
            $this->fail('Browse-only imported into existing copy consumers.');
        } catch (InvalidArgumentException $e) {
            $this->assertStringContainsString('copy', $e->getMessage());
        }
        $this->assertDatabaseCount('compendium_entries', 0);
        $this->manifest['reviews'][0]['languages'] = ['en', 'en'];
        $this->writePackage();
        $this->expectException(InvalidArgumentException::class);
        $this->runPlan(true);
    }

    public function test_wish_stress_is_never_projected_as_main_damage_and_pilot_has_no_approvals(): void
    {
        $manifest = json_decode(file_get_contents(resource_path('data/content/srd-2024-pilot.manifest.json')), true, 128, JSON_THROW_ON_ERROR);
        $this->assertCount(15, $manifest['selection']);
        $this->assertSame([], $manifest['reviews']);
        $id = $this->manifest['selection'][2]['id'];
        $detail = $this->details[$id];
        $detail['record']['stable_version_id'] = 'spell:wish:2024';
        $detail['record']['name_en'] = 'Wish';
        $detail['record']['source']['index'] = 'wish';
        $detail['record']['source']['url'] = 'https://www.dnd5eapi.co/api/2024/spells/wish';
        $detail['record']['raw']['index'] = 'wish';
        $detail['record']['raw']['name'] = 'Wish';
        $detail['record']['raw']['url'] = '/api/2024/spells/wish';
        $detail['record']['raw']['level'] = 9;
        $detail['record']['raw']['damage']['damage_at_slot_level'] = ['9' => '1d10'];
        $detail['group']['id'] = 'spell:wish';
        $newId = 'srd:spell:wish:2024';
        unset($this->details[$id]);
        $this->details[$newId] = $detail;
        $this->manifest['selection'][2] = ['id' => $newId, 'kind' => 'spell', 'entity_type' => 'spells', 'external_key' => 'wish', 'checksum' => ''];
        $this->writePackage();
        $this->assertNull($this->runPlan(true)['records'][2]['normalized']['damage']);
    }

    public function test_failure_on_second_write_rolls_back_creates_and_updates(): void
    {
        $source = CompendiumSource::where('key', 'srd-2024')->firstOrFail();
        app(CompendiumSync::class)->import($source, [['endpoint' => 'equipment', 'data' => $this->details[$this->manifest['selection'][0]['id']]['record']['raw']]], ['weapons']);
        $before = DB::table('compendium_entries')->get()->toJson();
        $sourceBefore = DB::table('compendium_sources')->get()->toJson();
        $this->approveFixtures();
        $dispatcher = CompendiumEntry::getEventDispatcher();
        CompendiumEntry::setEventDispatcher(clone $dispatcher);
        CompendiumEntry::saving(function ($entry) {
            if ($entry->external_key === 'shield') {
                throw new RuntimeException('Injected persistence failure');
            }
        });
        try {
            $this->applyFixtures();
            $this->fail('Injected failure did not occur.');
        } catch (RuntimeException $e) {
            $this->assertSame('Injected persistence failure', $e->getMessage());
        } finally {
            CompendiumEntry::setEventDispatcher($dispatcher);
        }
        $this->assertSame($before, DB::table('compendium_entries')->get()->toJson());
        $this->assertSame($sourceBefore, DB::table('compendium_sources')->get()->toJson());
        $this->assertDatabaseCount('assets', 0);
    }

    public function test_failure_after_new_rows_were_inserted_rolls_back_all_of_them(): void
    {
        $this->approveFixtures();
        $dispatcher = CompendiumEntry::getEventDispatcher();
        CompendiumEntry::setEventDispatcher(clone $dispatcher);
        CompendiumEntry::saving(function ($entry) {
            if ($entry->external_key === 'fireball') {
                throw new RuntimeException('Injected third-write failure');
            }
        });
        try {
            $this->applyFixtures();
            $this->fail('Third write did not fail.');
        } catch (RuntimeException $e) {
            $this->assertSame('Injected third-write failure', $e->getMessage());
        } finally {
            CompendiumEntry::setEventDispatcher($dispatcher);
        }
        $this->assertDatabaseCount('compendium_entries', 0);
    }

    public function test_corrected_content_is_bound_to_source_content_and_projection_checksums(): void
    {
        $selected = &$this->manifest['selection'][0];
        $original = $this->details[$selected['id']];
        $selected['correction'] = ['evidence' => 'Synthetic editorial proposal', 'fields' => ['name_ru' => 'Исправленный перевод']];
        $selected['content_checksum'] = UnifiedSrdAdapter::checksum($original + ['ytt_correction' => $selected['correction']]);
        $this->writePackage();
        $this->assertSame('Исправленный перевод', $this->runPlan(true)['records'][0]['normalized']['content']['languages']['ru']['name']);
        $this->approveFixtures();
        $this->assertTrue($this->runPlan()['records'][0]['gates']['browse']);
        $this->applyFixtures();
        $entry = CompendiumEntry::where('external_key', 'longsword')->firstOrFail();
        $this->assertSame($original['record'], $entry->raw_data['record']);
        $selected['correction']['fields']['name_ru'] = 'Changed after confirmation';
        $this->writePackage();
        $this->assertFalse($this->runPlan()['validation_passed']);
    }

    public function test_confirmation_is_explicit_language_scoped_and_cannot_overwrite_source_manifest(): void
    {
        $selected = $this->manifest['selection'][0];
        $this->details[$selected['id']]['relations'] = [[$this->manifest['selection'][2]['id'], 'candidate', ['synthetic' => true]]];
        $this->writePackage();
        $row = $this->runPlan(true)['records'][0];
        $args = ['root' => $this->root, '--manifest' => $this->root.'/manifest.json', '--id' => $selected['id'], '--checksum' => $row['checksum'],
            '--projection-checksum' => $row['projection_checksum'], '--languages' => 'en,ru', '--reviewer' => 'Fixture human', '--evidence' => 'Fixture only', '--output' => $this->root.'/confirmed.json', '--copy' => true];
        $this->artisan('compendium:unified-confirm', $args)->assertFailed();
        $this->assertFileDoesNotExist($args['--output']);
        $this->artisan('compendium:unified-confirm', $args + ['--confirm' => true])->assertSuccessful();
        $confirmed = app(UnifiedPackage::class)->read($this->root, $args['--output']);
        $this->assertCount(1, $confirmed['records']);
        $this->assertTrue($confirmed['manifest']['reviews'][0]['confirmed']);
        $confirmedPlan = app(UnifiedDryRun::class)->run($this->root, $args['--output'], true);
        $this->assertTrue($confirmedPlan['records'][0]['gates']['browse']);
        $this->artisan('compendium:unified-confirm', $args + ['--confirm' => true])->assertFailed();
        $this->assertDatabaseCount('compendium_entries', 0);
    }

    public function test_cli_apply_is_closed_until_content_04_and_preview_never_writes(): void
    {
        $this->approveFixtures();
        $args = ['root' => $this->root, '--manifest' => $this->root.'/manifest.json'];
        $this->artisan('compendium:unified-import', $args)->assertSuccessful();
        $this->artisan('compendium:unified-import', $args + ['--apply' => true, '--confirm-plan' => $this->runPlan()['plan_checksum']])->assertFailed();
        $this->assertDatabaseCount('compendium_entries', 0);
    }
}
