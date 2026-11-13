<?php

namespace App\Compendium\Unified;

use App\Compendium\CompendiumExecution;
use App\Compendium\CompendiumSync;
use App\Compendium\SrdEquipmentMapper;
use App\Compendium\SrdKeys;
use App\Compendium\SrdSpellMapper;
use Illuminate\Support\Facades\Validator;
use InvalidArgumentException;

class UnifiedSrdAdapter
{
    public const VERSION = 5;

    public const SUPPORTED_VERSIONS = [4, 5];

    public static function checksum(array $detail): string
    {
        // No index/shard transport metadata participates in identity or trust.
        return hash('sha256', json_encode(CompendiumSync::canonical($detail), JSON_THROW_ON_ERROR));
    }

    public function prepare(array $input, array $manifest, string $root): array
    {
        ['selection' => $selection, 'index' => $index, 'detail' => $detail] = $input;
        $record = $detail['record'] ?? [];
        $kind = $selection['kind'];
        $version = $manifest['adapter_version'];
        $normalizer = app(UnifiedSrdNormalization::class);
        $pdfSource = $version >= 5 && $normalizer->pdfSource($record, $kind);
        Validator::make($record, [
            'edition' => 'required|in:2024', 'stable_version_id' => 'required|string',
            'name_en' => 'required|string|max:255', 'name_ru' => 'nullable|string|max:255',
            'description_en' => 'present', 'description_ru' => 'present',
            'source' => 'required|array', 'source.index' => 'required|regex:/^[a-z0-9][a-z0-9-]*(?:\([a-z0-9-]+\))?$/D',
            'source.commit' => $pdfSource ? 'prohibited' : 'required|string', 'source.rules_reference' => 'required|string',
            'localization' => 'required|array', 'localization.human_verified' => 'required|boolean',
            'import_review.approved' => 'required|boolean', 'import_review.automation_allowed' => 'required|boolean',
            'rules_audit.full_semantic_review' => 'required|boolean', 'raw' => 'required|array',
            'mechanics' => 'sometimes|array', 'icon' => 'nullable|array',
            'raw.index' => 'required|string', 'raw.name' => 'required|string|max:255',
        ])->validate();
        foreach (['description_en', 'description_ru'] as $field) {
            $value = $record[$field];
            if ($value !== null && ! is_string($value) && (! is_array($value) || ! array_is_list($value) || count(array_filter($value, 'is_string')) !== count($value))) {
                throw new InvalidArgumentException('Description must be text or a list of text.');
            }
        }
        $raw = $record['raw'];
        $key = $record['source']['index'];
        if ($record['edition'] !== '2024' || $raw['index'] !== $key || $raw['name'] !== $record['name_en'] || ($index['en'] ?? null) !== $record['name_en']
            || ($index['ru'] ?? null) !== ($record['name_ru'] ?? null)
            || $selection['id'] !== 'srd:'.$kind.':'.$key.':2024' || ($index['originalId'] ?? null) !== $record['stable_version_id']
            || $record['stable_version_id'] !== $kind.':'.$key.':2024'
            || (! $pdfSource && $record['source']['commit'] !== $manifest['export']['srd_commit'])
            || ($detail['group']['id'] ?? null) !== ($index['group'] ?? null)) {
            throw new InvalidArgumentException('Detailed record identity/provenance differs from index/manifest.');
        }
        $checksum = self::checksum($detail);
        if ($checksum !== $selection['checksum']) {
            throw new InvalidArgumentException('Selected checksum changed; review a new manifest.');
        }
        // Preserve upstream raw verbatim; local editorial changes are explicit evidence.
        if (isset($selection['correction'])) {
            $detail['ytt_correction'] = $selection['correction'];
            $checksum = self::checksum($detail);
            if ($checksum !== $selection['content_checksum']) {
                throw new InvalidArgumentException('Corrected content checksum changed; review a new manifest.');
            }
            $record = array_replace($record, $selection['correction']['fields']);
        } elseif (isset($selection['content_checksum']) && $selection['content_checksum'] !== $checksum) {
            throw new InvalidArgumentException('Content checksum differs without a correction.');
        }
        $endpoint = match ($kind) {
            'spell' => 'spells', 'equipment' => 'equipment', 'magic_item' => 'magic-items'
        };
        $poisonSource = $version >= 5 && $kind === 'equipment'
            && ($record['source']['file'] ?? null) === 'sources/2024/en/5e-SRD-Poisons.json'
            && ($raw['url'] ?? null) === '/api/2024/poisons/'.$key && ! isset($record['source']['url']);
        if (! $pdfSource && ! $poisonSource && (($raw['url'] ?? null) !== '/api/2024/'.$endpoint.'/'.$key || ($record['source']['url'] ?? null) !== 'https://www.dnd5eapi.co'.$raw['url'])) {
            throw new InvalidArgumentException('Source URL/edition mismatch. URLs are evidence only, never fetched.');
        }
        $repairs = [];
        if ($version >= 5) {
            [$raw, $repairs] = $normalizer->mapping($record, $kind);
        }
        $this->validateRaw($raw, $kind);
        $type = match ($kind) {
            'spell' => 'spells', 'magic_item' => 'items', default => app(SrdEquipmentMapper::class)->type($raw),
        };
        // Magic-item keys are namespaced: equipment/shield and magic-items/shield are distinct.
        $externalKey = $kind === 'magic_item' ? 'magic-item:'.$key : $key;
        if ($selection['entity_type'] !== $type || $selection['external_key'] !== $externalKey) {
            throw new InvalidArgumentException('Manifest Compendium identity differs from projection.');
        }
        $description = $record['description_en'];
        $mapping = $raw;
        $mapping['description'] = is_array($description) ? implode("\n\n", $description) : ($description ?? '');
        if ($kind === 'spell' && isset($selection['correction']['fields']['description_en'])
            && is_string($raw['higher_level'] ?? null)
            && str_ends_with($mapping['description'], 'Using a Higher-Level Spell Slot. '.$raw['higher_level'])) {
            // CONTENT-03's full-language correction already includes this exact
            // paragraph. Existing consumers concatenate description+higher_level.
            $mapping['higher_level'] = null;
        }
        $normalized = ['schema_version' => CompendiumSync::VERSION, 'key' => SrdKeys::key($key), 'name' => $record['name_en']]
            + ($kind === 'spell' ? app(SrdSpellMapper::class)->map($mapping) : app(SrdEquipmentMapper::class)->map($mapping));
        if ($kind === 'spell' && $key === 'wish') {
            // SRD 5.2.1 p175: 1d10/level is a later stress consequence, never Wish's damage.
            $normalized['damage'] = null;
        }
        if ($kind === 'magic_item') {
            $normalized['category'] = 'adventuring_item';
            $normalized['subtype'] = 'magic_item';
            $normalized['rarity'] = $raw['rarity']['name'] ?? null;
        }
        $warnings = ['upstream_review_not_approval', 'exact_srd_revision_unpinned', 'runtime_execution_disabled'];
        if (! $record['localization']['human_verified']) {
            $warnings[] = 'translation_not_human_verified';
        }
        if (! $record['rules_audit']['full_semantic_review']) {
            $warnings[] = 'full_semantic_review_pending';
        }
        if (empty($record['official_reference'])) {
            $warnings[] = 'official_reference_missing';
        }
        if ($mapping['description'] === '') {
            $warnings[] = 'no_english_prose_check_structured_source';
        }
        if (SrdKeys::description($raw) !== $mapping['description']) {
            $warnings[] = 'curated_description_differs_from_raw';
        }
        foreach ($record['mechanics'] ?? [] as $field => $value) {
            if (array_key_exists($field, $raw) && json_encode(CompendiumSync::canonical($raw[$field])) !== json_encode(CompendiumSync::canonical($value))) {
                if (! isset($repairs[$field]) || UnifiedReview::digest($value) !== UnifiedReview::digest($repairs[$field]['after'])) {
                    $warnings[] = 'mechanics_differs_from_raw:'.$field;
                }
            }
        }
        $copyCompatible = mb_strlen($record['name_en']) <= 80 && strlen($normalized['key']) <= ($kind === 'spell' ? 80 : 128);
        if (! $copyCompatible) {
            $warnings[] = 'runtime_name_or_key_limit_exceeded';
        }
        $coverage = $kind === 'spell' ? (json_decode(file_get_contents(resource_path('data/spell-coverage.json')), true, 128, JSON_THROW_ON_ERROR)[$key] ?? null) : null;
        $unsupported = $this->unsupported($raw, $kind);
        if ($kind !== 'spell' && $mapping['description'] !== '') {
            $unsupported[] = 'prose_effects_reference_only';
        }
        if ($kind === 'spell') {
            $unsupported[] = 'spell_recipe_not_verified_against_unified_checksum';
            if ($key === 'wish') {
                $unsupported[] = 'wish_stress_reference_only_not_primary_damage';
            }
            if (($coverage['status'] ?? 'MANUAL') !== 'FULL') {
                $unsupported[] = 'spell_coverage:'.($coverage['status'] ?? 'MANUAL');
            }
            if (($coverage['status'] ?? 'MANUAL') === 'MANUAL' && ! empty($normalized['damage']['expression'])) {
                $warnings[] = 'manual_spell_structured_damage_requires_semantic_review';
            }
        }
        $visual = $this->visual($root, $index, $detail);
        $review = collect($manifest['reviews'])->firstWhere('id', $selection['id']);
        $gates = ['browse' => false, 'copy' => false, 'execute' => false];
        $normalized['content'] = [
            'source_id' => $selection['id'], 'original_id' => $record['stable_version_id'], 'group' => $detail['group'] ?? null,
            'ruleset' => 'dnd-2024', 'rules_revision_claim' => $record['source']['rules_reference'],
            'official_revision_evidence' => $record['rules_audit']['official_revision'] ?? null,
            'exact_rules_revision_verified' => false, 'export' => $manifest['export'], 'adapter_version' => $version,
            'languages' => ['en' => ['name' => $record['name_en'], 'description' => $record['description_en']], 'ru' => ['name' => $record['name_ru'] ?? null, 'description' => $record['description_ru']]],
            'review' => ['upstream' => $record['import_review'], 'localization' => $record['localization'], 'rules_audit' => $record['rules_audit'], 'local' => $review, 'gates' => $gates],
            'relations' => array_map(fn ($r) => ['target' => $r[0], 'kind' => $r[1], 'evidence' => $r[2], 'available_in_selection' => in_array($r[0], array_column($manifest['selection'], 'id'), true), 'equivalence' => 'not_established'], $detail['relations'] ?? []),
            'provenance' => ['source' => $record['source'], 'source_checksum' => $selection['checksum'], 'correction' => $selection['correction'] ?? null, 'official_reference' => $record['official_reference'] ?? null, 'attribution_file' => 'ATTRIBUTION.txt', 'translation_verified' => $record['localization']['human_verified'] === true],
            'visual' => $visual,
        ];

        if ($version >= 5) {
            $normalized['content']['normalization_repairs'] = $repairs;
            $normalized['content']['provenance']['source_kind'] = $pdfSource ? 'official_pdf_extraction' : ($poisonSource ? 'api_poison_supplement' : 'api_export');
            if ($poisonSource) {
                $warnings[] = 'poison_source_requires_review';
            }
        }

        $normalized['content']['execution'] = CompendiumExecution::profile(['entity_type' => $type, 'external_key' => $externalKey, 'normalized_data' => $normalized]);
        $data = ['entity_type' => $type, 'external_key' => $externalKey, 'name' => $record['name_en'], 'raw_data' => $detail,
            'normalized_data' => $normalized, 'checksum' => $checksum, 'normalization_version' => $version,
            'gates' => $gates, 'review_required' => $warnings, 'unsupported_fields' => $unsupported, 'coverage' => $coverage];
        $projection = UnifiedReview::projection($data);
        $reviewMatches = UnifiedReview::approved($review, $checksum, $projection);
        if ($review && ! $reviewMatches) {
            $data['review_required'][] = 'local_review_checksum_stale';
        }
        $profile = $normalized['content']['execution'];
        $data['gates'] = ['browse' => $reviewMatches, 'copy' => $reviewMatches && $copyCompatible && $review['copy'],
            'execute' => $reviewMatches && $copyCompatible && $review['copy'] && $review['execute'] && $profile['supported']
                && ($review['execution_checksum'] ?? null) === $profile['checksum']];
        $data['normalized_data']['content']['review']['gates'] = $data['gates'];
        $data['projection_checksum'] = $projection;

        return $data;
    }

