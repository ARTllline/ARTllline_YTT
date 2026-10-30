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
    ability: AbilityKey;
    proficient: boolean;
    expertise: boolean;
    bonus: number;
}
export interface CharacterRules {
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
    key: string;
    label: string;
    modifier: number;
    breakdown: ModifierPart[];
    ability?: AbilityKey;
    proficient?: boolean;
    expertise?: boolean;
}
export interface DerivedCharacter {
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
    } | null;
    coreBreakdown: { ac: ModifierPart[]; speed: ModifierPart[] };
}
export const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}`;
export const breakdownLabel = (parts: ModifierPart[]) =>
    parts.map((p) => `${p.label} ${signed(p.value)}`).join(' · ');
