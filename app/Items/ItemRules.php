<?php

namespace App\Items;

use App\Combat\CombatMetadata;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\ItemDefinition;
use App\Models\Token;
use App\Services\CharacterGameplay;
use App\Services\CharacterRules;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

class ItemRules
{
    public const CATEGORIES = ['weapon', 'armor', 'shield', 'ammunition', 'consumable', 'adventuring_gear', 'other', 'scroll', 'trinket'];

    public static function fromCompendium(array $n): array
    {
        $cat = $n['category'];
        $armor = $n['armor'] ?? null;
        $shield = ($armor['category'] ?? null) === 'shield';
        $ammo = in_array('ammunition', $n['equipment_categories'] ?? []);
        $p = $n['weapon_properties'] ?? [];
        $gameplay = ['source_key' => $n['key'] ?? null];
        if ($cat === 'weapon') {
            $gameplay['weapon'] = ['dice' => $n['damage']['expression'] ?? null, 'damage_type' => $n['damage']['damage_type'] ?? null, 'properties' => $p, 'mastery' => $n['weapon_mastery'] ?? null, 'category' => in_array('martial_weapons', $n['equipment_categories']) ? 'martial' : 'simple', 'kind' => in_array('ranged_weapons', $n['equipment_categories']) ? 'ranged' : 'melee', 'range' => $n['range'] ?? null, 'throw_range' => $n['throw_range'] ?? null, 'versatile_dice' => $n['two_handed_damage']['damage_dice'] ?? null, 'ammunition' => $n['ammunition'] ?? null, 'attack_bonus' => 0, 'damage_bonus' => 0];
        }
        if ($armor) {
            $gameplay['armor'] = $armor;
        }
        if ($ammo) {
            $gameplay['ammunition'] = $n['key'];
        }
        $potion = ($n['key'] ?? '') === 'potion_of_healing';
        if ($potion) {
            $gameplay['use'] = ['consume' => true, 'ability' => ItemActions::potionAbility()];
        }

        return ['category' => $shield ? 'shield' : ($ammo ? 'ammunition' : ($cat === 'weapon' ? 'weapon' : ($armor ? 'armor' : ($potion ? 'consumable' : 'adventuring_gear')))), 'gameplay' => $gameplay, 'max_stack' => $ammo ? 99 : ($potion ? 20 : 1), 'equipment_slots' => $cat === 'weapon' ? ['main_hand'] : ($shield ? ['off_hand'] : ($armor ? ['armor'] : []))];
    }

