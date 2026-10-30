<?php

namespace App\Combat;

use App\Models\CompendiumEntry;
use App\Services\CharacterCatalog;
use App\Services\DamageRoller;
use Illuminate\Validation\Rule;

class CombatMetadata
{
    public static function types(): array
    {
        return CompendiumEntry::whereHas('source', fn ($q) => $q->where('key', 'srd-2024'))->where('entity_type', 'rules')->where('external_key', 'like', 'damage-types:%')->pluck('normalized_data')->map(fn ($n) => $n['key'])->all();
    }

    public static function profileRules(): array
    {
        $r = ['combat_profile' => 'sometimes|nullable|array:resistances,vulnerabilities,immunities,condition_immunities,ability_scores,saving_throws,proficiency_bonus,spellcasting_ability,zero_hp_policy,lifecycle_consequences', 'combat_profile.proficiency_bonus' => 'sometimes|integer|between:0,20', 'combat_profile.spellcasting_ability' => 'sometimes|nullable|in:str,dex,con,int,wis,cha'];
        $r += ['combat_profile.zero_hp_policy' => 'sometimes|in:immediate_death,death_saves,manual',
            'combat_profile.lifecycle_consequences' => 'sometimes|array|list|max:6',
            'combat_profile.lifecycle_consequences.*' => 'array:name,trigger,description,reference',
            'combat_profile.lifecycle_consequences.*.name' => 'required|string|max:80',
            'combat_profile.lifecycle_consequences.*.trigger' => 'required|in:on_zero_hp,on_defeat,on_death',
            'combat_profile.lifecycle_consequences.*.description' => 'required|string|max:12000',
            'combat_profile.lifecycle_consequences.*.reference' => 'sometimes|string|max:500'];
        foreach (['resistances', 'vulnerabilities', 'immunities', 'condition_immunities'] as $key) {
            $r['combat_profile.'.$key] = 'sometimes|array|list|max:30';
            $r['combat_profile.'.$key.'.*'] = ['string', 'distinct', Rule::in($key === 'condition_immunities' ? array_keys(app(CharacterCatalog::class)->entries('conditions')) : self::types())];
        }
        foreach (['ability_scores', 'saving_throws'] as $key) {
            $r['combat_profile.'.$key] = 'sometimes|array:str,dex,con,int,wis,cha';
            $r['combat_profile.'.$key.'.*'] = 'integer|between:'.($key === 'ability_scores' ? '1,30' : '-100,100');
        }

        return $r;
    }

    public static function abilityRules(): array
    {
        $p = 'abilities.*.';

        return [$p.'activation' => 'sometimes|in:action,bonus_action,reaction,free',
            $p.'attack' => 'sometimes|nullable|array:ability,proficient,bonus', $p.'attack.ability' => 'required_with:'.$p.'attack|in:str,dex,con,int,wis,cha,spellcasting',
            $p.'attack.proficient' => 'required_with:'.$p.'attack|boolean', $p.'attack.bonus' => 'required_with:'.$p.'attack|integer|between:-100,100',
            $p.'save' => 'sometimes|nullable|array:ability,dc_source,dc,on_success,on_failure', $p.'save.ability' => 'required_with:'.$p.'save|in:str,dex,con,int,wis,cha',
            $p.'save.dc_source' => 'required_with:'.$p.'save|in:fixed,spellcasting', $p.'save.dc' => 'required_with:'.$p.'save|integer|between:0,999',
            $p.'save.on_success' => 'required_with:'.$p.'save|in:negates,half,full', $p.'save.on_failure' => 'required_with:'.$p.'save|in:full,none',
            $p.'damage_components' => 'sometimes|array|list|max:4', $p.'damage_components.*' => 'array:dice,type',
            $p.'damage_components.*.dice' => ['required', 'string', 'max:12', 'regex:'.DamageRoller::PATTERN],
            $p.'damage_components.*.type' => ['required', 'string', Rule::in(self::types())],
            $p.'condition_effects' => 'sometimes|array|list|max:4', $p.'condition_effects.*' => 'array:key,when,duration_mode,rounds',
            $p.'condition_effects.*.key' => ['required', 'string', Rule::in(array_keys(app(CharacterCatalog::class)->entries('conditions')))],
            $p.'condition_effects.*.when' => 'required|in:hit,failed_save,successful_save,always',
            $p.'condition_effects.*.duration_mode' => ['required', Rule::in(AppliedConditions::DURATIONS)],
            $p.'condition_effects.*.rounds' => 'sometimes|integer|between:1,100'];
    }
}
