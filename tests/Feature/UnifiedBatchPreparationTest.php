<?php

namespace Tests\Feature;

use App\Compendium\CompendiumSync;
use App\Compendium\Unified\UnifiedBatchPreparation;
use App\Compendium\Unified\UnifiedBatchSelection;
use App\Compendium\Unified\UnifiedImport;
use App\Compendium\Unified\UnifiedJson;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use Illuminate\Support\Facades\DB;
use Tests\Support\UnifiedCompendiumTestCase;

class UnifiedBatchPreparationTest extends UnifiedCompendiumTestCase
{
    public function test_cli_rejects_unbounded_selection_without_touching_source_or_output(): void
    {
        $args = ['root' => $this->root, '--output' => $this->root.'/invalid', '--offline' => true];
        $this->artisan('compendium:unified-prepare-batch', $args + ['--equipment' => '-1'])->assertFailed();
        $this->artisan('compendium:unified-prepare-batch', $args + ['--spells' => '201'])->assertFailed();
        $this->artisan('compendium:unified-prepare-batch', $args + ['--equipment' => '1', '--magic-items' => '0', '--spells' => '1'])->assertFailed();
        $this->assertDirectoryDoesNotExist($this->root.'/invalid');
    }

    private function withReferences(): void
    {
        foreach ($this->details as &$detail) {
            $detail['record']['official_reference'] = ['edition' => '2024', 'pages' => [1], 'status' => 'synthetic fixture only'];
        }
        unset($detail);
        $this->writePackage();
    }

    private function prepare(string $name = 'batch'): array
    {
        return app(UnifiedBatchPreparation::class)->prepare($this->root, $this->root.'/'.$name, [], true,
            ['equipment' => 2, 'magic_item' => 0, 'spell' => 1]);
    }

    public function test_batch_is_deterministic_unapproved_and_preserves_source_and_database(): void
    {
        $this->withReferences();
        $sourceHash = hash_file('sha256', $this->root.'/data/records-0.js');
        $queries = [];
        DB::listen(function ($q) use (&$queries) {
            $queries[] = $q->sql;
        });
        $a = $this->prepare();
        $b = $this->prepare('second');
        $this->assertSame($a['bundle_checksum'], $b['bundle_checksum']);
        $this->assertCount(3, $a['records']);
        $this->assertSame(0, $a['human_approvals']);
        $this->assertFalse($a['execute']);
        $this->assertSame($sourceHash, hash_file('sha256', $this->root.'/data/records-0.js'));
        $this->assertSame([], $queries);
        $manifest = app(UnifiedJson::class)->read($this->root.'/batch/part-01.manifest.json');
        $this->assertSame([], $manifest['reviews']);
        $this->assertSame([], $manifest['baseline_reviews']);
        foreach ($a['records'] as $row) {
            $this->assertSame('pending', $row['quality']['human_approval']);
            $this->assertFalse($row['quality']['execute']);
        }
    }

    public function test_existing_twenty_record_limit_is_kept_across_large_batches(): void
    {
        $template = $this->details[$this->manifest['selection'][0]['id']];
        $this->details = $this->manifest['selection'] = [];
        for ($i = 0; $i < 43; $i++) {
            $key = 'synthetic-blade-'.$i;
            $id = 'srd:equipment:'.$key.':2024';
            $detail = $template;
            $detail['record']['stable_version_id'] = 'equipment:'.$key.':2024';
            $detail['record']['source']['index'] = $detail['record']['raw']['index'] = $key;
            $detail['record']['source']['url'] = 'https://www.dnd5eapi.co/api/2024/equipment/'.$key;
            $detail['record']['raw']['url'] = '/api/2024/equipment/'.$key;
            $detail['record']['name_en'] = $detail['record']['raw']['name'] = 'Synthetic blade '.$i;
            $detail['group']['id'] = 'equipment:'.$key;
            $this->details[$id] = $detail;
            $this->manifest['selection'][] = ['id' => $id, 'kind' => 'equipment', 'entity_type' => 'weapons', 'external_key' => $key, 'checksum' => ''];
        }
        $this->writePackage();
        $batch = app(UnifiedBatchPreparation::class)->prepare($this->root, $this->root.'/large', [], true, ['equipment' => 43]);
        $this->assertSame([20, 20, 3], array_column($batch['chunks'], 'count'));
        $this->assertCount(43, array_unique(array_column($batch['records'], 'id')));
        $this->assertDatabaseCount('compendium_entries', 0);
    }