    public static function validation(): array
    {
        return ['gameplay' => 'sometimes|nullable|array:source_key,weapon,armor,ammunition,use', 'gameplay.source_key' => 'sometimes|nullable|string|max:80',
            'gameplay.weapon' => 'sometimes|nullable|array:dice,damage_type,properties,mastery,category,kind,range,throw_range,versatile_dice,ammunition,attack_bonus,damage_bonus',
            'gameplay.weapon.dice' => ['required_with:gameplay.weapon', 'string', 'regex:/^(?:([1-9]|1[0-9]|20)d(4|6|8|10|12|20)|[1-9][0-9]?)$/'],
            'gameplay.weapon.damage_type' => ['required_with:gameplay.weapon', Rule::in(CombatMetadata::types())],
            'gameplay.weapon.kind' => 'required_with:gameplay.weapon|in:melee,ranged', 'gameplay.weapon.category' => 'required_with:gameplay.weapon|in:simple,martial,custom',
            'gameplay.weapon.properties' => 'present_with:gameplay.weapon|array|list|max:16', 'gameplay.weapon.properties.*' => 'string|max:48|regex:/^[a-z][a-z0-9_]*$/|distinct',
            'gameplay.weapon.mastery' => 'sometimes|nullable|string|max:48', 'gameplay.weapon.versatile_dice' => ['sometimes', 'nullable', 'string', 'regex:/^([1-9]|1[0-9]|20)d(4|6|8|10|12|20)$/'],
            'gameplay.weapon.range' => 'sometimes|nullable|array:normal,long,unit', 'gameplay.weapon.range.normal' => 'required_with:gameplay.weapon.range|numeric|between:0,10000', 'gameplay.weapon.range.long' => 'sometimes|nullable|numeric|between:0,10000', 'gameplay.weapon.range.unit' => 'sometimes|in:ft',
            'gameplay.weapon.throw_range' => 'sometimes|nullable|array:normal,long', 'gameplay.weapon.throw_range.normal' => 'required_with:gameplay.weapon.throw_range|numeric|between:1,10000', 'gameplay.weapon.throw_range.long' => 'sometimes|nullable|numeric|between:1,10000',
            'gameplay.weapon.ammunition' => 'sometimes|nullable|string|max:80|regex:/^[a-z][a-z0-9_]*$/', 'gameplay.weapon.attack_bonus' => 'sometimes|integer|between:-20,20', 'gameplay.weapon.damage_bonus' => 'sometimes|integer|between:-20,20',
            'gameplay.armor' => 'sometimes|nullable|array:category,ac_semantics,base_ac,ac_bonus,add_dex,max_dex_bonus,strength_minimum,stealth_disadvantage',
            'gameplay.armor.category' => 'required_with:gameplay.armor|in:light_armor,medium_armor,heavy_armor,shield', 'gameplay.armor.ac_semantics' => 'required_with:gameplay.armor|in:base,bonus',
            'gameplay.armor.base_ac' => 'sometimes|nullable|integer|between:0,40', 'gameplay.armor.ac_bonus' => 'sometimes|nullable|integer|between:0,20', 'gameplay.armor.add_dex' => 'required_with:gameplay.armor|boolean', 'gameplay.armor.max_dex_bonus' => 'sometimes|nullable|integer|between:0,10', 'gameplay.armor.strength_minimum' => 'sometimes|nullable|integer|between:0,30', 'gameplay.armor.stealth_disadvantage' => 'sometimes|boolean',
            'gameplay.ammunition' => 'sometimes|nullable|string|max:80|regex:/^[a-z][a-z0-9_]*$/',
            'gameplay.use' => 'sometimes|nullable|array:ability,consume', 'gameplay.use.consume' => 'required_with:gameplay.use|boolean',
            'gameplay.use.ability' => 'required_with:gameplay.use|array'];
    }

    public function validateDefinition(ItemDefinition $d): void
    {
        $g = $d->gameplay ?? [];
        $w = $g['weapon'] ?? null;
        $a = $g['armor'] ?? null;
        if (isset($g['use'])) {
            $data = Validator::make(['abilities' => [$g['use']['ability']]], CharacterGameplay::rules())->validate();
            app(CharacterGameplay::class)->validate($d->campaign_id ? Campaign::findOrFail($d->campaign_id) : abort(422), $data, null);
            $g['use']['ability'] = $data['abilities'][0];
            $d->gameplay = $g;
        }
        abort_if($w && $d->category !== 'weapon', 422, 'Боевой профиль оружия требует категорию «Оружие».');
        abort_if($a && ! in_array($d->category, ['armor', 'shield']), 422, 'Выберите категорию брони или щита.');
        if ($w) {
            abort_if($d->equipment_slots !== ['main_hand'], 422, 'Боевое оружие занимает основную руку.');
            abort_if(in_array('ammunition', $w['properties']) && empty($w['ammunition']), 422, 'Укажите тип боеприпасов.');
            foreach (['range', 'throw_range'] as $r) {
                if (isset($w[$r])) {
                    abort_if(($w[$r]['long'] ?? $w[$r]['normal']) < $w[$r]['normal'], 422, 'Дальняя дистанция меньше обычной.');
                }
            }
        }
        if ($a) {
            abort_if($a['category'] === 'light_armor' && (! $a['add_dex'] || isset($a['max_dex_bonus'])), 422, 'Лёгкая броня добавляет весь модификатор Ловкости.');
            abort_if($a['category'] === 'medium_armor' && (! $a['add_dex'] || ($a['max_dex_bonus'] ?? null) !== 2), 422, 'Средняя броня добавляет Ловкость до +2.');
            abort_if(in_array($a['category'], ['heavy_armor', 'shield']) && $a['add_dex'], 422, 'Тяжёлая броня и щит не добавляют Ловкость.');
            $shield = $a['category'] === 'shield';
            abort_if($d->equipment_slots !== ($shield ? ['off_hand'] : ['armor']), 422, 'Броня занимает слот доспеха, щит — вторую руку.');
            abort_if($shield ? ($a['ac_bonus'] ?? null) === null : ($a['base_ac'] ?? null) === null, 422, 'Настройте защиту брони.');
        }
    }

