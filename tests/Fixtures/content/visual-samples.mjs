/* global structuredClone */
import { randomUUID } from 'node:crypto';
// Presentation-only variants, held in browser-test memory. Not an import package.
export function visualSamples(fixture) {
    const clone = (value) => structuredClone(value);
    const pick = (name) =>
        clone(fixture.items.entries.find((row) => row.definition.name === name).definition);
    const variants = [
        ['Longsword', 'Клинок хранителя северного перевала', 'rare', 'item_sword'],
        ['Chain Mail', 'Доспех сумеречного стража', 'epic', 'item_armor'],
        ['Shield', 'Щит последнего рубежа', 'uncommon', 'item_shield'],
        ['Bag of Holding', 'Кольцо звёздного пути', 'legendary', 'item_ring'],
        ['Potion of Healing', 'Свиток возвращения света', 'rare', 'item_scroll'],
        ['Arrows', 'Стрелы лесного дозора', 'common', 'bow'],
        [
            'Bag of Holding',
            'Безымянный трофей из затерянной обсерватории на краю мира с очень длинным названием',
            'common',
            'missing-icon',
        ],
    ].map(([base, name, rarity, icon], i) => {
        const d = pick(base);
        Object.assign(d, {
            id: randomUUID(),
            name,
            rarity,
            icon,
            content: null,
            description:
                'Пользовательская тестовая запись для проверки оформления. Это не текст официальных правил.',
        });
        if (i === 3)
            Object.assign(d, {
                category: 'trinket',
                gameplay: null,
                modifiers: { ac: 1 },
                equipment_slots: ['ring_1'],
            });
        if (i === 4) {
            const ability = clone(fixture.spellCopy.ability);
            ability.name = 'Тестовое применение';
            d.category = 'scroll';
            d.gameplay = { use: { scroll: true, consume: true, ability } };
        }
        if (i === 6)
            Object.assign(d, {
                category: 'other',
                gameplay: null,
                modifiers: {},
                equipment_slots: [],
                description: '',
            });
        return d;
    });
    const spellNames = [
        'Искра рассвета',
        'Ограждение хранителя',
        'Зов туманного леса',
        'Эхо далёких звёзд',
        'Очарование путника',
        'Зеркало лунного озера',
        'Тень забытого короля',
        'Долгое превращение хранителя древней обсерватории на краю мира',
    ];
    const schools = [
        'evocation',
        'abjuration',
        'conjuration',
        'divination',
        'enchantment',
        'illusion',
        'necromancy',
        'transmutation',
    ];
    const durations = [
        'Instantaneous',
        '1 round',
        'Up to 1 minute',
        'Concentration, up to 10 minutes',
        '1 hour',
        '8 hours',
        'Until dispelled',
        'Special',
    ];
    const spells = spellNames.map((name, i) => {
        const s = clone(fixture.spellCopy);
        s.id = 10000 + i;
        s.custom = true;
        s.copyable = true;
        s.source = {
            name: 'Пользовательская QA-запись',
            version: '',
            license: '',
            attribution: 'Временная frontend-фикстура.',
            url: '',
        };
        const a = s.ability;
        Object.assign(a, {
            name,
            icon: ['spark', 'shield', 'focus', 'eye', 'heart', 'mana', 'bolt', 'missing-icon'][i],
            description:
                'Тестовая пользовательская запись. Исходные тексты системных правил не изменяются.',
            damage: null,
            damage_components: [],
            attack: null,
            save: null,
            result: { type: 'nothing', amount: 0, target: null },
            target: i === 1 ? 'self' : 'token',
            range: { normal: 30, long: null },
        });
        Object.assign(a.spell, {
            level: [0, 2, 4, 5, 6, 7, 8, 9][i],
            school: schools[i],
            casting_time: i === 1 ? 'Reaction' : i === 3 ? '1 minute' : 'Action',
            duration_text: durations[i],
            concentration: i === 3,
            ritual: i === 2,
            coverage: 'MANUAL',
            reasons: [],
            reference: a.description,
            content: null,
            effects: [],
        });
        return s;
    });
    return {
        items: variants,
        spells,
        recordCount:
            fixture.items.entries.length +
            variants.length +
            fixture.spells.entries.length +
            spells.length,
    };
}
