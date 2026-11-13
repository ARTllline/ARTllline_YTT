import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ContentReference } from './ContentReference';
import { ItemCard } from '../control/ItemLibrary';
import { SpellDetails } from '../control/SpellLibrary';
import type { ItemDefinition } from '../rpg/model';
import type { Ability } from '../gameplay/model';

vi.mock('../gameplay/RpgIcon', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../gameplay/RpgIcon')>()),
    RpgIcon: () => null,
}));
vi.mock('../control/AssetLibrary', () => ({ AssetIconPicker: () => null }));

describe('Compendium copy provenance', () => {
    it('renders complete escaped reference and an explicit GM requirement', () => {
        const html = renderToStaticMarkup(
            createElement(ContentReference, {
                content: {
                    ruleset: 'dnd-2024',
                    rules_revision: 'SRD 5.2.1',
                    gates: { browse: true, copy: true, execute: false },
                    reference:
                        'Bag of Holding <script>unsafe()</script> ' +
                        'Full reference. '.repeat(100),
                    gm_required: ['Вместимость и проходы определяет GM.'],
                    attribution: 'CC BY 4.0 · SRD 5.2.1',
                },
            }),
        );
        expect(html).toContain('Требует решения GM');
        expect(html).toContain('справочная копия');
        expect(html).toContain('dnd-2024');
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('<script>');
        expect(html).toContain('CC BY 4.0');
        expect(html.split('Full reference.').length).toBe(101);
    });

    it('keeps legacy views unchanged and preserves limitations for supported profiles', () => {
        expect(renderToStaticMarkup(createElement(ContentReference, {}))).toBe('');
        const html = renderToStaticMarkup(
            createElement(ContentReference, {
                content: {
                    gates: { browse: true, copy: true, execute: true },
                    gm_required: ['Mastery разрешает GM.'],
                    reference: 'Hidden repeated spell text',
                },
                showText: false,
            }),
        );
        expect(html).toContain('Mastery разрешает GM.');
        expect(html).not.toContain('автоматические эффекты не одобрены');
        expect(html).not.toContain('Hidden repeated spell text');
    });

    it('shows uncommon item rarity, complete localized source and GM limits in the real item card', () => {
        const definition: ItemDefinition = {
            id: 'fixture-only',
            name: 'Bag of Holding',
            icon: 'book',
            rarity: 'uncommon',
            category: 'adventuring_gear',
            width: 1,
            height: 1,
            max_stack: 1,
            equipment_slots: [],
            modifiers: {},
            use_ability_id: null,
            description: 'Short editor text',
            content: {
                gates: { browse: true, copy: true, execute: false },
                facts: ['Вес по источнику: 5 lb'],
                reference: 'Full untruncated source. '.repeat(100),
                localized: {
                    name: 'Сумка хранения',
                    description: 'Сфера радиусом 10 футов; 64 кубических фута.',
                },
            },
        };
        const html = renderToStaticMarkup(createElement(ItemCard, { definition }));
        expect(html).toContain('Необычный');
        expect(html).toContain('Сумка хранения');
        expect(html).toContain('64 кубических фута');
        expect(html).toContain('Требует решения GM');
        expect(html.split('Full untruncated source.').length).toBe(101);
    });

    it('shows MANUAL spell coverage without suggesting an automatic damage result', () => {
        const ability = {
            name: 'Wish',
            icon: 'spark',
            category: 'effect',
            target: 'none',
            description: 'Reference only',
            result: { type: 'nothing', amount: 0, target: null },
            spell: {
                level: 9,
                school: 'conjuration',
                known: true,
                prepared: false,
                classes: ['wizard'],
                coverage: 'MANUAL',
                reference: 'Stress is not primary damage.',
                content: {
                    gates: { browse: true, copy: true, execute: false },
                    gm_required: ['Требует решения GM'],
                },
            },
        } as Ability;
        const html = renderToStaticMarkup(createElement(SpellDetails, { ability }));
        expect(html).toContain('MANUAL');
        expect(html).toContain('Stress is not primary damage.');
        expect(html).toContain('Требует решения GM');
        expect(html).not.toContain('Восстановление HP');
    });
});
