<?php

namespace Tests\Feature;

use App\Compendium\CompendiumSync;
use App\Compendium\Unified\UnifiedCatalogPlan;
use App\Compendium\Unified\UnifiedImport;
use App\Compendium\Unified\UnifiedReview;
use App\Compendium\Unified\UnifiedSrdAdapter;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use App\Models\User;
use App\Spells\SpellProjection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;
use RuntimeException;
use Tests\Support\UnifiedCompendiumTestCase;

class UnifiedCompendiumBaselineTest extends UnifiedCompendiumTestCase
{
    private function legacyEntry(): CompendiumEntry
    {
        $raw = $this->details[$this->manifest['selection'][0]['id']]['record']['raw'];
        app(CompendiumSync::class)->import(CompendiumSource::where('key', 'srd-2024')->firstOrFail(), [['endpoint' => 'equipment', 'data' => $raw]], ['weapons']);
        $entry = CompendiumEntry::firstOrFail();
        $normalized = $entry->normalized_data;
        unset($normalized['ammunition']);
        $entry->update(['normalized_data' => $normalized]);

        return $entry;
    }

    private function baselineReview(CompendiumEntry $entry): array
    {
        return ['id' => $this->manifest['selection'][0]['id'], 'policy' => UnifiedCatalogPlan::NULL_AMMUNITION_POLICY,
            'entry_id' => $entry->id, 'baseline_digest' => UnifiedCatalogPlan::baseline($entry->fresh()),
            'confirmed' => true, 'confirmed_at' => '2026-11-12T12:00:00+00:00', 'reviewer' => 'Synthetic baseline reviewer', 'evidence' => 'SQLite fixture only'];
    }

    private function approveContent(): void
    {
        $this->manifest['reviews'] = [];
        $this->writePackage();
        foreach ($this->manifest['selection'] as $selected) {
            $this->manifest['reviews'][] = ['id' => $selected['id'], 'checksum' => $selected['content_checksum'] ?? $selected['checksum'],
                'reviewer' => 'Synthetic content reviewer', 'evidence' => 'SQLite fixture only', 'browse' => true, 'copy' => true, 'execute' => false]
                + $this->reviewEvidence($selected['id']);
        }
        $this->writePackage();
    }

    private function applyFixture(): array
    {
        return app(UnifiedImport::class)->apply($this->root, $this->root.'/manifest.json', $this->runPlan()['plan_checksum']);
    }

    public function test_baseline_approval_is_separate_from_content_review_and_repeat_is_unchanged(): void
    {
        $this->assertSame('sqlite', DB::connection()->getDriverName());
        $this->assertSame(':memory:', DB::connection()->getDatabaseName());
        $entry = $this->legacyEntry();
        $before = DB::table('compendium_entries')->get()->toJson();
        $row = $this->runPlan()['records'][0];
        $this->assertSame('conflict', $row['action']);
        $this->assertSame('explicit_baseline_review_required', $row['reason']);
        $this->assertSame(UnifiedCatalogPlan::NULL_AMMUNITION_POLICY, $row['baseline_assessment']['status']);
        $this->assertSame($before, DB::table('compendium_entries')->get()->toJson());
        $this->manifest['baseline_reviews'] = [$this->baselineReview($entry)];
        $this->writePackage();
        $row = $this->runPlan()['records'][0];
        $this->assertSame('update', $row['action']);
        $this->assertFalse($row['gates']['browse']);
        $this->assertFalse($this->runPlan()['review_ready']);
        try {
            $this->applyFixture();
            $this->fail('Baseline approval allowed unreviewed content.');
        } catch (InvalidArgumentException) {
            $this->assertSame($before, DB::table('compendium_entries')->get()->toJson());
        }
        $this->approveContent();
        $this->assertSame(['create' => 2, 'update' => 1, 'skip' => 0], $this->applyFixture());
        $this->assertSame($entry->id, CompendiumEntry::where('external_key', 'longsword')->value('id'));
        $rows = DB::table('compendium_entries')->get()->toJson();
        $this->travel(1)->hours();
        $this->assertSame(['create' => 0, 'update' => 0, 'skip' => 3], $this->applyFixture());
        $this->assertSame($rows, DB::table('compendium_entries')->get()->toJson());
    }

    public function test_stale_or_wrong_row_baseline_review_cannot_be_reused(): void
    {
        $entry = $this->legacyEntry();
        $original = $this->baselineReview($entry);
        foreach (['baseline_digest' => str_repeat('0', 64), 'entry_id' => $entry->id + 1] as $key => $value) {
            $review = $original;
            $review[$key] = $value;
            $this->manifest['baseline_reviews'] = [$review];
            $this->writePackage();
            $row = $this->runPlan()['records'][0];
            $this->assertSame('conflict', $row['action']);
            $this->assertSame('stale_or_mismatched', $row['baseline_assessment']['review_status']);
        }
        $this->manifest['baseline_reviews'] = [$original];
        $this->writePackage();
        $entry->update(['imported_at' => now()->addDay()]);
        $this->assertSame('conflict', $this->runPlan()['records'][0]['action']);
    }

