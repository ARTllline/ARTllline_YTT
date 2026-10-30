import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RulesSummary } from './RulesSummary';
import { RulesEditor } from './RulesEditor';
import type { Character } from '../tabletop/types/scene';
import type { CharacterRules } from './rules';
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
