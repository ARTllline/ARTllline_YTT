import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    damageLabel,
    schoolLabel,
    timeLabel,
    itemSummary,
    spellSummary,
    spellRange,
    rarityLabels,
} from './presentation';
import { ItemMechanics, SpellCharacteristics, SpellResolutionFacts } from './EntryFacts';
import { ItemCard } from '../control/ItemLibrary';
import { SpellDetails } from '../control/SpellLibrary';
import type { ItemDefinition } from '../rpg/model';
import { newAbility } from '../gameplay/model';

const sword: ItemDefinition = {
    id: 'test',
    name: 'Очень длинное название <script> предмета',
    icon: 'item_sword',
    category: 'weapon',
    rarity: 'rare',
    description: 'Original unverified rules stay verbatim.',
    width: 1,
    height: 1,
    max_stack: 1,
    equipment_slots: ['main_hand'],
    modifiers: {},
    use_ability_id: null,
    gameplay: {
        weapon: {
            dice: '1d8',
            damage_type: 'slashing',
            kind: 'melee',
            category: 'martial',
            properties: ['versatile'],
            versatile_dice: '1d10',
            mastery: 'sap',
        },
    },
};
const spell = () => ({
    ...newAbility('effect', 0),
    name: 'Visual fixture',
    description: 'Original prose, not a translation.',
    spell: {
        level: 3,
        school: 'evocation',
        classes: [],
        known: true,
        prepared: false,
        components: ['V', 'S', 'M'],
        casting_time: 'Action',
        duration_text: 'Concentration, up to 10 minutes',
        coverage: 'PARTIAL' as const,
        reference: 'Original prose, not a translation.',
    },
    damage_components: [{ dice: '8d6', type: 'fire' }],
});

describe('Compendium display vocabulary and facts', () => {
    it('keeps reference ranges and SRD rarity labels distinct from execution recipes', () => {
        const a = spell();
        const reference = {
            ...a,
            range: { normal: 15, long: null },
            spell: {
                ...a.spell,
                content: {
                    gates: { browse: true, copy: true, execute: false },
                    range_text: 'Self',
                },
            },
        };
        expect(spellRange(reference)).toBe('На себя');
        reference.spell.content.range_text = 'Touch';
        expect(spellRange(reference)).toBe('Касание');
        expect(rarityLabels.very_rare).toBe('Очень редкий');
        expect(rarityLabels.epic).toBe('Эпический');
        expect(rarityLabels.varies).toBe('Зависит от варианта');
    });
    it('shows authoritative save metadata without calculating a caster DC', () => {
        const ability = {
            ...spell(),
            save: {
                ability: 'dex' as const,
                dc_source: 'spellcasting' as const,
                dc: 0,
                on_success: 'half' as const,
                on_failure: 'full' as const,
            },
        };
        const html = renderToStaticMarkup(<SpellResolutionFacts ability={ability} />);
        expect(html).toContain('ЛОВ · КС заклинателя');
        expect(html).toContain('Половина урона');
        expect(html).not.toContain('КС 0');
        expect(ability.save.dc).toBe(0);
    });
    it('localizes only known system values and preserves unknown terms verbatim', () => {
        expect(schoolLabel('Evocation')).toBe('Воплощение');
        expect(schoolLabel('necromancy')).toBe('Некромантия');
        expect(damageLabel('slashing')).toBe('рубящий');
        expect(damageLabel('radiant')).toBe('излучение');
        expect(schoolLabel('Homebrew School')).toBe('Homebrew School');
        expect(damageLabel('custom-energy')).toBe('custom-energy');
    });
    it('formats known times with Russian grammar without interpreting condition prose', () => {
        expect(timeLabel('Instantaneous')).toBe('Мгновенно');
        expect(timeLabel('1 round')).toBe('1 раунд');
        expect(timeLabel('2 rounds')).toBe('2 раунда');
        expect(timeLabel('11 rounds')).toBe('11 раундов');
        expect(timeLabel('Concentration, up to 10 minutes')).toBe('Концентрация, до 10 минут');
        expect(timeLabel('Up to 1 hour')).toBe('до 1 часа');
        expect(timeLabel('1 Bonus Action')).toBe('Бонусное действие');
        expect(timeLabel('1 Reaction, when a creature moves')).toBe(
            '1 Reaction, when a creature moves',
        );
        expect(timeLabel()).toBe('По описанию');
    });
    it('renders structured weapon mechanics and keeps complete escaped names and rules', () => {
        const before = JSON.stringify(sword);
        const html = renderToStaticMarkup(<ItemCard definition={sword} />);
        expect(html).toContain('Редкий');
        expect(html).toContain('рубящий');
        expect(html).toContain('Универсальное');
        expect(html).toContain('Ослабление');
        expect(html).toContain('Описание');
        expect(html).toContain(sword.description);
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('<script>');
        expect(JSON.stringify(sword)).toBe(before);
    });
    it('distinguishes source-only items from supported profiles in catalog and inspector', () => {
        const manual = {
            ...sword,
            gameplay: null,
            content: {
                gates: { browse: true, copy: true, execute: false },
                facts: ['Source damage 9d99; not executable.'],
            },
        };
        expect(itemSummary(manual)).toEqual(['Справочный предмет', 'Решение ГМ']);
        expect(renderToStaticMarkup(<ItemMechanics definition={manual} />)).not.toContain('1d8');
        expect(
            itemSummary({
                ...sword,
                gameplay: { armor: { category: 'shield', ac_bonus: 2, add_dex: false } },
            })[0],
        ).toBe('+2 КД');
    });
    it('renders spell facts in Russian while retaining original descriptions and payload', () => {
        const ability = spell(),
            before = JSON.stringify(ability);
        const html = renderToStaticMarkup(<SpellDetails ability={ability} />);
        expect(html).toContain('Воплощение');
        expect(html).toContain('Концентрация, до 10 минут');
        expect(html).toContain('Действие');
        expect(html).toContain('8d6 огонь');
        expect(html).toContain('Original prose, not a translation.');
        expect(html).not.toContain('Instantaneous');
        expect(html.replace(/<[^>]*>/g, '')).not.toContain('evocation');
        expect(spellSummary(ability)[0]).toBe('8d6 огонь');
        expect(JSON.stringify(ability)).toBe(before);
    });
    it('keeps absent metadata explicit and unknown long casting conditions readable', () => {
        const ability = {
            ...spell(),
            spell: {
                ...spell().spell,
                casting_time: 'Unknown custom condition '.repeat(10),
                components: [],
                duration_text: null,
            },
        };
        const html = renderToStaticMarkup(<SpellCharacteristics ability={ability} />);
        expect(html).toContain('is-wide');
        expect(html).toContain('Unknown custom condition');
        expect(html).toContain('По описанию');
        expect(html).toContain('—');
    });
});