    public function test_narrow_policy_never_covers_real_edits_extra_fields_ammo_or_user_content(): void
    {
        $entry = $this->legacyEntry();
        $original = $entry->getAttributes();
        $mutations = [
            fn ($e) => $e->name = 'GM sword',
            fn ($e) => $e->normalized_data = $e->normalized_data + ['custom' => null],
            fn ($e) => $e->normalized_data = $e->normalized_data + ['ammunition' => 'arrow'],
            fn ($e) => $e->checksum = str_repeat('0', 64),
            fn ($e) => $e->library_user_id = User::factory()->create()->id,
            function ($e) {
                $raw = $e->raw_data;
                $raw['ammunition'] = ['index' => 'arrow'];
                $e->raw_data = $raw;
                $e->checksum = UnifiedReview::digest($raw);
            },
        ];
        foreach ($mutations as $mutate) {
            $entry->setRawAttributes($original, true);
            $mutate($entry);
            $entry->save();
            $this->manifest['baseline_reviews'] = [$this->baselineReview($entry)];
            $this->writePackage();
            $row = $this->runPlan()['records'][0];
            $this->assertSame('conflict', $row['action']);
            $this->assertFalse($row['baseline_assessment']['accepted']);
        }
    }

    public function test_adoption_rolls_back_with_a_later_insert_failure(): void
    {
        $entry = $this->legacyEntry();
        $this->manifest['baseline_reviews'] = [$this->baselineReview($entry)];
        $this->approveContent();
        $before = DB::table('compendium_entries')->get()->toJson();
        $dispatcher = CompendiumEntry::getEventDispatcher();
        CompendiumEntry::setEventDispatcher(clone $dispatcher);
        CompendiumEntry::saving(function ($row) {
            if ($row->external_key === 'fireball') {
                throw new RuntimeException('Synthetic adoption rollback');
            }
        });
        try {
            $this->applyFixture();
            $this->fail('Failure not injected.');
        } catch (RuntimeException $e) {
            $this->assertSame('Synthetic adoption rollback', $e->getMessage());
        } finally {
            CompendiumEntry::setEventDispatcher($dispatcher);
        }
        $this->assertSame($before, DB::table('compendium_entries')->get()->toJson());
        $this->assertSame('update', $this->runPlan()['records'][0]['action']);
    }

    public function test_complete_spell_language_text_does_not_repeat_scaling_in_consumer_reference(): void
    {
        $selected = &$this->manifest['selection'][2];
        $original = $this->details[$selected['id']];
        $higher = $original['record']['raw']['higher_level'];
        $full = $original['record']['description_en']."\n\nUsing a Higher-Level Spell Slot. ".$higher;
        $selected['correction'] = ['evidence' => 'Synthetic full translation', 'fields' => ['description_en' => $full, 'description_ru' => 'Synthetic translated full text']];
        $selected['content_checksum'] = UnifiedSrdAdapter::checksum($original + ['ytt_correction' => $selected['correction']]);
        $this->writePackage();
        $n = $this->runPlan(true)['records'][2]['normalized'];
        $this->assertNull($n['higher_level']);
        $this->assertSame($full, $n['content']['languages']['en']['description']);
        $ability = app(SpellProjection::class)->ability($n, 0);
        $this->assertSame(1, substr_count($ability['spell']['reference'], $higher));
        $this->assertSame('1d6', $ability['spell']['scaling']['damage']['per_level']);
        $this->assertSame($original, $this->details[$selected['id']]);
    }

    public function test_pilot_corrections_stay_checksum_pinned_without_any_human_approvals(): void
    {
        $pilot = json_decode(file_get_contents(resource_path('data/content/srd-2024-pilot.manifest.json')), true, 128, JSON_THROW_ON_ERROR);
        $previous = json_decode(file_get_contents(base_path('docs/CONTENT_03_LIVE_DIFF.json')), true, 128, JSON_THROW_ON_ERROR);
        $this->assertSame([], $pilot['reviews']);
        $this->assertSame([], $pilot['baseline_reviews']);
        $this->assertCount(6, array_filter($pilot['selection'], fn ($s) => isset($s['correction'])));
        foreach ($pilot['selection'] as $i => $selection) {
            $this->assertSame($previous['records'][$i]['source_checksum'], $selection['checksum']);
            $this->assertSame($previous['records'][$i]['checksum'], $selection['content_checksum'] ?? $selection['checksum']);
        }
    }

    public function test_direct_writer_cannot_bypass_closed_live_import_entrypoint(): void
    {
        $environment = app('env');
        app()->instance('env', 'local');
        $queries = [];
        DB::listen(function ($query) use (&$queries) {
            $queries[] = $query->sql;
        });
        try {
            app(UnifiedImport::class)->apply($this->root, $this->root.'/manifest.json', str_repeat('a', 64));
            $this->fail('Direct live writer was enabled.');
        } catch (InvalidArgumentException $e) {
            $this->assertStringContainsString('Live writes are disabled', $e->getMessage());
            $this->assertSame([], $queries);
        } finally {
            app()->instance('env', $environment);
        }
    }

    public function test_baseline_reviews_reject_wrong_scope_coercions_and_unsupported_policy(): void
    {
        $entry = $this->legacyEntry();
        $original = $this->baselineReview($entry);
        foreach ([['id', 'srd:spell:fireball:2024'], ['id', 'srd:equipment:other:2024'], ['confirmed', 1], ['entry_id', (string) $entry->id], ['policy', 'ignore-all-differences'], ['reviewer', '']] as [$field, $value]) {
            $review = $original;
            $review[$field] = $value;
            $this->manifest['baseline_reviews'] = [$review];
            $this->writePackage();
            try {
                $this->runPlan(true);
                $this->fail('Invalid baseline permission accepted: '.$field);
            } catch (InvalidArgumentException|ValidationException $e) {
                $this->assertNotEmpty($e->getMessage());
            }
        }
    }
}