    private function validateRaw(array $raw, string $kind): void
    {
        $rules = ['weight' => 'sometimes|numeric|min:0|max:1000000', 'cost' => 'sometimes|array', 'cost.quantity' => 'required_with:cost|numeric|min:0|max:1000000000',
            'cost.unit' => 'required_with:cost|in:cp,sp,ep,gp,pp', 'quantity' => 'sometimes|integer|min:1|max:1000000',
            'equipment_categories' => 'sometimes|array', 'equipment_categories.*.index' => 'required|string',
            'equipment_category.index' => 'required_with:equipment_category|string',
            'properties' => 'sometimes|array', 'properties.*.index' => 'required|string',
            'armor_class.base' => 'required_with:armor_class|integer|min:0|max:40',
            'armor_class.dex_bonus' => 'required_with:armor_class|boolean', 'armor_class.max_bonus' => 'sometimes|integer|min:0|max:20',
            'range.normal' => $kind === 'spell' ? 'prohibited' : 'required_with:range|numeric|min:0|max:100000',
            'range.long' => 'sometimes|numeric|min:0|max:100000', 'throw_range.normal' => 'required_with:throw_range|numeric|min:0',
            'damage' => 'sometimes|array', 'damage.damage_type.index' => 'required_with:damage|string',
            'damage.damage_at_slot_level' => 'sometimes|array', 'damage.damage_at_character_level' => 'sometimes|array',
            'two_handed_damage' => 'sometimes|array', 'two_handed_damage.damage_type.index' => 'required_with:two_handed_damage|string',
            'str_minimum' => 'sometimes|integer|min:0|max:30', 'stealth_disadvantage' => 'sometimes|boolean',
            'mastery.index' => 'required_with:mastery|string', 'ammunition.index' => 'required_with:ammunition|string'];
        if ($kind === 'spell') {
            unset($rules['range.normal'], $rules['range.long']);
            $rules += ['level' => 'required|integer|min:0|max:9', 'school.index' => 'required|string',
                'range' => 'required|string|max:160', 'casting_time' => 'required|string|max:500', 'duration' => 'required|string|max:255',
                'concentration' => 'required|boolean', 'ritual' => 'required|boolean', 'components' => 'required|array', 'components.*' => 'required|in:V,S,M',
                'classes' => 'required|array', 'classes.*.index' => 'required|string',
                'area_of_effect.type' => 'required_with:area_of_effect|in:sphere,cone,cube,cylinder,line', 'area_of_effect.size' => 'required_with:area_of_effect|numeric|min:0|max:100000',
                'dc.dc_type.index' => 'required_with:dc|in:str,dex,con,int,wis,cha', 'dc.dc_success' => 'sometimes|in:half,none,other'];
        }
        Validator::make($raw, $rules)->validate();
        // Numeric strings and truthy strings are not silently coerced into mechanics.
        foreach (['weight', 'cost.quantity', 'range.normal', 'range.long', 'armor_class.base', 'level', 'quantity'] as $path) {
            $value = data_get($raw, $path);
            if ($value !== null && ! is_int($value) && ! is_float($value)) {
                throw new InvalidArgumentException('Expected JSON number: '.$path);
            }
        }
        foreach (['concentration', 'ritual', 'armor_class.dex_bonus', 'stealth_disadvantage'] as $path) {
            $value = data_get($raw, $path);
            if ($value !== null && ! is_bool($value)) {
                throw new InvalidArgumentException('Expected JSON boolean: '.$path);
            }
        }
        foreach (['level', 'quantity', 'armor_class.base', 'armor_class.max_bonus', 'str_minimum'] as $path) {
            $value = data_get($raw, $path);
            if ($value !== null && ! is_int($value)) {
                throw new InvalidArgumentException('Expected JSON integer: '.$path);
            }
        }
        foreach (['damage.damage_at_slot_level' => [0, 9], 'damage.damage_at_character_level' => [1, 20]] as $path => [$min, $max]) {
            foreach (array_keys(data_get($raw, $path, [])) as $level) {
                if (! ctype_digit((string) $level) || (int) $level < $min || (int) $level > $max) {
                    throw new InvalidArgumentException('Invalid damage scaling level.');
                }
            }
        }
        foreach (['damage.damage_dice', 'two_handed_damage.damage_dice', 'damage.damage_at_slot_level.*', 'damage.damage_at_character_level.*'] as $path) {
            foreach ((array) data_get($raw, $path, []) as $dice) {
                if (! is_string($dice) || ! preg_match('/^(?:\d{1,3}d\d{1,4}(?:\s*[+-]\s*\d{1,4})?|\d{1,4})$/D', $dice)) {
                    throw new InvalidArgumentException('Unsupported dice expression.');
                }
            }
        }
    }

