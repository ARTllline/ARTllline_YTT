<?php

namespace Tests\Feature;

use App\Compendium\CompendiumSync;
use App\Compendium\Unified\UnifiedBatchPreparation;
use App\Compendium\Unified\UnifiedCatalogPlan;
use App\Compendium\Unified\UnifiedReview;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use Tests\Support\UnifiedCompendiumTestCase;

class UnifiedMassPreparationTest extends UnifiedCompendiumTestCase
{
    public function test_material_and_concentration_repairs_need_exact_official_header_and_curated_agreement(): void
    {
        $id = 'srd:spell:fireball:2024';
        $r = &$this->details[$id]['record'];
        $r['raw']['material'] = 'gold dust worth 25+, GP';
        $r['raw']['duration'] = 'Concentration up to 10 minutes';
        $r['raw']['concentration'] = false;
        $r['mechanics'] = ['material' => 'gold dust worth 25+ GP', 'duration' => 'up to 10 minutes', 'concentration' => true];
        $r['official_reference'] = ['edition' => '2024', 'kind' => 'spell', 'name' => $r['name_en'],
            'lines' => ['Components: V, S, M (gold dust worth 25+', 'GP)', 'Duration: Concentration up to 10 minutes']];
        $this->writePackage();
        $row = $this->runPlan(true)['records'][2];
        $this->assertSame('gold dust worth 25+ GP', $row['normalized']['material']);
        $this->assertTrue($row['normalized']['concentration']);
        $this->assertSame('up to 10 minutes', $row['normalized']['duration']);
        $this->assertCount(3, $row['normalized']['content']['normalization_repairs']);
        $r['mechanics']['material'] = 'a different material';
        $this->writePackage();
        $this->assertSame('gold dust worth 25+, GP', $this->runPlan(true)['records'][2]['normalized']['material']);
    }

    public function test_pdf_extraction_preserves_real_provenance_and_only_extracts_unambiguous_header_rarity(): void
    {
        $detail = reset($this->details);
        $id = 'srd:magic_item:synthetic-pdf:2024';
        $header = 'Wondrous Item, Very Rare (Requires Attunement)';
        $detail['record']['stable_version_id'] = 'magic_item:synthetic-pdf:2024';
        $detail['record']['source'] = ['index' => 'synthetic-pdf', 'file' => 'sources/SRD_CC_v5.2.1.pdf', 'pages' => [123], 'rules_reference' => 'SRD 5.2.1'];
        $detail['record']['raw'] = ['name' => $detail['record']['name_en'], 'index' => 'synthetic-pdf', 'description' => [$header]];
        $detail['record']['official_reference'] = ['name' => $detail['record']['name_en'], 'kind' => 'magic_item', 'edition' => '2024',
            'file' => 'sources/SRD_CC_v5.2.1.pdf', 'pages' => [123], 'lines' => [$header]];
        $this->details = [$id => $detail];
        $this->manifest['selection'] = [['id' => $id, 'kind' => 'magic_item', 'entity_type' => 'items', 'external_key' => 'magic-item:synthetic-pdf']];
        $this->writePackage();
        $row = $this->runPlan(true)['records'][0];
        $this->assertSame('Very Rare', $row['normalized']['rarity']);
        $this->assertSame('official_pdf_extraction', $row['normalized']['content']['provenance']['source_kind']);
        $this->assertArrayNotHasKey('commit', $row['normalized']['content']['provenance']['source']);
        $this->assertSame($detail, $this->details[$id]);
        $this->details[$id]['record']['official_reference']['pages'] = [999];
        $this->writePackage();
        $this->assertArrayHasKey('errors', $this->runPlan(true)['records'][0]);
    }

    public function test_poison_supplement_cost_unit_is_not_invented_and_requires_human_review(): void
    {
        $id = $this->manifest['selection'][0]['id'];
        $r = &$this->details[$id]['record'];
        $r['source']['file'] = 'sources/2024/en/5e-SRD-Poisons.json';
        unset($r['source']['url']);
        $r['raw']['url'] = '/api/2024/poisons/longsword';
        $r['raw']['cost'] = 123;
        $this->writePackage();
        $row = $this->runPlan(true)['records'][0];
        $this->assertNull($row['normalized']['cost']);
        $this->assertSame(123, $r['raw']['cost']);
        $this->assertContains('poison_source_requires_review', $row['review_required']);
        $this->assertSame(123, $row['normalized']['content']['normalization_repairs']['cost']['before']);
    }

