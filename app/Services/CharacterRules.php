<?php

namespace App\Services;

use App\Models\Character;

/** Bounded static arithmetic. Stored bases are never overwritten by derived totals. */
class CharacterRules
{
    public const ABILITIES = ['str' => 'Сила', 'dex' => 'Ловкость', 'con' => 'Телосложение', 'int' => 'Интеллект', 'wis' => 'Мудрость', 'cha' => 'Харизма'];

    public const SKILLS = [
        'athletics' => ['Атлетика', 'str'], 'acrobatics' => ['Акробатика', 'dex'],
        'sleight_of_hand' => ['Ловкость рук', 'dex'], 'stealth' => ['Скрытность', 'dex'],
        'arcana' => ['Магия', 'int'], 'history' => ['История', 'int'],
        'investigation' => ['Анализ', 'int'], 'nature' => ['Природа', 'int'], 'religion' => ['Религия', 'int'],
        'animal_handling' => ['Уход за животными', 'wis'], 'insight' => ['Проницательность', 'wis'],
        'medicine' => ['Медицина', 'wis'], 'perception' => ['Внимательность', 'wis'], 'survival' => ['Выживание', 'wis'],
        'deception' => ['Обман', 'cha'], 'intimidation' => ['Запугивание', 'cha'],
        'performance' => ['Выступление', 'cha'], 'persuasion' => ['Убеждение', 'cha'],
    ];

    public function canonical(string $key): string
    {
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
        return ['scores' => array_fill_keys(array_keys(self::ABILITIES), 10), 'proficiency_bonus' => 2,
            'skills' => array_map(fn ($s) => ['ability' => $s[1], 'proficient' => false, 'expertise' => false, 'bonus' => 0], self::SKILLS),
            'saves' => array_fill_keys(array_keys(self::ABILITIES), ['proficient' => false, 'bonus' => 0]), 'spellcasting_ability' => null];
    }

    /** Conservative conversion: preserve familiar legacy totals as explicit additional bonuses. */
    public function suggestion(Character $character): array
    {
        $rules = $this->defaults();
        foreach ($this->rawChecks($character) as $stat) {
            $key = $this->canonical($stat['key']);
            if (isset($rules['skills'][$key])) {
                $rules['skills'][$key]['bonus'] = $stat['modifier'];
            } elseif (str_starts_with($key, 'save_') && isset($rules['saves'][substr($key, 5)])) {
                $rules['saves'][substr($key, 5)]['bonus'] = $stat['modifier'];
            } elseif (isset($rules['scores'][$key])) {
                // A modifier does not identify a unique score; choose the even score.
                $rules['scores'][$key] = max(1, min(30, 10 + 2 * $stat['modifier']));
            }
        }

        // Skill/save totals are preserved even if an ability modifier was also present.
        foreach ($this->rawChecks($character) as $stat) {
            $key = $this->canonical($stat['key']);
            if (isset($rules['skills'][$key])) {
                $rules['skills'][$key]['bonus'] -= $this->abilityModifier($rules['scores'][$rules['skills'][$key]['ability']]);
            } elseif (str_starts_with($key, 'save_') && isset($rules['saves'][substr($key, 5)])) {
                $rules['saves'][substr($key, 5)]['bonus'] -= $this->abilityModifier($rules['scores'][substr($key, 5)]);
            }
        }

        return $rules;
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
            $amount = in_array($key, ['ac', 'speed']) ? ($mods[$key] ?? 0) : array_sum(array_filter($mods['checks'] ?? [], fn ($k) => ($character->rules ? $this->canonical($k) : $k) === $key, ARRAY_FILTER_USE_KEY));
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
        $rules = $character->rules;
        $parts = [];
        $meta = [];
        $label = null;
        $isSave = str_starts_with($key, 'save_') && isset(self::ABILITIES[substr($key, 5)]);
        if ($rules && (isset(self::ABILITIES[$key]) || isset(self::SKILLS[$key]) || $isSave || $key === 'spell_attack')) {
            $config = $rules['skills'][$key] ?? $rules['saves'][substr($key, 5)] ?? null;
            $ability = isset(self::ABILITIES[$key]) ? $key : ($key === 'spell_attack' ? $rules['spellcasting_ability'] : ($config['ability'] ?? substr($key, 5)));
            if (! isset(self::ABILITIES[$ability ?? ''])) {
                return null;
            }
            $label = self::SKILLS[$key][0] ?? ($key === 'spell_attack' ? 'Атака заклинанием' : ((str_starts_with($key, 'save_') ? 'Спасбросок: ' : '').self::ABILITIES[$ability]));
            $parts[] = ['source' => 'ability', 'label' => self::ABILITIES[$ability], 'value' => $this->abilityModifier($rules['scores'][$ability])];
            // A bare ability attack may opt into proficiency. Skills/saves own their proficiency.
            $rank = $key === 'spell_attack' ? 1 : (($config['expertise'] ?? false) ? 2 : ((isset(self::ABILITIES[$key]) ? $proficient : ($config['proficient'] ?? false)) ? 1 : 0));
            if ($rank) {
                $parts[] = ['source' => 'proficiency', 'label' => $rank === 2 ? 'Компетентность' : 'Владение', 'value' => $rank * $rules['proficiency_bonus']];
            }
            if ($config['bonus'] ?? 0) {
                $parts[] = ['source' => 'additional', 'label' => 'Дополнительный бонус', 'value' => $config['bonus']];
            }
            $meta = ['ability' => $ability, 'proficient' => $rank > 0, 'expertise' => $rank === 2];
            // Equipment affecting an ability contributes to its skills, saves and spell attack.
            if ($ability !== $key) {
                $parts = [...$parts, ...$this->equipment($character, $ability)];
            }
        } else {
            $legacy = collect($this->rawChecks($character))->first(fn ($s) => $s['key'] === $requested)
                ?? collect($this->rawChecks($character))->first(fn ($s) => $this->canonical($s['key']) === $key);
            if (! $legacy) {
                return null;
            }
            $label = $legacy['label'];
            $parts[] = ['source' => 'custom', 'label' => $label, 'value' => $legacy['modifier']];
        }
        $parts = [...$parts, ...$this->equipment($character, $rules ? $key : $legacy['key'])];
        if ($bonus) {
            $parts[] = ['source' => 'action_bonus', 'label' => 'Бонус действия', 'value' => $bonus];
        }

        return $this->total($requested, $label, $parts, $meta);
    }