    private function unsupported(array $raw, string $kind): array
    {
        $mapped = ['index', 'url', 'name', 'description', 'desc', 'equipment_category', 'equipment_categories', 'cost', 'weight',
            'damage', 'two_handed_damage', 'range', 'throw_range', 'properties', 'mastery', 'ammunition', 'armor_class', 'str_minimum', 'stealth_disadvantage',
            'level', 'school', 'casting_time', 'duration', 'concentration', 'ritual', 'components', 'material', 'classes', 'dc', 'attack_type', 'area_of_effect', 'higher_level'];
        $fields = array_map(fn ($key) => 'raw.'.$key, array_values(array_diff(array_keys($raw), $mapped)));
        if (isset($raw['mastery'])) {
            $fields[] = 'weapon_mastery_reference_only';
        }
        if ($kind === 'magic_item') {
            $fields = array_values(array_diff($fields, ['raw.rarity']));
            $fields[] = 'magic_item_effects_attunement_variants_reference_only';
        }

        return $fields;
    }

    private function visual(string $root, array $index, array $detail): array
    {
        foreach ($detail['assets'] ?? [] as $original => $path) {
            if (! preg_match('~^icons/[a-f0-9]{64}\.png$~D', $original) || ! is_string($path) || ! preg_match('~^assets/[a-f0-9]{64}\.png$~D', $path)) {
                throw new InvalidArgumentException('Unsafe asset mapping.');
            }
        }
        $icon = $detail['record']['icon'] ?? null;
        if ($icon === null) {
            if (($index['icon'] ?? null) !== null) {
                throw new InvalidArgumentException('Index/detail icon mismatch.');
            }

            return ['asset' => null, 'rights_status' => 'not_reviewed', 'presentation' => 'neutral_fallback'];
        }
        $path = $detail['assets'][$icon['path'] ?? ''] ?? null;
        if (! is_string($path) || $path !== ($index['icon'] ?? null) || $path !== 'assets/'.($icon['sha256'] ?? '').'.png') {
            throw new InvalidArgumentException('Icon hash/path mapping mismatch.');
        }
        $file = app(UnifiedJson::class)->inside($root, $path);
        if (filesize($file) > 16 * 1024 * 1024 || hash_file('sha256', $file) !== $icon['sha256']) {
            throw new InvalidArgumentException('Icon size/checksum mismatch.');
        }
        $size = @getimagesize($file);
        if (! $size || $size[2] !== IMAGETYPE_PNG || $size[0] > 8192 || $size[1] > 8192 || $size[0] * $size[1] > 32000000 || (new \finfo(FILEINFO_MIME_TYPE))->file($file) !== 'image/png') {
            throw new InvalidArgumentException('Invalid PNG or dimensions.');
        }
        $decoded = @imagecreatefrompng($file);
        if (! $decoded) {
            throw new InvalidArgumentException('PNG cannot be decoded.');
        }
        imagedestroy($decoded);

        return ['asset' => null, 'origin' => $icon, 'verified_sha256' => $icon['sha256'], 'rights_status' => 'not_reviewed', 'presentation' => 'neutral_fallback'];
    }
}