    public function validateEquipment(Character $c): void
    {
        $items = $c->inventory()->with('definition')->where('quantity', '>', 0)->whereNotNull('equipped_slot')->get();
        foreach ($items as $i) {
            abort_unless(in_array($i->equipped_slot, $i->definition->equipment_slots, true), 422, 'Предмет не подходит слоту.');
            $w = $i->definition->gameplay['weapon'] ?? null;
            if ($w) {
                abort_if($i->equipped_slot !== 'main_hand', 422, 'Оружие требует основную руку.');
                $two = in_array('two_handed', $w['properties']);
                abort_if($two && $i->grip !== 'two', 422, 'Оружие требует две руки.');
                abort_if($i->grip === 'two' && ! $two && ! in_array('versatile', $w['properties']), 422, 'Это оружие не поддерживает хват двумя руками.');
                if ($i->grip === 'two') {
                    abort_if($items->contains('equipped_slot', 'off_hand'), 422, 'Освободите вторую руку для двуручного хвата.');
                }
            }
        }
    }

    public function armorParts(Character $c, string $key): array
    {
        $r = app(CharacterRules::class)->state($c);
        $c->loadMissing('inventory.definition');
        $parts = [];
        $base = null;
        foreach ($c->inventory as $i) {
            if (! $i->equipped_slot || $i->quantity < 1) {
                continue;
            }$a = $i->definition->gameplay['armor'] ?? null;
            if (! $a) {
                continue;
            }
            if ($key === 'ac') {
                if ($a['category'] === 'shield') {
                    $parts[] = ['source' => 'equipment', 'label' => $i->definition->name, 'value' => $a['ac_bonus'], 'itemId' => $i->id];
                } else {
                    abort_unless($r || ! $a['add_dex'], 422, 'Для брони с Ловкостью настройте характеристики персонажа.');
                    $dex = $r ? app(CharacterRules::class)->abilityModifier($r['scores']['dex']) : 0;
                    $base = [['source' => 'armor', 'label' => $i->definition->name, 'value' => $a['base_ac'], 'itemId' => $i->id]];
                    if ($a['add_dex']) {
                        $base[] = ['source' => 'ability', 'label' => 'Ловкость (броня)', 'value' => isset($a['max_dex_bonus']) ? min($dex, $a['max_dex_bonus']) : $dex];
                    }
                }
            } elseif ($key === 'speed' && $r && ($a['strength_minimum'] ?? 0) > $r['scores']['str']) {
                $parts[] = ['source' => 'armor', 'label' => $i->definition->name.' · недостаточно Силы', 'value' => -10, 'itemId' => $i->id];
            }
        }

        return ['base' => $base, 'parts' => $parts];
    }

    public function checkReasons(?Token $actor, ?string $stat): array
    {
        if (! $actor?->character_id || $stat !== 'stealth') {
            return [];
        }

        return $actor->character->inventory()->with('definition')->where('quantity', '>', 0)->whereNotNull('equipped_slot')->get()->filter(fn ($i) => $i->definition->gameplay['armor']['stealth_disadvantage'] ?? false)->map(fn ($i) => ['label' => $i->definition->name.' · Скрытность', 'visibility' => 'public', 'itemId' => $i->id])->values()->all();
    }
}
