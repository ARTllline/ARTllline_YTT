import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RulesSummary } from './RulesSummary';
import { RulesEditor } from './RulesEditor';
import type { Character } from '../tabletop/types/scene';
import type { CharacterRules } from './rules';
import { findCheck } from './rules';
const rules: CharacterRules = {
    scores: { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 18 },
    proficiency_bonus: 3,
    skills: { perception: { ability: 'wis', proficient: true, expertise: false, bonus: 0 } },
    saves: {
        str: { proficient: false, bonus: 0 },
        dex: { proficient: false, bonus: 0 },
        con: { proficient: false, bonus: 0 },
        int: { proficient: false, bonus: 0 },
        wis: { proficient: false, bonus: 0 },
        cha: { proficient: false, bonus: 0 },
    },
    spellcasting_ability: 'cha',
};
const character: Character = {
    id: '1',
    name: 'QA',
    portrait: null,
    ownerUserId: '2',
    kind: 'player_character',
    disposition: 'friendly',
    hp: 34,
    maxHp: 41,
    checkStats: [],
    rules,
    derived: {
        hp: 34,
        maxHp: 41,
        ac: 17,
        speed: 40,
        proficiencyBonus: 3,
        checks: [
            {
                key: 'perception',
                label: 'Внимательность',
                modifier: 42,
                ability: 'wis',
                proficient: true,
                expertise: false,
                breakdown: [{ source: 'equipment', label: 'Амулет', value: 1 }],
            },
        ],
        spellcasting: { ability: 'cha', attackBonus: 7, saveDc: 15, breakdown: [] },
        coreBreakdown: { ac: [], speed: [] },
    },
};
describe('Character rule presentation', () => {
    it('keeps old action aliases usable without publishing competing totals', () => {
        const checks = [
            { key: 'str', label: 'Strength', modifier: 3 },
            { key: 'save_wis', label: 'Wisdom save', modifier: 5 },
        ];
        expect(findCheck(checks, 'strength')?.modifier).toBe(3);
        expect(findCheck(checks, 'saving_throw_wis')?.modifier).toBe(5);
        expect(findCheck([{ key: 'strength', modifier: 8 }], 'str')?.modifier).toBe(8);
        expect(findCheck(checks, 'custom')).toBeUndefined();
    });
    it('uses canonical catalog names and abilities in the editor without an ability override control', () => {
        const derived = {
            ...character.derived!,
            abilityModifiers: { str: 3 },
            catalog: {
                ready: true,
                skills: [
                    {
                        key: 'perception',
                        name: 'Compendium Perception',
                        ability: 'wis' as const,
                        compendium_entry_id: 7,
                        source_id: 1,
                    },
                ],
            },
        };
        const html = renderToStaticMarkup(
            <RulesEditor character={character} derived={derived} onChange={() => {}} />,
        );
        expect(html).toContain('Compendium Perception');
        expect(html).toContain('WIS');
        expect(html).not.toContain('Характеристика: perception');
        expect(html).toContain('Дополнительный бонус: Сл заклинаний');
    });
    it('shows server totals verbatim, ownership rank and equipment provenance', () => {
        const html = renderToStaticMarkup(<RulesSummary character={character} />);
        expect(html).toContain('+42');
        expect(html).toContain('Владение');
        expect(html).toContain('Амулет +1');
        expect(html).toContain('+7');
        expect(html).toContain('15');
    });
    it('hides spellcasting for noncasters and retains legacy checks', () => {
        const custom = renderToStaticMarkup(
            <RulesSummary
                character={{
                    ...character,
                    derived: {
                        ...character.derived!,
                        checks: [
                            ...character.derived!.checks,
                            { key: 'save_luck', label: 'Удача', modifier: 5, breakdown: [] },
                        ],
                    },
                }}
            />,
        );
        expect(custom).toContain('Удача');
        expect(
            renderToStaticMarkup(
                <RulesSummary
                    character={{
                        ...character,
                        derived: { ...character.derived!, spellcasting: null },
                    }}
                />,
            ),
        ).not.toContain('Магия ·');
        const legacy = renderToStaticMarkup(
            <RulesSummary
                character={{
                    ...character,
                    rules: null,
                    checkStats: [{ key: 'custom', label: 'Особая проверка', modifier: -3 }],
                }}
            />,
        );
        expect(legacy).toContain('Особая проверка');
        expect(legacy).toContain('-3');
    });
    it('keeps migration explicit and provides labelled GM controls', () => {
        const legacy = renderToStaticMarkup(
            <RulesEditor
                character={{ ...character, rules: null, rulesSuggestion: rules }}
                onChange={() => {}}
            />,
        );
        expect(legacy).toContain('Настроить правила персонажа');
        const html = renderToStaticMarkup(
            <RulesEditor character={character} derived={character.derived} onChange={() => {}} />,
        );
        expect(html).toContain('perception: компетентность');
        expect(html).toContain('Бонус владения');
        expect(html).toContain('Бонус спасброска: Сила');
        expect(html).toContain('+42');
    });
});
