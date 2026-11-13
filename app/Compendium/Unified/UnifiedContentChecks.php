<?php

namespace App\Compendium\Unified;

use App\Items\ItemRarity;
use App\Items\ItemRules;
use App\Models\ItemDefinition;
use App\Services\CharacterGameplay;
use App\Spells\SpellProjection;
use Illuminate\Support\Facades\Validator;

/** Machine screening only: candidates still require explicit human EN/RU semantics review. */
class UnifiedContentChecks
{
    public static function prose(mixed $value): string
    {
        return trim(is_array($value) ? implode("\n\n", $value) : (is_string($value) ? $value : ''));
    }

    public function check(array $row, array $selection, bool $offline = false): array
    {
        if (isset($row['errors']) || ! isset($row['normalized'])) {
            return $this->result(['adapter_validation_failed'], [], [], $row['errors'] ?? []);
        }
        $n = $row['normalized'];
        $languages = $n['content']['languages'];
        $en = self::prose($languages['en']['description']);
        $ru = self::prose($languages['ru']['description']);
        $hard = $attention = [];
        if (trim($languages['ru']['name'] ?? '') === '') {
            $attention[] = 'ru_name_missing';
        }
        if (($en === '') !== ($ru === '')) {
            $attention[] = 'one_language_description_missing';
        }
        if ($selection['kind'] !== 'equipment' && ($en === '' || $ru === '')) {
            $attention[] = 'required_prose_missing';
        }
        if ($en !== '' && $ru !== '' && ! preg_match('/[\x{0400}-\x{04ff}]/u', $ru)) {
            $attention[] = 'ru_text_without_cyrillic';
        }
        $enNumbers = $this->numbers($en);
        $ruNumbers = $this->numbers($ru);
        if ($en !== '' && $ru !== '' && $enNumbers !== $ruNumbers) {
            $attention[] = 'en_ru_numeric_tokens_differ';
        }
        foreach ($row['review_required'] as $warning) {
            if (str_starts_with($warning, 'mechanics_differs_from_raw:') || in_array($warning, ['curated_description_differs_from_raw', 'official_reference_missing', 'manual_spell_structured_damage_requires_semantic_review'], true)) {
                $attention[] = $warning;
            }
            if ($warning === 'runtime_name_or_key_limit_exceeded') {
                $hard[] = $warning;
            }
        }
        if ($selection['kind'] === 'magic_item' && ItemRarity::fromSource($n['rarity'] ?? null) === 'unknown') {
            $attention[] = 'magic_rarity_missing_or_unrecognized';
        }
        if (in_array('poison_source_requires_review', $row['review_required'], true)) {
            $attention[] = 'poison_source_requires_review';
        }
        $localization = data_get($n, 'content.review.localization', []);
        if (str_contains($en.$ru.($languages['ru']['name'] ?? ''), "\u{FFFD}")) {
            $attention[] = 'replacement_character_in_text';
        }
        $revision = $n['content']['ruleset'];
        if ($revision !== 'dnd-2024' || ! in_array($n['content']['adapter_version'], UnifiedSrdAdapter::SUPPORTED_VERSIONS, true)) {
            $hard[] = 'wrong_ruleset_or_projection_version';
        }
        $officialEdition = data_get($n, 'content.provenance.official_reference.edition');
        if ($officialEdition !== null && $officialEdition !== '2024') {
            $hard[] = 'conflicting_official_edition';
        }
        if (($row['action'] ?? null) === 'conflict' && ! in_array($row['baseline_assessment']['status'] ?? null, UnifiedCatalogPlan::BASELINE_POLICIES, true)) {
            $hard[] = 'unrecognized_or_modified_live_baseline';
        }
        $compatibility = [];
        if (! $offline && $selection['kind'] !== 'spell') {
            // Validate the same neutral mechanical shape as a reference-only Item copy.
            $item = (new ItemDefinition)->forceFill(['name' => $n['name'], 'category' => 'adventuring_gear',
                'equipment_slots' => [], 'modifiers' => [], 'use_ability_id' => null,
                'gameplay' => ['source_key' => $n['key']]]);
            try {
                app(ItemRules::class)->validateDefinition($item);
            } catch (\Throwable $e) {
                $hard[] = 'reference_item_validation_failed';
                $compatibility[] = $e->getMessage();
            }
        }
        if ($selection['kind'] === 'spell') {
            if (! $offline) {
                $ability = app(SpellProjection::class)->ability($n + ['source_key' => $selection['external_key'], 'source_entry_id' => $row['existing_entry_id'] ?? 0], 0);
                if (empty($row['existing_entry_id'])) {
                    unset($ability['spell']['source_entry_id']);
                }
                // Diagnostic only, matching the existing reference-only consumer. No review/gates are granted.
                unset($ability['attack'], $ability['save'], $ability['damage_components'], $ability['condition_effects'], $ability['spell']['scaling'], $ability['spell']['cantrip_dice']);
                $ability['damage'] = null;
                $ability['result'] = ['type' => 'nothing', 'target' => null, 'amount' => 0];
                $ability['category'] = 'effect';
                $ability['target'] = 'none';
                $ability['area'] = null;
                $ability['spell']['coverage'] = 'MANUAL';
                $ability['spell']['effects'] = [];
                $ability['spell']['manual_allowed'] = false;
                $compatibility = Validator::make(['abilities' => [$ability]], CharacterGameplay::rules())->errors()->all();
                if ($compatibility) {
                    $hard[] = 'reference_ability_validation_failed';
                }
            }
            if (! empty($n['higher_level']) && (! str_contains($en, 'Higher-Level') || ! preg_match('/более высокого|высокого уровня|уровня ячейк|круг/iu', $ru))) {
                $attention[] = 'higher_level_not_explicit_in_both_full_texts';
            }
        }

        return $this->result($hard, array_values(array_unique($attention)), [
            'en_numbers' => $enNumbers, 'ru_numbers' => $ruNumbers,
            'both_equipment_descriptions_absent' => $en === '' && $ru === '' && $selection['kind'] === 'equipment',
            'source_checksum_pinned' => true, 'projection_version_computed' => $n['content']['adapter_version'],
            'raw_characteristics_validated_by_existing_adapter' => true,
            'edition_identity_checked' => true, 'exact_rules_revision_verified' => false,
            'reference_copy_structural_check' => $offline ? null : ! $compatibility && ! $hard,
            'runtime_catalog_checked' => ! $offline,
            'machine_local_translation' => ($localization['name_ru_status'] ?? null) === 'machine_local_unverified' || in_array('name_translation_requires_review', $localization['review_flags'] ?? [], true),
            'semantic_approved' => false, 'languages_human_verified' => false, 'execute' => false,
        ], $compatibility);
    }

    private function result(array $hard, array $attention, array $checks, array $errors): array
    {
        return ['status' => $hard ? 'rejected' : ($attention ? 'manual_review' : 'validated_candidate'),
            'hard_errors' => $hard, 'attention' => $attention, 'checks' => $checks,
            'compatibility_errors' => $errors, 'human_approval' => 'pending', 'execute' => false];
    }

    private function numbers(string $text): array
    {
        $text = preg_replace('/(?<=\d)[кКдД](?=\d)/u', 'd', $text);
        preg_match_all('/(?<![\pL\d])\d+(?:[.,]\d+)?(?:d\d+(?:\s*[+-]\s*\d+)?)?(?:\s*%|(?![\pL\d]))/iu', $text, $matches);
        $tokens = array_map(fn ($s) => strtolower(str_replace([' ', ','], ['', '.'], $s)), $matches[0]);
        sort($tokens);

        return $tokens;
    }
}
