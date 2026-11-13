<?php

namespace App\Spells;

use App\Services\DamageRoller;

/** Bounded spell data extends Ability, not a second executable language. */
class SpellMetadata
{
    public const FIELDS = 'level,school,classes,known,prepared,ritual,concentration,available,coverage,reasons,source_key,source_entry_id,reference,casting_time,duration,duration_text,components,material,scaling,cantrip_dice,cantrip_tier,effects,manual_allowed,material_definition_id,material_quantity,consume_material,content';

    public static function rules(): array
    {
        $p = 'abilities.*.spell.';
        $rules = [
            $p.'content' => 'sometimes|array:key,version,license,external_key,normalization_version,attribution,source_url,ruleset,rules_revision,export,checksum,projection_checksum,gates,reference,gm_required,localized,facts,catalog_type,rarity_text,range_text,execution_profile',
            $p.'content.execution_profile' => 'sometimes|array:id,checksum',
            $p.'content.execution_profile.id' => 'required_with:'.$p.'content.execution_profile|in:cure-wounds',
            $p.'content.execution_profile.checksum' => 'required_with:'.$p.'content.execution_profile|regex:/^[a-f0-9]{64}$/D',
            $p.'content.ruleset' => 'required_with:'.$p.'content|in:dnd-2024',
            $p.'content.gates' => 'required_with:'.$p.'content|array:browse,copy,execute',
            $p.'content.gates.browse' => 'required_with:'.$p.'content|boolean',
            $p.'content.gates.copy' => 'required_with:'.$p.'content|boolean',
            $p.'content.gates.execute' => 'required_with:'.$p.'content|boolean',
            $p.'content.checksum' => 'required_with:'.$p.'content|regex:/^[a-f0-9]{64}$/D',
            $p.'content.projection_checksum' => 'required_with:'.$p.'content|regex:/^[a-f0-9]{64}$/D',
            $p.'content.catalog_type' => 'sometimes|in:items,weapons,armor,spells',
            $p.'content.rarity_text' => 'sometimes|nullable|string|max:255',
            $p.'content.range_text' => 'sometimes|nullable|string|max:160',
            $p.'content.reference' => 'sometimes|nullable|string|max:60000',
            $p.'content.gm_required' => 'sometimes|array|list|max:12', $p.'content.gm_required.*' => 'string|max:300',
            $p.'content.facts' => 'sometimes|array|list|max:20', $p.'content.facts.*' => 'string|max:1000',
            $p.'content.localized' => 'sometimes|nullable|array:name,description',
            $p.'content.localized.name' => 'sometimes|nullable|string|max:255',
            $p.'content.localized.description' => ['sometimes', 'nullable', function ($attribute, $value, $fail) {
                $parts = is_string($value) ? [$value] : $value;
                if (! is_array($parts) || ! array_is_list($parts) || count($parts) > 100
                    || count(array_filter($parts, 'is_string')) !== count($parts) || mb_strlen(implode('', $parts)) > 60000) {
                    $fail('Описание источника должно быть ограниченным текстом или списком текстов.');
                }
            }],
            $p.'available' => 'sometimes|boolean', $p.'manual_allowed' => 'sometimes|boolean',
            $p.'coverage' => 'sometimes|in:FULL,PARTIAL,MANUAL', $p.'reasons' => 'sometimes|array|list|max:12', $p.'reasons.*' => 'string|max:300',
            $p.'source_key' => 'sometimes|string|max:100', $p.'source_entry_id' => 'sometimes|nullable|integer|min:1',
            $p.'reference' => 'sometimes|string|max:30000', $p.'casting_time' => 'sometimes|nullable|string|max:500',
            $p.'duration_text' => 'sometimes|nullable|string|max:500', $p.'components' => 'sometimes|array|list|max:3', $p.'components.*' => 'in:V,S,M',
            $p.'material' => 'sometimes|nullable|string|max:3000',
            $p.'duration' => 'sometimes|array:mode,amount', $p.'duration.mode' => 'required_with:'.$p.'duration|in:instantaneous,rounds,seconds,manual,source_start', $p.'duration.amount' => 'required_with:'.$p.'duration|integer|between:0,31536000',
            $p.'cantrip_dice' => 'sometimes|nullable|string|max:12', $p.'cantrip_tier' => 'sometimes|integer|between:1,4',
            $p.'scaling' => 'sometimes|array:damage,healing,temporary_hp',
            $p.'effects' => 'sometimes|array|list|max:8',
            $p.'effects.*' => 'array:type,key,value,dice,when,choices',
            $p.'effects.*.type' => 'required|in:modifier,temporary_hp,remove_condition',
            $p.'effects.*.key' => 'sometimes|in:ac,speed,attack,save,blinded,deafened,paralyzed,poisoned,prone',
            $p.'effects.*.value' => 'sometimes|integer|between:-100,100',
            $p.'effects.*.dice' => ['sometimes', 'nullable', 'string', 'regex:'.DamageRoller::PATTERN],
            $p.'effects.*.when' => 'required|in:always,hit,failed_save,successful_save',
            $p.'effects.*.choices' => 'sometimes|array|list|max:8', $p.'effects.*.choices.*' => 'in:blinded,deafened,paralyzed,poisoned,prone',
            $p.'material_definition_id' => 'sometimes|nullable|integer|min:1', $p.'material_quantity' => 'sometimes|integer|between:1,99', $p.'consume_material' => 'sometimes|boolean',
        ];
        foreach (['damage', 'healing', 'temporary_hp'] as $field) {
            $rules[$p.'scaling.'.$field] = 'sometimes|array:per_level,spellcasting';
            $rules[$p.'scaling.'.$field.'.per_level'] = ['sometimes', 'nullable', 'string', 'regex:'.DamageRoller::PATTERN];
            $rules[$p.'scaling.'.$field.'.spellcasting'] = 'sometimes|boolean';
        }

        return $rules;
    }

    public static function duration(?string $text): array
    {
        if (strtolower($text ?? '') === 'instantaneous') {
            return ['mode' => 'instantaneous', 'amount' => 0];
        }
        if (preg_match('/^(?:up to )?(\d+) (round|minute|hour|day)s?$/i', $text ?? '', $m)) {
            return ['mode' => $m[2] === 'round' ? 'rounds' : 'seconds', 'amount' => (int) $m[1] * match ($m[2]) {
                'minute' => 60, 'hour' => 3600, 'day' => 86400, default => 1
            }];
        }

        return ['mode' => 'manual', 'amount' => 0];
    }

    public static function validate(array $s): void
    {
        $duration = $s['duration'] ?? null;
        abort_if($duration && ! in_array($duration['mode'], ['instantaneous', 'manual']) && $duration['amount'] < 1, 422, 'Длительность должна быть положительной.');
        foreach ($s['effects'] ?? [] as $node) {
            if ($node['type'] === 'modifier') {
                abort_unless(in_array($node['key'] ?? '', ['ac', 'speed', 'attack', 'save']), 422, 'Выберите свойство модификатора.');
                abort_if(! empty($node['dice']) && ! in_array($node['key'], ['attack', 'save']), 422, 'Кубики модификатора поддержаны для атак и спасбросков.');
            }
            if ($node['type'] === 'remove_condition') {
                abort_unless(! empty($node['choices']) || in_array($node['key'] ?? '', ['blinded', 'deafened', 'paralyzed', 'poisoned', 'prone']), 422, 'Выберите снимаемое состояние.');
            }
        }
    }
}
