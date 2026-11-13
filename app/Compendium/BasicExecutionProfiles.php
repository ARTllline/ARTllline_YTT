<?php

namespace App\Compendium;

use App\Compendium\Unified\UnifiedReview;
use App\Items\ItemRules;
use App\Models\ItemDefinition;
use App\Spells\SpellProjection;

/** Versioned, bounded profiles. Neither names nor reference prose grant execution. */
class BasicExecutionProfiles
{
    public const IDS = ['longsword', 'potion_of_healing', 'cure-wounds'];

    public static function item(string $id): array
    {
        abort_unless(in_array($id, ['longsword', 'potion_of_healing'], true), 422);

        return ItemRules::fromCompendium(['key' => $id, 'category' => $id === 'longsword' ? 'weapon' : 'adventuring_gear',
            'damage' => ['expression' => '1d8', 'damage_type' => 'slashing'], 'weapon_properties' => ['versatile'], 'weapon_mastery' => 'sap',
            'equipment_categories' => ['martial_weapons', 'melee_weapons'], 'range' => ['normal' => 5, 'long' => null],
            'two_handed_damage' => ['damage_dice' => '1d10']]);
    }

    public static function spell(): array
    {
        return app(SpellProjection::class)->ability(['source_key' => 'cure-wounds', 'name' => 'Cure Wounds', 'description' => '',
            'spell_level' => 1, 'school' => 'abjuration', 'classes' => ['bard', 'cleric', 'druid', 'paladin', 'ranger'],
            'casting_time' => 'Action', 'range' => ['kind' => 'touch'], 'ritual' => false, 'concentration' => false,
            'duration' => 'Instantaneous', 'components' => ['V', 'S'], 'material' => null, 'higher_level' => null], 0);
    }

    private static function abilityMechanics(array $a): array
    {
        foreach (['id', 'name', 'description', 'icon', 'sort_order', 'enabled', 'costs'] as $key) {
            unset($a[$key]);
        }
        foreach (['content', 'source_entry_id', 'reference', 'known', 'prepared', 'available', 'manual_allowed', 'reasons', 'classes', 'school'] as $key) {
            unset($a['spell'][$key]);
        }

        // Validation may materialize empty optional collections.
        return array_filter($a, fn ($v) => $v !== null && $v !== []);
    }

    private static function itemMechanics(array $d): array
    {
        $g = $d['gameplay'] ?? [];
        unset($g['source_key']);
        if (isset($g['weapon']['range']['unit'])) {
            unset($g['weapon']['range']['unit']);
        }
        if (isset($g['use']['ability'])) {
            $g['use']['ability'] = self::abilityMechanics($g['use']['ability']);
        }

        return ['category' => $d['category'], 'equipment_slots' => $d['equipment_slots'], 'modifiers' => $d['modifiers'] ?? [],
            'use_ability_id' => $d['use_ability_id'] ?? null, 'gameplay' => $g];
    }

    public static function reference(string $id): array
    {
        $mechanics = $id === 'cure-wounds' ? self::abilityMechanics(self::spell()) : self::itemMechanics(self::item($id));

        return ['id' => $id, 'checksum' => UnifiedReview::digest(['contract' => 'content-09b-v1', 'rules' => 'SRD-5.2.1', 'mechanics' => $mechanics,
            'confirmation' => 'gm', 'mastery' => 'manual'])];
    }

    public static function identify(ItemDefinition|array $source): ?string
    {
        if ($source instanceof ItemDefinition) {
            $id = $source->gameplay['source_key'] ?? null;
            if (! in_array($id, ['longsword', 'potion_of_healing'], true)) {
                return null;
            }
            $actual = self::itemMechanics($source->toArray());
            $expected = self::itemMechanics(self::item($id));
        } else {
            $id = 'cure-wounds';
            $actual = self::abilityMechanics($source);
            $expected = self::abilityMechanics(self::spell());
        }

        return UnifiedReview::digest($actual) === UnifiedReview::digest($expected) ? $id : null;
    }

    public static function allowed(ItemDefinition|array $source): bool
    {
        $id = self::identify($source);
        $content = $source instanceof ItemDefinition ? $source->content : ($source['spell']['content'] ?? []);

        return $id && data_get($content, 'gates.execute') === true && ($content['execution_profile'] ?? null) === self::reference($id);
    }
}
