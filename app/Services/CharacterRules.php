<?php

namespace App\Services;

use App\Combat\ExhaustionRules;
use App\Items\ItemRules;
use App\Models\Character;
use App\Spells\SpellEffects;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Sole authority for Character arithmetic. Stored scores/bases never contain final totals. */
class CharacterRules
{
    public const ABILITIES = ['str' => 'Сила', 'dex' => 'Ловкость', 'con' => 'Телосложение', 'int' => 'Интеллект', 'wis' => 'Мудрость', 'cha' => 'Харизма'];

    public const CORE_MODIFIERS = ['ac', 'speed', 'spell_attack', 'spell_save_dc'];

    public function catalog(): CharacterCatalog
    {
        return app(CharacterCatalog::class);
    }

    public function canonical(string $key): string
    {
        $key = str_replace('-', '_', strtolower($key));
        $key = ['strength' => 'str', 'dexterity' => 'dex', 'constitution' => 'con', 'intelligence' => 'int', 'wisdom' => 'wis', 'charisma' => 'cha',
            'sleightofhand' => 'sleight_of_hand', 'animalhandling' => 'animal_handling'][$key] ?? $key;
        foreach (array_keys(self::ABILITIES) as $ability) {
            if (in_array($key, [$ability.'_save', 'saving_throw_'.$ability])) {
                return 'save_'.$ability;
            }
        }

        return $key;
    }

    public function defaults(): array
    {
        return ['schema_version' => 2, 'scores' => array_fill_keys(array_keys(self::ABILITIES), 10), 'proficiency_bonus' => 2,
            'skills' => array_map(fn ($s) => ['compendium_entry_id' => $s['compendium_entry_id'], 'proficient' => false, 'expertise' => false, 'bonus' => 0], $this->catalog()->skills()),
            'saves' => array_fill_keys(array_keys(self::ABILITIES), ['proficient' => false, 'bonus' => 0]),
            'modifiers' => array_fill_keys(self::CORE_MODIFIERS, 0), 'spellcasting_ability' => null];
    }

    /** Read compatibility projection; persisted only on an explicit GM save. */
    public function state(Character $character): ?array
    {
        $stored = $character->rules;
        if (! $stored) {
            return null;
        }
        $r = array_replace($this->defaults(), $stored);
        $r['scores'] = array_replace(array_fill_keys(array_keys(self::ABILITIES), 10), $stored['scores'] ?? []);
        $r['saves'] = array_replace(array_fill_keys(array_keys(self::ABILITIES), ['proficient' => false, 'bonus' => 0]), $stored['saves'] ?? []);
        $r['schema_version'] = 2;
        $r['modifiers'] = array_replace(array_fill_keys(self::CORE_MODIFIERS, 0), $stored['modifiers'] ?? []);
        $r['skills'] = [];
        foreach ($this->catalog()->skills() as $key => $definition) {
            $old = $stored['skills'][$key] ?? [];
            $bonus = (int) ($old['bonus'] ?? 0);
            // Earlier YTT allowed arbitrary skill abilities. Preserve the current
            // total as a visible bonus when moving to the canonical ability.
            if (($stored['schema_version'] ?? 1) < 2 && isset(self::ABILITIES[$old['ability'] ?? '']) && $old['ability'] !== $definition['ability']) {
                $bonus += $this->abilityModifier($r['scores'][$old['ability']]) - $this->abilityModifier($r['scores'][$definition['ability']]);
            }
            $r['skills'][$key] = ['compendium_entry_id' => $definition['compendium_entry_id'],
                'proficient' => (bool) ($old['proficient'] ?? false), 'expertise' => (bool) ($old['expertise'] ?? false), 'bonus' => $bonus];
        }

        return $r;
    }

    public function prepare(array &$data): void
    {
        if (! isset($data['rules'])) {
            return;
        }
        if (! $this->catalog()->ready()) {
            throw ValidationException::withMessages(['rules' => 'Сначала синхронизируйте 18 навыков SRD через compendium:sync srd-2024 --type=skills.']);
        }
        $draft = new Character;
        $draft->rules = $data['rules'];
        $data['rules'] = $this->state($draft);
    }