    public function checks(Character $character): array
    {
        $keys = array_column($this->rawChecks($character), 'key');
        if ($character->rules) {
            $keys = [...array_keys(self::ABILITIES), ...array_keys(self::SKILLS), ...array_map(fn ($k) => 'save_'.$k, array_keys(self::ABILITIES)), ...$keys];
            if ($character->rules['spellcasting_ability']) {
                $keys[] = 'spell_attack';
            }
        }

        $checks = array_values(array_filter(array_map(fn ($k) => $this->stat($character, $k), array_unique($keys))));

        return $checks;
    }

    public function core(Character $character, string $key, mixed $base): mixed
    {
        return $base === null ? null : max(0, min($key === 'ac' ? 99 : 999, $base + array_sum(array_column($this->equipment($character, $key), 'value'))));
    }

    public function derived(Character $character): array
    {
        $checks = $this->checks($character);
        $spell = $character->rules ? $this->stat($character, 'spell_attack') : null;

        return ['hp' => $character->hp, 'maxHp' => $character->max_hp, 'ac' => $character->ac, 'speed' => $character->speed,
            'proficiencyBonus' => $character->rules['proficiency_bonus'] ?? null, 'checks' => $checks,
            'spellcasting' => $spell ? ['ability' => $character->rules['spellcasting_ability'], 'attackBonus' => $spell['modifier'], 'saveDc' => 8 + $spell['modifier'], 'breakdown' => $spell['breakdown']] : null,
            'coreBreakdown' => ['ac' => $this->equipment($character, 'ac'), 'speed' => $this->equipment($character, 'speed')]];
    }

    public static function validation(): array
    {
        $abilities = implode(',', array_keys(self::ABILITIES));
        $rules = ['rules' => 'sometimes|nullable|array:scores,proficiency_bonus,skills,saves,spellcasting_ability',
            'rules.scores' => 'required_with:rules|array:'.$abilities, 'rules.proficiency_bonus' => 'required_with:rules|integer|between:0,20',
            'rules.skills' => 'required_with:rules|array:'.implode(',', array_keys(self::SKILLS)), 'rules.saves' => 'required_with:rules|array:'.$abilities,
            'rules.spellcasting_ability' => 'present_with:rules.scores|nullable|in:'.$abilities];
        foreach (array_keys(self::ABILITIES) as $key) {
            $rules['rules.scores.'.$key] = 'required_with:rules|integer|between:1,30';
            $rules['rules.saves.'.$key] = 'required_with:rules|array:proficient,bonus';
            $rules['rules.saves.'.$key.'.proficient'] = 'required_with:rules|boolean';
            $rules['rules.saves.'.$key.'.bonus'] = 'required_with:rules|integer|between:-100,100';
        }
        foreach (array_keys(self::SKILLS) as $key) {
            $rules['rules.skills.'.$key] = 'required_with:rules|array:ability,proficient,expertise,bonus';
            $rules['rules.skills.'.$key.'.ability'] = 'required_with:rules|in:'.$abilities;
            $rules['rules.skills.'.$key.'.proficient'] = 'required_with:rules|boolean';
            $rules['rules.skills.'.$key.'.expertise'] = 'required_with:rules|boolean';
            $rules['rules.skills.'.$key.'.bonus'] = 'required_with:rules|integer|between:-100,100';
        }

        return $rules;
    }
}
