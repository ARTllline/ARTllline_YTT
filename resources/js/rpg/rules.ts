export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export const abilityLabels: Record<AbilityKey, string> = {
    str: 'Сила',
    dex: 'Ловкость',
    con: 'Телосложение',
    int: 'Интеллект',
    wis: 'Мудрость',
    cha: 'Харизма',
};
export interface SkillRule {
    ability?: AbilityKey;
    compendium_entry_id?: number;
    proficient: boolean;
    expertise: boolean;
    bonus: number;
}
export interface CharacterRules {
    schema_version?: 2;
    modifiers?: Partial<Record<'ac' | 'speed' | 'spell_attack' | 'spell_save_dc', number>>;
    scores: Record<AbilityKey, number>;
    proficiency_bonus: number;
    skills: Record<string, SkillRule>;
    saves: Record<AbilityKey, { proficient: boolean; bonus: number }>;
    spellcasting_ability: AbilityKey | null;
}
export interface ModifierPart {
    source: string;
    label: string;
    value: number;
    itemId?: string;
}
export interface DerivedCheck {
    compendiumEntryId?: number;
    key: string;
    label: string;
    modifier: number;
    breakdown: ModifierPart[];
    ability?: AbilityKey;
    proficient?: boolean;
    expertise?: boolean;
}
export interface DerivedCharacter {
    hpSource?: 'character';
    speedUnit?: 'ft';
    abilityModifiers?: Partial<Record<AbilityKey, number>>;
    catalog?: { ready: boolean; skills: SkillDefinition[] };
    hp: number;
    maxHp: number;
    ac: number | null;
    speed: number | null;
    proficiencyBonus: number | null;
    checks: DerivedCheck[];
    spellcasting: {
        ability: AbilityKey;
        attackBonus: number;
        saveDc: number;
        breakdown: ModifierPart[];
        saveBreakdown?: ModifierPart[];
    } | null;
    coreBreakdown: { ac: ModifierPart[]; speed: ModifierPart[] };
}
export interface SkillDefinition {
    key: string;
    name: string;
    ability: AbilityKey;
    compendium_entry_id: number;
    source_id: number;
}
export function canonicalStatKey(key: string) {
    key = key.toLowerCase().replaceAll('-', '_');
    key =
        (
            {
                strength: 'str',
                dexterity: 'dex',
                constitution: 'con',
                intelligence: 'int',
                wisdom: 'wis',
                charisma: 'cha',
                sleightofhand: 'sleight_of_hand',
                animalhandling: 'animal_handling',
            } as Record<string, string>
        )[key] ?? key;
    for (const ability of Object.keys(abilityLabels)) {
        if (key === `${ability}_save` || key === `saving_throw_${ability}`)
            return `save_${ability}`;
    }
    return key;
}
export function findCheck<T extends { key: string }>(
    checks: readonly T[] | undefined,
    key?: string | null,
) {
    return key
        ? (checks?.find((s) => s.key === key) ??
              checks?.find((s) => canonicalStatKey(s.key) === canonicalStatKey(key)))
        : undefined;
}
export const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}`;
export const breakdownLabel = (parts: ModifierPart[]) =>
    parts.map((p) => `${p.label} ${signed(p.value)}`).join(' · ');