    public function suggestion(Character $character): ?array
    {
        if (! $this->catalog()->ready()) {
            return null;
        }
        $r = $this->defaults();
        $legacy = [];
        foreach ($this->rawChecks($character) as $stat) {
            $legacy[$this->canonical($stat['key'])] ??= $stat;
        }
        foreach ($legacy as $key => $stat) {
            if (isset($r['scores'][$key])) {
                $r['scores'][$key] = max(1, min(30, 10 + 2 * $stat['modifier']));
            }
        }
        foreach ($legacy as $key => $stat) {
            if (isset($r['skills'][$key])) {
                $ability = $this->catalog()->skills()[$key]['ability'];
                $r['skills'][$key]['bonus'] = $stat['modifier'] - $this->abilityModifier($r['scores'][$ability]);
            } elseif (str_starts_with($key, 'save_') && isset($r['saves'][substr($key, 5)])) {
                $r['saves'][substr($key, 5)]['bonus'] = $stat['modifier'] - $this->abilityModifier($r['scores'][substr($key, 5)]);
            }
        }

        return $r;
    }

    public function abilityModifier(int $score): int
    {
        return (int) floor(($score - 10) / 2);
    }

    private function rawChecks(Character $character): array
    {
        return json_decode($character->getAttributes()['check_stats'] ?? '[]', true) ?? [];
    }

    public function equipment(Character $character, string $key): array
    {
        if (! $character->exists) {
            return [];
        }
        $character->loadMissing('inventory.definition');
        $parts = [];
        foreach ($character->inventory as $item) {
            if (! $item->equipped_slot || $item->quantity < 1) {
                continue;
            }
            $mods = $item->definition->modifiers ?? [];
            // checks.str is a raw STR check bonus, not an ability score increase.
            $amount = in_array($key, ['ac', 'speed', 'weapon_attack', 'weapon_damage']) ? ($mods[$key] ?? 0) : array_sum(array_filter($mods['checks'] ?? [], fn ($k) => $this->canonical($k) === $key, ARRAY_FILTER_USE_KEY));
            if ($amount) {
                $parts[] = ['source' => 'equipment', 'label' => $item->definition->name, 'value' => $amount, 'itemId' => (string) $item->id];
            }
        }

        return $parts;
    }

    private function total(string $key, string $label, array $parts, array $metadata = []): array
    {
        return ['key' => $key, 'label' => $label, 'modifier' => array_sum(array_column($parts, 'value')), 'breakdown' => $parts] + $metadata;
    }

    public function stat(Character $character, string $requested, bool $proficient = false, int $bonus = 0): ?array
    {
        $key = $this->canonical($requested);
        $r = $this->state($character);
        $skills = $this->catalog()->skills();
        $save = str_starts_with($key, 'save_') && isset(self::ABILITIES[substr($key, 5)]);
        $spell = in_array($key, ['spell_attack', 'spell_save_dc']);
        $parts = $meta = [];
        if ($r && (isset(self::ABILITIES[$key]) || isset($skills[$key]) || $save || $spell)) {
            $config = $r['skills'][$key] ?? ($save ? $r['saves'][substr($key, 5)] : []);
            $ability = isset(self::ABILITIES[$key]) ? $key : ($spell ? $r['spellcasting_ability'] : ($skills[$key]['ability'] ?? substr($key, 5)));
            if (! isset(self::ABILITIES[$ability ?? ''])) {
                return null;
            }
            $label = $skills[$key]['name'] ?? ($spell ? ($key === 'spell_attack' ? 'Атака заклинанием' : 'Сл спасброска заклинания') : (($save ? 'Спасбросок: ' : '').self::ABILITIES[$ability]));
            if ($key === 'spell_save_dc') {
                $parts[] = ['source' => 'base', 'label' => 'База Сл', 'value' => 8];
            }
            $parts[] = ['source' => 'ability', 'label' => self::ABILITIES[$ability], 'value' => $this->abilityModifier($r['scores'][$ability])];
            $rank = $spell ? 1 : (($config['expertise'] ?? false) ? 2 : ((isset(self::ABILITIES[$key]) ? $proficient : ($config['proficient'] ?? false)) ? 1 : 0));
            if ($rank) {
                $parts[] = ['source' => 'proficiency', 'label' => 'Владение', 'value' => $r['proficiency_bonus']];
            }
            if ($rank === 2) {
                $parts[] = ['source' => 'expertise', 'label' => 'Компетентность', 'value' => $r['proficiency_bonus']];
            }
            $custom = ($config['bonus'] ?? 0) + ($r['modifiers'][$key] ?? 0);
            if ($custom) {
                $parts[] = ['source' => 'custom', 'label' => 'Дополнительный бонус', 'value' => $custom];
            }
            $meta = ['ability' => $ability, 'proficient' => $rank > 0, 'expertise' => $rank === 2]
                + (isset($skills[$key]) ? ['compendiumEntryId' => $skills[$key]['compendium_entry_id']] : []);
        } else {
            if ($r && isset(($character->rules['skills'] ?? [])[$key])) {
                return null;
            }
            $legacy = collect($this->rawChecks($character))->first(fn ($s) => $s['key'] === $requested)
                ?? collect($this->rawChecks($character))->first(fn ($s) => $this->canonical($s['key']) === $key);
            if (! $legacy) {
                return null;
            }
            $label = $legacy['label'];
            $parts[] = ['source' => 'custom', 'label' => $label, 'value' => $legacy['modifier']];
        }
        $parts = [...$parts, ...$this->equipment($character, $key), ...app(SpellEffects::class)->flat($character, $key)];
        if ($bonus) {
            $parts[] = ['source' => 'custom', 'label' => 'Бонус действия', 'value' => $bonus];
        }

        if ($key !== 'spell_save_dc') {
            $parts = [...$parts, ...app(ExhaustionRules::class)->parts($character)];
        }

        return $this->total($key, $label, $parts, $meta);
    }