    public function test_long_source_text_is_accepted_but_escaped_duplicate_keys_still_fail(): void
    {
        $path = $this->root.'/long.json';
        $text = str_repeat('Long source "quoted" { text } \\ ', 12000);
        file_put_contents($path, json_encode(['description' => $text, 'nested' => ['a' => 1], 'list' => [['a' => 2]]], JSON_THROW_ON_ERROR));
        $this->assertSame($text, app(UnifiedJson::class)->read($path)['description']);
        file_put_contents($path, '{"description":'.json_encode($text).',"a":1,"\\u0061":2}');
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Duplicate JSON object key');
        app(UnifiedJson::class)->read($path);
    }

    public function test_next_batch_excludes_only_unchanged_receipted_installed_records(): void
    {
        foreach ($this->manifest['selection'] as $selected) {
            $this->manifest['reviews'][] = ['id' => $selected['id'], 'checksum' => $selected['checksum'],
                'reviewer' => 'Synthetic fixture reviewer', 'evidence' => 'Fixture only, not real approval',
                'browse' => true, 'copy' => true, 'execute' => false] + $this->reviewEvidence($selected['id']);
        }
        $this->writePackage();
        app(UnifiedImport::class)->apply($this->root, $this->root.'/manifest.json', $this->runPlan()['plan_checksum']);
        $selector = app(UnifiedBatchSelection::class);
        $this->assertCount(3, $selector->installedIds($this->root));
        $entry = CompendiumEntry::where('external_key', 'longsword')->firstOrFail();
        $entry->update(['name' => 'Changed by fixture owner']);
        $this->assertNotContains($this->manifest['selection'][0]['id'], $selector->installedIds($this->root));
    }

    public function test_curated_characteristic_disagreement_is_shown_without_rewriting_source_or_projection(): void
    {
        $this->withReferences();
        $id = $this->manifest['selection'][0]['id'];
        $rawWeight = $this->details[$id]['record']['raw']['weight'];
        $this->details[$id]['record']['mechanics']['weight'] = 99;
        $this->writePackage();
        $batch = $this->prepare();
        $record = collect($batch['records'])->firstWhere('id', $id);
        $this->assertSame(['raw' => $rawWeight, 'curated_mechanics' => 99], $record['source_evidence']['mechanics_diff']['weight']);
        $this->assertSame('manual_review', $record['quality']['status']);
        $this->assertSame($rawWeight, $record['plan']['normalized']['weight']['value']);
        $this->assertSame(0, $batch['human_approvals']);
    }

    public function test_group_confirmation_needs_human_consent_and_rejects_stale_bundle(): void
    {
        $this->withReferences();
        $batch = $this->prepare();
        $group = collect($batch['records'])->first(fn ($r) => $r['quality']['status'] === 'validated_candidate')['group'];
        $args = ['root' => $this->root, '--review' => $this->root.'/batch/review.json', '--bundle-checksum' => $batch['bundle_checksum'],
            '--group' => implode(',', array_keys(array_filter($batch['groups'], fn ($ids, $key) => str_starts_with($key, 'validated_candidate--'), ARRAY_FILTER_USE_BOTH))), '--reviewer' => 'Synthetic fixture reviewer', '--evidence' => 'Synthetic group only; not real SRD approval',
            '--languages' => 'en,ru', '--copy' => true, '--output' => $this->root.'/confirmed'];
        $this->artisan('compendium:unified-confirm-group', $args)->assertFailed();
        $this->assertDirectoryDoesNotExist($args['--output']);
        $this->artisan('compendium:unified-confirm-group', array_replace($args, ['--bundle-checksum' => str_repeat('0', 64), '--confirm' => true]))->assertFailed();
        $this->assertDirectoryDoesNotExist($args['--output']);
        $this->artisan('compendium:unified-confirm-group', $args + ['--confirm' => true])->assertSuccessful();
        $confirmed = app(UnifiedJson::class)->read($args['--output'].'/approved-part-01.manifest.json');
        $this->assertCount($batch['counts']['validated_candidate'], $confirmed['reviews']);
        foreach ($confirmed['reviews'] as $review) {
            $this->assertFalse($review['execute']);
            $this->assertTrue($review['confirmed']);
        }
        $this->assertDatabaseCount('compendium_entries', 0);
    }