    public function test_singular_component_extraction_is_repaired_only_with_matching_official_evidence(): void
    {
        $id = 'srd:spell:fireball:2024';
        $r = &$this->details[$id]['record'];
        $r['raw']['range'] = 'Touch Component: V, S';
        $r['raw']['components'] = [];
        $r['official_reference'] = ['lines' => ['Range: Touch', 'Component: V, S']];
        $this->writePackage();
        $source = $this->details[$id];
        $row = $this->runPlan(true)['records'][2];
        $this->assertSame('touch', $row['normalized']['range']['kind']);
        $this->assertSame(['V', 'S'], $row['normalized']['components']);
        $this->assertSame($source, $this->details[$id]);
        $this->assertSame(['browse' => false, 'copy' => false, 'execute' => false], $row['gates']);
        $r['official_reference']['lines'] = ['Range: Touch', 'Component: V'];
        $this->writePackage();
        $this->assertArrayHasKey('errors', $this->runPlan(true)['records'][2]);
    }

    public function test_missing_source_ammunition_has_its_own_exact_opt_in_policy_and_cannot_adopt_other_edits(): void
    {
        $id = $this->manifest['selection'][0]['id'];
        $this->details[$id]['record']['raw']['ammunition'] = ['index' => 'arrow'];
        $this->writePackage();
        $raw = $this->details[$id]['record']['raw'];
        app(CompendiumSync::class)->import(CompendiumSource::where('key', 'srd-2024')->firstOrFail(), [['endpoint' => 'equipment', 'data' => $raw]], ['weapons']);
        $entry = CompendiumEntry::firstOrFail();
        $normalized = $entry->normalized_data;
        unset($normalized['ammunition']);
        $entry->update(['normalized_data' => $normalized]);
        $row = $this->runPlan()['records'][0];
        $this->assertSame('conflict', $row['action']);
        $this->assertSame(UnifiedCatalogPlan::MISSING_AMMUNITION_POLICY, $row['baseline_assessment']['status']);
        $review = ['id' => $id, 'policy' => UnifiedCatalogPlan::MISSING_AMMUNITION_POLICY, 'entry_id' => $entry->id,
            'baseline_digest' => UnifiedCatalogPlan::baseline($entry), 'confirmed' => true,
            'confirmed_at' => now()->toIso8601String(), 'reviewer' => 'Synthetic only', 'evidence' => 'SQLite fixture'];
        $this->manifest['baseline_reviews'] = [$review];
        $this->writePackage();
        $this->assertSame('update', $this->runPlan()['records'][0]['action']);
        $this->assertFalse($this->runPlan()['review_ready']);
        $entry->update(['normalized_data' => $normalized + ['custom' => null]]);
        $this->manifest['baseline_reviews'][0]['baseline_digest'] = UnifiedCatalogPlan::baseline($entry);
        $this->writePackage();
        $this->assertSame('modified_or_unrecognized', $this->runPlan()['records'][0]['baseline_assessment']['status']);
    }

    public function test_all_selection_reuses_prior_evidence_and_rejects_a_changed_pinned_record(): void
    {
        $service = app(UnifiedBatchPreparation::class);
        $prior = $service->prepare($this->root, $this->root.'/prior', [], true, ['equipment' => 1]);
        $bulk = $service->prepare($this->root, $this->root.'/bulk', [], true, [], true, $this->root.'/prior/review.json');
        $this->assertSame(3, $bulk['selected']);
        $this->assertSame(1, $bulk['reused_screening_count']);
        $this->assertSame($prior['records'][0]['selection'], $bulk['records'][0]['selection']);
        $this->assertSame($prior['records'][0]['quality'], $bulk['records'][0]['prior_screening']['quality']);
        $this->assertSame(0, $bulk['human_approvals']);
        $id = $prior['records'][0]['id'];
        $this->details[$id]['record']['raw']['weight'] = 123;
        $this->writePackage();
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Previously screened source changed');
        $service->prepare($this->root, $this->root.'/changed', [], true, [], true, $this->root.'/prior/review.json');
    }

    public function test_v4_and_v5_are_readable_but_v5_approvals_do_not_authorize_v4_projection(): void
    {
        $v5 = $this->runPlan(true)['records'][0];
        $this->manifest['adapter_version'] = 4;
        $this->manifest['reviews'] = [['id' => $v5['id'], 'checksum' => $v5['checksum'], 'projection_checksum' => $v5['projection_checksum'],
            'confirmed' => true, 'confirmed_at' => now()->toIso8601String(), 'reviewer' => 'Synthetic only', 'evidence' => 'SQLite fixture',
            'browse' => true, 'copy' => true, 'execute' => false, 'languages' => ['en', 'ru']]];
        $this->writePackage();
        $v4 = $this->runPlan(true)['records'][0];
        $this->assertSame(4, $v4['normalized']['content']['adapter_version']);
        $this->assertArrayNotHasKey('normalization_repairs', $v4['normalized']['content']);
        $this->assertNotSame($v5['projection_checksum'], $v4['projection_checksum']);
        $this->assertFalse($v4['gates']['browse']);
        $this->assertSame(UnifiedReview::digest($this->details[$v4['id']]), $v4['checksum']);
    }
}