    public function checks(Character $character): array
    {
        $keys = array_column($this->rawChecks($character), 'key');
        if ($character->rules) {
            $keys = [...array_keys(self::ABILITIES), ...array_keys($this->catalog()->skills()), ...array_map(fn ($k) => 'save_'.$k, array_keys(self::ABILITIES)), ...$keys];
            if ($character->rules['spellcasting_ability'] ?? null) {
                $keys[] = 'spell_attack';
            }
        }
        $keys = array_unique(array_map($this->canonical(...), $keys));

        return array_values(array_filter(array_map(fn ($k) => $this->stat($character, $k), $keys)));
    }

    public function weaponStat(Character $c, string $ability, bool $proficient, int $bonus = 0, bool $damage = false): array
    {
        $r = $this->state($c);
        $parts = [];
        if ($r) {
            $parts[] = ['source' => 'ability', 'label' => self::ABILITIES[$ability], 'value' => $this->abilityModifier($r['scores'][$ability])];
        } else {
            $legacy = $this->stat($c, $ability);
            abort_unless($legacy, 422, 'Настройте характеристику оружия у персонажа.');
            // A weapon damage modifier is not a D20 Test; reattach Exhaustion only for its attack.
            $parts = array_values(array_filter($legacy['breakdown'], fn ($p) => $p['source'] !== 'exhaustion'));
        }
        if (! $damage && $proficient) {
            abort_unless($r, 422, 'Настройте бонус владения в характеристиках персонажа.');
            $parts[] = ['source' => 'proficiency', 'label' => 'Владение оружием', 'value' => $r['proficiency_bonus']];
        }
        $parts = [...$parts, ...$this->equipment($c, $damage ? 'weapon_damage' : 'weapon_attack')];
        if ($bonus) {
            $parts[] = ['source' => 'custom', 'label' => 'Бонус оружия', 'value' => $bonus];
        }

        if (! $damage) {
            $parts = [...$parts, ...app(ExhaustionRules::class)->parts($c)];
        }

        return $this->total($ability, self::ABILITIES[$ability], $parts, ['proficient' => $proficient]);
    }

    public function coreStat(Character $character, string $key, mixed $base): array
    {
        $base = $base === null ? null : (int) $base;
        $parts = [['source' => 'base', 'label' => $key === 'ac' ? 'Базовая AC' : 'Базовая скорость', 'value' => $base ?? 0]];
        $armor = app(ItemRules::class)->armorParts($character, $key);
        if ($armor['base'] !== null) {
            $parts = $armor['base'];
            $base = 0;
        }
        $parts = [...$parts, ...$armor['parts']];
        $bonus = $character->rules['modifiers'][$key] ?? 0;
        if ($bonus) {
            $parts[] = ['source' => 'custom', 'label' => 'Дополнительный бонус', 'value' => $bonus];
        }
        $parts = [...$parts, ...$this->equipment($character, $key), ...app(SpellEffects::class)->flat($character, $key)];
        if ($key === 'speed') {
            $parts = [...$parts, ...app(ExhaustionRules::class)->parts($character, 'speed')];
        }
        $total = $base === null ? null : max(0, min($key === 'ac' ? 99 : 999, (int) array_sum(array_column($parts, 'value'))));

        return ['value' => $total, 'breakdown' => $parts, 'unit' => $key === 'speed' ? 'ft' : null];
    }

