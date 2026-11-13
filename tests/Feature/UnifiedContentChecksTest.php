<?php

namespace Tests\Feature;

use App\Compendium\Unified\UnifiedContentChecks;
use Tests\TestCase;

class UnifiedContentChecksTest extends TestCase
{
    private function row(?string $en = null, ?string $ru = null): array
    {
        return ['id' => 'synthetic', 'action' => 'create', 'review_required' => [], 'normalized' => [
            'name' => 'Synthetic item', 'key' => 'synthetic', 'content' => ['ruleset' => 'dnd-2024', 'adapter_version' => 4,
                'languages' => ['en' => ['name' => 'Synthetic', 'description' => $en], 'ru' => ['name' => 'Тест', 'description' => $ru]]]]];
    }

    public function test_missing_equipment_prose_is_not_invented_and_candidate_is_not_semantic_approval(): void
    {
        $result = app(UnifiedContentChecks::class)->check($this->row(), ['kind' => 'equipment']);
        $this->assertSame('validated_candidate', $result['status']);
        $this->assertTrue($result['checks']['both_equipment_descriptions_absent']);
        $this->assertFalse($result['checks']['semantic_approved']);
        $this->assertFalse($result['checks']['exact_rules_revision_verified']);
        $this->assertSame('pending', $result['human_approval']);
    }

    public function test_numeric_and_language_inconsistency_go_to_human_review(): void
    {
        $checks = app(UnifiedContentChecks::class);
        $matched = $checks->check($this->row('Damage 2d6 plus 1.', 'Урон 2к6 плюс 1.'), ['kind' => 'equipment']);
        $this->assertSame('validated_candidate', $matched['status']);
        $mismatch = $checks->check($this->row('Damage 2d6 plus 1.', 'Урон 2к8 плюс 1.'), ['kind' => 'equipment']);
        $this->assertSame('manual_review', $mismatch['status']);
        $this->assertContains('en_ru_numeric_tokens_differ', $mismatch['attention']);
        $missing = $checks->check($this->row('Reference.', null), ['kind' => 'equipment']);
        $this->assertContains('one_language_description_missing', $missing['attention']);
    }

    public function test_incompatible_rarity_wrong_version_modified_baseline_and_adapter_errors_are_rejected(): void
    {
        $checks = app(UnifiedContentChecks::class);
        $row = $this->row('Reference.', 'Справка.');
        $row['normalized']['rarity'] = 'Very Rare';
        $result = $checks->check($row, ['kind' => 'magic_item']);
        $this->assertSame('validated_candidate', $result['status']);
        $this->assertSame([], $result['hard_errors']);
        $row['normalized']['content']['ruleset'] = 'dnd-2014';
        $this->assertSame('rejected', $checks->check($row, ['kind' => 'equipment'])['status']);
        $row = $this->row();
        $row['action'] = 'conflict';
        $row['baseline_assessment'] = ['status' => 'modified_or_unrecognized'];
        $this->assertSame('rejected', $checks->check($row, ['kind' => 'equipment'])['status']);
        $this->assertSame('rejected', $checks->check(['errors' => ['invalid source']], ['kind' => 'equipment'])['status']);
    }
}
