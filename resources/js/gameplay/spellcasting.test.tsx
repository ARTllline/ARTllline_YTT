import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    CastLevelChooser,
    ConcentrationHUD,
    SpellDetails,
    SpellSlots,
    type SpellcastingState,
} from './spellcasting';
import type { Ability } from './model';
import { RpgDragProvider } from '../rpg/RpgDrag';
import { SpellbookView } from '../rpg/SpellbookView';
import { createDemoScene } from '../tabletop/state/demoScene';
import type { Character } from '../tabletop/types/scene';
const spell: Ability = {
    id: 'spell',
    name: 'Fireball',
    icon: 'flame',
    description: 'Fire',
    category: 'effect',
    target: 'point',
    check: null,
    costs: [],
    enabled: true,
    sort_order: 0,
    spell: {
        level: 3,
        school: 'evocation',
        classes: ['wizard'],
        known: true,
        prepared: true,
        coverage: 'PARTIAL',
        reasons: ['Ignition is manual'],
        components: ['V', 'S', 'M'],
        material: 'bat guano and sulfur',
        duration_text: 'Instantaneous',
        reference: 'Complete SRD reference',
    },
    casting: {
        available: true,
        reason: '',
        levels: [
            { level: 3, current: 1, damage: '8d6' },
            { level: 4, current: 2, damage: '9d6' },
        ],
    },
};
const state: SpellcastingState = {
    slots: { 3: { current: 1, max: 2 }, 4: { current: 0, max: 1 } },
    cantrip_tier: 1,
    scroll_list: [],
    scroll_max_level: 3,
    verbal_blocked: false,
};
describe('spellcasting presentation', () => {
    it('shows persistent slots including exhausted levels', () => {
        const html = renderToStaticMarkup(<SpellSlots state={state} />);
        expect(html).toContain('III');
        expect(html).toContain('1/2');
        expect(html).toContain('0/1');
        expect(html).toContain('●○');
    });
    it('uses cast-level buttons with availability and current scaled effects, without select', () => {
        const html = renderToStaticMarkup(
            <CastLevelChooser ability={spell} onChoose={() => {}} onClose={() => {}} />,
        );
        expect(html).toContain('III');
        expect(html).toContain('IV');
        expect(html).toContain('9d6');
        expect(html).toContain('2 доступно');
        expect(html).not.toContain('<select');
    });
    it('shows canonical components, material, preparation and honest partial coverage', () => {
        const html = renderToStaticMarkup(<SpellDetails ability={spell} />);
        for (const text of [
            'V · S · M',
            'bat guano',
            'Подготовлено',
            'PARTIAL',
            'Ignition is manual',
            'Complete SRD reference',
        ])
            expect(html).toContain(text);
    });
    it('explains lack of slots without hiding the known prepared spell', () => {
        const a = {
            ...spell,
            casting: { available: false, reason: 'Нет ячейки выбранного круга.', levels: [] },
        };
        expect(renderToStaticMarkup(<SpellDetails ability={a} />)).toContain(
            'Нет ячейки выбранного круга.',
        );
    });
    it('retains direct Spellbook cast and hotbar binding affordances', () => {
        const html = renderToStaticMarkup(
            <RpgDragProvider icon={() => 'spark'}>
                <SpellbookView
                    abilities={[spell]}
                    resources={[]}
                    spellcasting={state}
                    onChoose={() => {}}
                    onBind={() => {}}
                />
            </RpgDragProvider>,
        );
        expect(html).toContain('Fireball');
        expect(html).toContain('Ячейки заклинаний');
        expect(html).toContain('draggable');
    });
    it('shows concentration duration and a voluntary stop control', () => {
        const character = {
            ...createDemoScene().characters?.[0],
            id: '5',
            name: 'Caster',
            spellEffects: [
                {
                    id: 'e',
                    name: 'Bless',
                    concentration: true,
                    remainingRounds: 10,
                    expiresAt: null,
                    startedAt: 'now',
                },
            ],
        } as Character;
        const html = renderToStaticMarkup(
            <ConcentrationHUD character={character} campaign="5" onChanged={() => {}} />,
        );
        expect(html).toContain('Концентрация · Bless');
        expect(html).toContain('10 раундов');
        expect(html).toContain('Прекратить концентрацию');
    });
    it('shows temporary HP independently of concentration', () => {
        const character = { id: '5', temporaryHp: 9 } as Character;
        expect(
            renderToStaticMarkup(
                <ConcentrationHUD character={character} campaign="5" onChanged={() => {}} />,
            ),
        ).toContain('Временные HP · 9');
    });
});