    public function core(Character $character, string $key, mixed $base): mixed
    {
        return $this->coreStat($character, $key, $base)['value'];
    }

    public function derived(Character $character): array
    {
        $r = $this->state($character);
        $attack = $r ? $this->stat($character, 'spell_attack') : null;
        $dc = $r ? $this->stat($character, 'spell_save_dc') : null;
        $ac = $this->coreStat($character, 'ac', $character->getAttributes()['ac'] ?? null);
        $speed = $this->coreStat($character, 'speed', $character->getAttributes()['speed'] ?? null);

        return ['hp' => $character->hp, 'maxHp' => $character->max_hp, 'hpSource' => 'character',
            'ac' => $ac['value'], 'speed' => $speed['value'], 'speedUnit' => 'ft',
            'abilityModifiers' => $r ? array_map($this->abilityModifier(...), $r['scores']) : [],
            'proficiencyBonus' => $r['proficiency_bonus'] ?? null, 'checks' => $this->checks($character),
            'catalog' => ['ready' => $this->catalog()->ready(), 'skills' => array_values($this->catalog()->skills())],
            'spellcasting' => $attack ? ['ability' => $r['spellcasting_ability'], 'attackBonus' => $attack['modifier'], 'saveDc' => $dc['modifier'],
                'breakdown' => $attack['breakdown'], 'saveBreakdown' => $dc['breakdown']] : null,
            'coreBreakdown' => ['ac' => $ac['breakdown'], 'speed' => $speed['breakdown']]];
    }

    public static function validation(): array
    {
        $abilities = implode(',', array_keys(self::ABILITIES));
        $skills = app(CharacterCatalog::class)->skills();
        $rules = ['rules' => 'sometimes|nullable|array:schema_version,scores,proficiency_bonus,skills,saves,spellcasting_ability,modifiers',
            'rules.schema_version' => 'sometimes|integer|in:2',
            'rules.scores' => 'required_with:rules|array:'.$abilities, 'rules.proficiency_bonus' => 'required_with:rules|integer|between:0,20',
            'rules.skills' => 'required_with:rules|array'.($skills ? ':'.implode(',', array_keys($skills)) : ''),
            'rules.saves' => 'required_with:rules|array:'.$abilities,
            'rules.spellcasting_ability' => 'present_with:rules.scores|nullable|in:'.$abilities,
            'rules.modifiers' => 'sometimes|array:'.implode(',', self::CORE_MODIFIERS), 'rules.modifiers.*' => 'integer|between:-100,100'];
        foreach (array_keys(self::ABILITIES) as $key) {
            $rules['rules.scores.'.$key] = 'required_with:rules|integer|between:1,30';
            $rules['rules.saves.'.$key] = 'required_with:rules|array:proficient,bonus';
            $rules['rules.saves.'.$key.'.proficient'] = 'required_with:rules|boolean';
            $rules['rules.saves.'.$key.'.bonus'] = 'required_with:rules|integer|between:-100,100';
        }
        foreach ($skills as $key => $definition) {
            $rules['rules.skills.'.$key] = 'required_with:rules|array:ability,compendium_entry_id,proficient,expertise,bonus';
            $rules['rules.skills.'.$key.'.ability'] = 'sometimes|in:'.$abilities;
            $rules['rules.skills.'.$key.'.compendium_entry_id'] = ['sometimes', 'integer', Rule::in([$definition['compendium_entry_id']])];
            foreach (['proficient', 'expertise'] as $field) {
                $rules['rules.skills.'.$key.'.'.$field] = 'required_with:rules|boolean';
            }
            $rules['rules.skills.'.$key.'.bonus'] = 'required_with:rules|integer|between:-100,100';
        }

        return $rules;
    }
}