    public function test_changed_source_and_disputed_groups_cannot_be_batch_approved(): void
    {
        $this->withReferences();
        $batch = $this->prepare();
        $candidate = collect($batch['records'])->firstWhere('quality.status', 'validated_candidate');
        $args = ['root' => $this->root, '--review' => $this->root.'/batch/review.json', '--bundle-checksum' => $batch['bundle_checksum'],
            '--group' => $candidate['group'], '--reviewer' => 'Synthetic fixture reviewer', '--evidence' => 'Synthetic only',
            '--languages' => 'en,ru', '--copy' => true, '--confirm' => true, '--output' => $this->root.'/stale'];
        $this->details[$candidate['id']]['record']['raw']['weight'] = 999;
        $this->writePackage(false);
        $this->artisan('compendium:unified-confirm-group', $args)->assertFailed();
        $this->assertDirectoryDoesNotExist($args['--output']);
        $manual = collect($batch['records'])->firstWhere('quality.status', 'manual_review');
        $this->assertNotNull($manual);
        $this->artisan('compendium:unified-confirm-group', array_replace($args, ['--group' => $manual['group'], '--output' => $this->root.'/manual']))->assertFailed();
        $this->assertDirectoryDoesNotExist($this->root.'/manual');
    }

    public function test_group_baseline_acceptance_is_separate_explicit_and_stale_digest_refuses_all(): void
    {
        $this->withReferences();
        $selected = $this->manifest['selection'][0];
        $source = CompendiumSource::where('key', 'srd-2024')->firstOrFail();
        app(CompendiumSync::class)->import($source, [['endpoint' => 'equipment', 'data' => $this->details[$selected['id']]['record']['raw']]], ['weapons']);
        $entry = CompendiumEntry::where('external_key', 'longsword')->firstOrFail();
        $normalized = $entry->normalized_data;
        unset($normalized['ammunition']);
        $entry->update(['normalized_data' => $normalized]);
        $batch = app(UnifiedBatchPreparation::class)->prepare($this->root, $this->root.'/live', [], false, ['equipment' => 2, 'spell' => 1]);
        $member = collect($batch['records'])->firstWhere('id', $selected['id']);
        $this->assertSame('validated_candidate', $member['quality']['status']);
        $this->assertFalse($member['baseline_proposal']['confirmed']);
        $args = ['root' => $this->root, '--review' => $this->root.'/live/review.json', '--bundle-checksum' => $batch['bundle_checksum'],
            '--group' => $member['group'], '--reviewer' => 'Synthetic fixture human', '--evidence' => 'Synthetic baseline approval only',
            '--languages' => 'en,ru', '--copy' => true, '--confirm' => true, '--output' => $this->root.'/with-baseline'];
        $this->artisan('compendium:unified-confirm-group', $args)->assertFailed();
        $this->assertDirectoryDoesNotExist($args['--output']);
        $this->artisan('compendium:unified-confirm-group', $args + ['--accept-legacy-baselines' => true])->assertSuccessful();
        $reviewed = app(UnifiedJson::class)->read($args['--output'].'/approved-part-01.manifest.json');
        $this->assertCount(1, $reviewed['baseline_reviews']);
        $this->assertSame($entry->id, $reviewed['baseline_reviews'][0]['entry_id']);
        $entry->update(['name' => 'Changed by fixture owner']);
        $this->artisan('compendium:unified-confirm-group', array_replace($args, ['--accept-legacy-baselines' => true, '--output' => $this->root.'/stale-baseline']))->assertFailed();
        $this->assertDirectoryDoesNotExist($this->root.'/stale-baseline');
    }
}
